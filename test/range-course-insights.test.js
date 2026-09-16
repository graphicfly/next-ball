import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRangeCourseInsights, selectRangeWindow, clubRangeProfiles,
  RANGE_WINDOW, INSIGHT_THRESHOLDS,
} from '../js/rangeCourseInsights.js';

// Range ↔ Course intelligence. The bar throughout: an insight must be
// supported by data that was actually recorded on BOTH sides, and must
// never characterise a course shot — Course Mode records which clubs
// appeared on a hole and nothing about what they did (§7.4, §9.7).

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4]; // par 35
const ROUND = { round_id: 'r1', course_id: 'c1', course_name: 'Oakmont Golf Center' };
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00Z').getTime();

function makeHoles({ pars = PARS, strokes, putts = [], sg = [], clubs = [] }) {
  return strokes.map((s, i) => ({
    hole_number: i + 1,
    par: pars[i] ?? null,
    yardage: null,
    strokes: s,
    clubs_used: clubs[i] ?? [],
    short_game_strokes: sg[i] ?? 0,
    putts: putts[i] ?? 2,
  }));
}

// A synthetic range history: `sessions` entries, each `daysAgo` apart,
// every one containing `perSession` shots of `club` at `solidRate` quality.
function rangeHistory({ club = 'PW', sessions = 4, perSession = 12, solidRate = 0.9, startDaysAgo = 2, spacingDays = 7 } = {}) {
  const list = [];
  const shots = {};
  for (let i = 0; i < sessions; i++) {
    const id = `${club}-s${i}`;
    list.push({ session_id: id, created_at: new Date(NOW - (startDaysAgo + i * spacingDays) * DAY).toISOString() });
    shots[id] = Array.from({ length: perSession }, (_, n) => ({
      shot_number: n + 1,
      club,
      strike: n < Math.round(perSession * solidRate) ? 'solid' : 'thin',
      direction: 'straight', height: 'medium', distance_yards: 110,
    }));
  }
  return { sessions: list, shotsBySession: (id) => shots[id] || [] };
}

function build(holes, history = { sessions: [], shotsBySession: () => [] }) {
  return buildRangeCourseInsights(ROUND, holes, {
    rangeSessions: history.sessions,
    shotsBySession: history.shotsBySession,
    now: NOW,
  });
}

describe('The analysis window', () => {
  test('keeps only recent sessions, newest first, capped in count', async () => {
    const sessions = Array.from({ length: 9 }, (_, i) => ({
      session_id: `s${i}`,
      created_at: new Date(NOW - (i + 1) * 3 * DAY).toISOString(),
    }));
    const picked = selectRangeWindow(sessions, { now: NOW });
    assert.equal(picked.length, RANGE_WINDOW.maxSessions);
    assert.equal(picked[0].session_id, 's0'); // newest first
  });

  test('sessions older than the age cap are excluded entirely', async () => {
    const sessions = [
      { session_id: 'recent', created_at: new Date(NOW - 5 * DAY).toISOString() },
      { session_id: 'ancient', created_at: new Date(NOW - 200 * DAY).toISOString() },
    ];
    const picked = selectRangeWindow(sessions, { now: NOW });
    assert.deepEqual(picked.map((s) => s.session_id), ['recent']);
  });

  test('history is never used wholesale — a career of old sessions yields nothing', async () => {
    const old = Array.from({ length: 40 }, (_, i) => ({
      session_id: `old${i}`,
      created_at: new Date(NOW - (120 + i) * DAY).toISOString(),
    }));
    assert.deepEqual(selectRangeWindow(old, { now: NOW }), []);
  });
});

describe('Club range profiles', () => {
  test('reliability requires enough recent shots, not just a good percentage', async () => {
    // Perfect contact, but only 6 shots — not enough to call reliable.
    const history = rangeHistory({ sessions: 3, perSession: 2, solidRate: 1 });
    const [profile] = clubRangeProfiles(selectRangeWindow(history.sessions, { now: NOW }), history.shotsBySession);
    assert.equal(profile.shots, 6);
    assert.ok(profile.shots < INSIGHT_THRESHOLDS.minRangeShotsPerClub);
    assert.equal(profile.reliable, false);
  });

  test('plenty of shots at poor contact is not reliable either', async () => {
    const history = rangeHistory({ sessions: 4, perSession: 12, solidRate: 0.2 });
    const [profile] = clubRangeProfiles(selectRangeWindow(history.sessions, { now: NOW }), history.shotsBySession);
    assert.ok(profile.shots >= INSIGHT_THRESHOLDS.minRangeShotsPerClub);
    assert.equal(profile.reliable, false);
  });

  test('enough recent shots at good contact is reliable', async () => {
    const history = rangeHistory({ sessions: 4, perSession: 12, solidRate: 0.9 });
    const [profile] = clubRangeProfiles(selectRangeWindow(history.sessions, { now: NOW }), history.shotsBySession);
    assert.equal(profile.reliable, true);
    assert.ok(profile.solidPct >= INSIGHT_THRESHOLDS.reliableSolidPct);
  });
});

describe('Range → Course: a reliable club on the better holes', () => {
  test('is stated when both sides clear their thresholds', async () => {
    // PW appears on holes 1-4; holes 1-4 are the round's best.
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    const [insight] = build(holes, rangeHistory({ club: 'PW' }));

    assert.equal(insight.kind, 'reliable_club');
    assert.equal(insight.direction, 'range_to_course');
    assert.equal(insight.club, 'PW');
    assert.match(insight.text, /^PW has been one of your most reliable range clubs and appeared on \d+ of your \d+ best-scoring holes\.$/);
    assert.ok(insight.evidence.rangeShots >= INSIGHT_THRESHOLDS.minRangeShotsPerClub);
    assert.ok(insight.evidence.bestHoleOverlap >= INSIGHT_THRESHOLDS.minBestHoleOverlap);
  });

  test('is NOT stated when the club has no recent range history', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    // Range history exists, but for a different club entirely.
    const insights = build(holes, rangeHistory({ club: '7i' }));
    assert.equal(insights.filter((i) => i.kind === 'reliable_club').length, 0);
  });

  test('is NOT stated when the range sample is too thin', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: 'PW', sessions: 3, perSession: 3 }));
    assert.equal(insights.filter((i) => i.kind === 'reliable_club').length, 0);
  });

  test('is NOT stated when too few range sessions fall in the window', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    // Plenty of shots, but across only two sessions — one or two range days
    // is not a tendency.
    const insights = build(holes, rangeHistory({ club: 'PW', sessions: 2, perSession: 30 }));
    assert.ok(2 < RANGE_WINDOW.minSessions);
    assert.equal(insights.length, 0);
  });

  test('is NOT stated when the round had no spread to have "best holes" in', async () => {
    // Every hole is exactly +1, so the "best-scoring holes" are only an
    // artifact of sorting ties — claiming a club appeared on them would
    // read as a finding while resting on nothing.
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: 'PW' }));
    assert.equal(insights.filter((i) => i.kind === 'reliable_club').length, 0);
  });

  test('is NOT stated when the club barely appeared on the card', async () => {
    // Reliable on the range, but only two holes this round.
    const holes = makeHoles({
      strokes: [4, 4, 5, 6, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], [], [], [], [], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: 'PW' }));
    assert.equal(insights.length, 0);
  });
});

describe('Course → Range: a club worth attention', () => {
  test('is phrased as an invitation to practise, never as blame', async () => {
    // 9i appears on the three worst holes.
    const holes = makeHoles({
      strokes: [7, 7, 6, 4, 5, 4, 3, 4, 4],
      clubs: [['9i'], ['9i'], ['9i'], [], [], [], [], [], []],
    });
    const [insight] = build(holes, rangeHistory({ club: '9i' }));

    assert.equal(insight.kind, 'club_attention');
    assert.equal(insight.direction, 'course_to_range');
    assert.match(insight.text, /appeared on 3 of your higher-scoring holes/);
    assert.match(insight.text, /worth giving the 9i extra attention/);
    // No causal or judgemental language anywhere.
    assert.doesNotMatch(insight.text, /caused|because|blame|poor|bad|lost \d+ strokes/i);
  });

  test('is NOT stated when the club is spread evenly across the round', async () => {
    // Every hole is +1, so no club coincides with worse holes than any other.
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['7i'], ['7i'], ['7i'], ['PW'], ['PW'], ['PW'], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: '7i' }));
    assert.equal(insights.filter((i) => i.kind === 'club_attention').length, 0);
  });

  test('needs three holes — two is a coincidence, not a pattern', async () => {
    const holes = makeHoles({
      strokes: [8, 8, 4, 4, 5, 4, 3, 4, 4],
      clubs: [['5i'], ['5i'], [], [], [], [], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: '5i' }));
    assert.ok(2 < INSIGHT_THRESHOLDS.minCourseHoles);
    assert.equal(insights.length, 0);
  });
});

describe('Course → Range: a club being played but not practised', () => {
  test('is stated when the club is near-absent from the recent window', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['3W'], ['3W'], ['3W'], [], [], [], [], [], []],
    });
    // A real window exists (PW practice), but 3W is not in it.
    const [insight] = build(holes, rangeHistory({ club: 'PW' }));
    assert.equal(insight.kind, 'club_unpractised');
    assert.equal(insight.direction, 'course_to_range');
    assert.match(insight.text, /3W appeared on 3 holes this round but has barely come up/);
  });

  test('is NOT stated when there is no range window to be absent from', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['3W'], ['3W'], ['3W'], [], [], [], [], [], []],
    });
    // With no recent practice at all, "you haven't practised this" would be
    // an observation about nothing.
    assert.deepEqual(build(holes), []);
  });
});

describe('Honesty rules hold across every generated sentence', () => {
  const FORBIDDEN = /missed (left|right)|% solid on course|gained \d+ strokes|lost \d+ strokes|caused|your worst club|greens? in regulation/i;

  test('no insight ever characterises a course shot', async () => {
    const scenarios = [
      { holes: makeHoles({ strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6], clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []] }), history: rangeHistory({ club: 'PW' }) },
      { holes: makeHoles({ strokes: [7, 7, 6, 4, 5, 4, 3, 4, 4], clubs: [['9i'], ['9i'], ['9i'], [], [], [], [], [], []] }), history: rangeHistory({ club: '9i' }) },
      { holes: makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['3W'], ['3W'], ['3W'], [], [], [], [], [], []] }), history: rangeHistory({ club: 'PW' }) },
    ];
    for (const s of scenarios) {
      for (const insight of build(s.holes, s.history)) {
        assert.doesNotMatch(insight.text, FORBIDDEN, insight.text);
        // Every club claim states how many holes it rests on, so the
        // reader can weigh it (§9.7).
        if (insight.club) {
          assert.match(insight.text, /\d+/, insight.text);
          assert.match(insight.text, /holes?/, insight.text);
        }
      }
    }
  });

  test('range vocabulary is only ever used about range data', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    const [insight] = build(holes, rangeHistory({ club: 'PW' }));
    // "reliable" attaches to "range clubs", never to what happened on a hole.
    assert.match(insight.text, /reliable range clubs/);
    assert.doesNotMatch(insight.text, /reliable on the course|solid on the course/i);
  });

  test('two facts are joined by "and", never by a causal connective', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    const [insight] = build(holes, rangeHistory({ club: 'PW' }));
    assert.match(insight.text, / and appeared on /);
    assert.doesNotMatch(insight.text, / so | because | which is why /i);
  });
});

describe('Volume and suppression', () => {
  test('never more than the configured maximum — a bridge, not a dashboard', async () => {
    const holes = makeHoles({
      strokes: [7, 7, 6, 6, 6, 5, 4, 4, 4],
      clubs: [['9i', '5i', '3W'], ['9i', '5i', '3W'], ['9i', '5i', '3W'], [], [], [], [], [], []],
    });
    const insights = build(holes, rangeHistory({ club: 'PW' }));
    assert.ok(insights.length <= INSIGHT_THRESHOLDS.maxInsights);
  });

  test('a round without par on every hole produces nothing', async () => {
    const holes = makeHoles({ pars: [null, null, null], strokes: [5, 5, 4], clubs: [['PW'], ['PW'], ['PW']] });
    assert.deepEqual(build(holes, rangeHistory({ club: 'PW' })), []);
  });

  test('a round with no clubs recorded produces nothing', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] });
    assert.deepEqual(build(holes, rangeHistory({ club: 'PW' })), []);
  });

  test('every insight carries inspectable evidence for its claim', async () => {
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 7, 6, 5, 6, 6],
      clubs: [['PW'], ['PW'], ['PW'], ['PW'], [], [], [], [], []],
    });
    for (const insight of build(holes, rangeHistory({ club: 'PW' }))) {
      assert.ok(insight.id && insight.kind && insight.direction && insight.text);
      assert.equal(typeof insight.evidence, 'object');
      assert.ok(insight.evidence.courseHoles >= INSIGHT_THRESHOLDS.minCourseHoles);
    }
  });
});
