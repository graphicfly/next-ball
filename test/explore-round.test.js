import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import {
  strokeStory, holeStretches, shortGameHoles, puttingSummary, clubUsage,
  rangeCourseBridge, comparableRounds, scoringComparison, puttingComparison,
  MIN_HOLES_FOR_STRETCH, MIN_HOLES_FOR_CLUB_SENTENCE,
  MIN_RANGE_SHOTS_FOR_BRIDGE, MIN_RANGE_SESSIONS_FOR_BRIDGE, MAX_BRIDGE_CLUBS,
} from '../js/roundAnalysis.js';

// Explore Round analytics — docs/course-mode-spec.md §9. Every claim must be
// traceable to a §6 field, and nothing may appear below its §9.5 threshold.

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4]; // par 35

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

const ROUND = { round_id: 'r1', course_id: 'c1', course_name: 'Oakmont Golf Center' };

describe('The top-level story (§9.2)', () => {
  test('names only the single largest bucket', async () => {
    // 44 strokes vs par 35 = +9; putts 25 vs baseline 18 = +7 of it.
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] });
    const story = strokeStory(holes);
    assert.equal(story.kind, 'putting');
    assert.equal(story.text, 'Putting accounted for +7 of your +9.');
    // Never a ranked list of three.
    assert.doesNotMatch(story.text, /greenside|full swing/i);
  });

  test('says so plainly when two buckets are within a stroke', async () => {
    // Putts +2 and greenside +2 — no winner should be invented.
    const holes = makeHoles({
      strokes: [5, 4, 4, 4, 5, 4, 4, 4, 4],
      putts: [2, 2, 2, 2, 2, 2, 3, 3, 2],
      sg: [1, 0, 1, 0, 0, 0, 0, 0, 0],
    });
    const story = strokeStory(holes);
    assert.equal(story.kind, 'tied');
    assert.match(story.text, /each added about/);
  });

  test('a level round reports what held up rather than manufacturing a loss', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4] });
    const story = strokeStory(holes);
    assert.equal(story.kind, 'held_up');
    assert.equal(story.text, 'You played 9 holes in even par.');
  });

  test('a round under par is never described as a loss', async () => {
    const holes = makeHoles({ strokes: [3, 4, 3, 4, 4, 4, 3, 4, 4] }); // 33 vs 35
    const story = strokeStory(holes);
    assert.equal(story.kind, 'held_up');
    assert.match(story.text, /under par/);
  });

  test('without par on every hole the story is omitted entirely', async () => {
    const holes = makeHoles({ pars: [4, null, 3], strokes: [5, 6, 4] });
    assert.equal(strokeStory(holes), null);
  });
});

describe('Stretches (§9.3)', () => {
  test('finds the best and toughest consecutive three holes', async () => {
    // Holes 1-3 are +3 each; holes 7-9 are level.
    const holes = makeHoles({ strokes: [7, 7, 6, 5, 6, 5, 3, 4, 4] });
    const { best, worst } = holeStretches(holes);
    assert.deepEqual([best.from, best.to, best.toPar], [7, 9, 0]);
    assert.deepEqual([worst.from, worst.to, worst.toPar], [1, 3, 9]);
  });

  test('suppressed below 6 holes, where a 3-hole window is half the round', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6] });
    assert.ok(holes.length < MIN_HOLES_FOR_STRETCH);
    assert.equal(holeStretches(holes), null);
  });

  test('the same stretch is never reported as both best and toughest', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4] }); // every hole level
    const { best, worst } = holeStretches(holes);
    assert.ok(best);
    assert.equal(worst, null);
  });
});

describe('Short game (§9.3)', () => {
  test('ranks the holes that carried greenside strokes', async () => {
    const holes = makeHoles({ strokes: [6, 5, 4, 5, 6, 5, 4, 5, 5], sg: [3, 1, 0, 2, 0, 0, 0, 1, 0] });
    const ranked = shortGameHoles(holes);
    assert.deepEqual(ranked.map((h) => h.hole_number), [1, 4, 2, 8]);
    assert.equal(ranked[0].short_game_strokes, 3);
  });

  test('a round with no greenside strokes has nothing to rank', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4] });
    assert.deepEqual(shortGameHoles(holes), []);
  });
});

describe('Putting (§9.3)', () => {
  test('totals, per hole, and three-putts are counted exactly', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 2, 2, 2, 2, 2, 2] });
    const p = puttingSummary(holes);
    assert.equal(p.total, 20);
    assert.equal(p.perHole, 2.2);
    assert.equal(p.threePutts.length, 2);
    assert.deepEqual(p.threePutts.map((h) => h.hole_number), [1, 2]);
    assert.equal(p.hasThreePutts, true);
  });

  test('with no three-putts there is nothing to mention', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4] });
    const p = puttingSummary(holes);
    assert.equal(p.hasThreePutts, false);
    assert.deepEqual(p.threePutts, []);
  });
});

describe('Club use (§9.3, §9.7)', () => {
  test('counts the holes a club appeared on and the average those holes scored', async () => {
    const holes = makeHoles({
      strokes: [7, 7, 3, 4, 5, 4, 3, 4, 4],
      clubs: [['9i'], ['9i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
    });
    const usage = clubUsage(holes);
    const nine = usage.find((c) => c.club === '9i');
    assert.equal(nine.holeCount, 2);
    assert.equal(nine.avgToPar, 3);   // both holes three over
    assert.equal(nine.margin, 3);     // versus level on the rest
  });

  test('a club on one hole is recorded but is below the row threshold', async () => {
    const holes = makeHoles({
      strokes: [8, 4, 3, 4, 5, 4, 3, 4, 4],
      clubs: [['3W'], [], [], [], [], [], [], [], []],
    });
    const usage = clubUsage(holes);
    assert.equal(usage.find((c) => c.club === '3W').holeCount, 1);
    // The screen filters rows to >= 2 holes; a single hole is not a pattern.
    assert.equal(usage.filter((c) => c.holeCount >= 2).length, 0);
  });

  test('a narrative claim needs more holes than a table row', async () => {
    // Two holes is enough to list, not enough to assert anything about.
    assert.equal(MIN_HOLES_FOR_CLUB_SENTENCE, 3);
  });

  test('clubs are never ranked by quality — only by how often they appeared', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['PW'], ['PW'], ['PW'], ['7i'], ['7i'], [], [], [], []],
    });
    const usage = clubUsage(holes);
    assert.deepEqual(usage.map((c) => c.club), ['PW', '7i']);
    assert.equal(usage[0].holeCount, 3);
  });
});

describe('Range → Course bridge (§9.3 §5, §9.5)', () => {
  function rangeShots(club, count, solidCount) {
    return Array.from({ length: count }, (_, i) => ({
      shot_number: i + 1, club,
      strike: i < solidCount ? 'solid' : 'thin',
      direction: 'straight', height: 'medium', distance_yards: 140,
    }));
  }

  test('pairs range reliability with course appearance when both clear their thresholds', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['PW'], ['PW'], ['PW'], [], [], [], [], [], []],
    });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }];
    const byId = { s1: rangeShots('PW', 12, 10), s2: rangeShots('PW', 12, 10), s3: rangeShots('PW', 12, 10) };

    const [pair] = rangeCourseBridge(holes, sessions, (id) => byId[id]);
    assert.equal(pair.club, 'PW');
    assert.equal(pair.rangeShots, 36);
    assert.equal(pair.rangeSessions, 3);
    assert.equal(pair.holeCount, 3);
    assert.ok(pair.solidPct >= 60);
  });

  test('too few lifetime range shots keeps the club out', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['PW'], ['PW'], ['PW'], [], [], [], [], [], []] });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }];
    const byId = { s1: rangeShots('PW', 5, 5), s2: rangeShots('PW', 5, 5), s3: rangeShots('PW', 5, 5) };
    assert.ok(15 < MIN_RANGE_SHOTS_FOR_BRIDGE);
    assert.deepEqual(rangeCourseBridge(holes, sessions, (id) => byId[id]), []);
  });

  test('enough shots but too few sessions keeps the club out — one range day is not a tendency', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['PW'], ['PW'], ['PW'], [], [], [], [], [], []] });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }];
    const byId = { s1: rangeShots('PW', 30, 28), s2: rangeShots('PW', 20, 18) };
    assert.ok(2 < MIN_RANGE_SESSIONS_FOR_BRIDGE);
    assert.deepEqual(rangeCourseBridge(holes, sessions, (id) => byId[id]), []);
  });

  test('too few holes this round keeps the club out even with strong range data', async () => {
    // Two holes — below the 3-hole bar any claim requires.
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['PW'], ['PW'], [], [], [], [], [], [], []] });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }];
    const byId = { s1: rangeShots('PW', 15, 14), s2: rangeShots('PW', 15, 14), s3: rangeShots('PW', 15, 14) };
    assert.deepEqual(rangeCourseBridge(holes, sessions, (id) => byId[id]), []);
  });

  test('an unreliable range club is not described as reliable', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['PW'], ['PW'], ['PW'], [], [], [], [], [], []] });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }];
    // 20% solid — real data, but not a reliable club.
    const byId = { s1: rangeShots('PW', 15, 3), s2: rangeShots('PW', 15, 3), s3: rangeShots('PW', 15, 3) };
    assert.deepEqual(rangeCourseBridge(holes, sessions, (id) => byId[id]), []);
  });

  test('at most two clubs — a bridge, not a table', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: [['PW', '7i', '9i'], ['PW', '7i', '9i'], ['PW', '7i', '9i'], [], [], [], [], [], []],
    });
    const sessions = [{ session_id: 's1' }, { session_id: 's2' }, { session_id: 's3' }];
    const mixed = (n) => [...rangeShots('PW', n, n), ...rangeShots('7i', n, n), ...rangeShots('9i', n, n)];
    const byId = { s1: mixed(12), s2: mixed(12), s3: mixed(12) };
    const pairs = rangeCourseBridge(holes, sessions, (id) => byId[id]);
    assert.ok(pairs.length <= MAX_BRIDGE_CLUBS);
  });

  test('no range history at all means the section simply does not exist', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], clubs: [['PW'], ['PW'], ['PW'], [], [], [], [], [], []] });
    assert.deepEqual(rangeCourseBridge(holes, [], () => []), []);
  });
});

describe('Comparisons (§9.8)', () => {
  const prior = (over, holesPlayed = 9, course = 'c1', putts = 18) =>
    ({ course_id: course, holesPlayed, toPar: over, putts });

  test('only the same course and the same hole count are comparable', async () => {
    const all = [prior(5), prior(3, 18), prior(2, 9, 'other')];
    assert.deepEqual(comparableRounds(ROUND, 9, all), [prior(5)]);
  });

  test('one comparable round compares against the last round here', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] }); // +9
    const c = scoringComparison(ROUND, holes, [prior(12)]);
    assert.equal(c.kind, 'last');
    assert.equal(c.diff, -3);
    assert.equal(c.improved, true);
    assert.match(c.label, /3 better than your last round here/);
  });

  test('three comparable rounds compare against the average here', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] }); // +9
    const c = scoringComparison(ROUND, holes, [prior(12), prior(12), prior(12)]);
    assert.equal(c.kind, 'recent');
    assert.equal(c.diff, -3);
    assert.match(c.label, /average of 3 rounds here/);
  });

  test('a worse round is reported factually and never as an error', async () => {
    const holes = makeHoles({ strokes: [6, 6, 5, 6, 7, 6, 5, 6, 6] }); // +18
    const c = scoringComparison(ROUND, holes, [prior(9)]);
    assert.equal(c.improved, false);
    assert.match(c.label, /worse than your last round here/);
    // Factual delta only — never a trend claim.
    assert.doesNotMatch(c.label, /improving|getting better|trend/i);
  });

  test('a first round at a new course shows no comparison at all', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] });
    assert.equal(scoringComparison(ROUND, holes, []), null);
    assert.equal(scoringComparison(ROUND, holes, [prior(9, 18)]), null);
  });

  test('a putting average needs three comparable rounds, not one', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] });
    assert.equal(puttingComparison(ROUND, holes, [prior(9)]), null);
    assert.equal(puttingComparison(ROUND, holes, [prior(9), prior(9)]), null);

    const c = puttingComparison(ROUND, holes, [prior(9, 9, 'c1', 21), prior(9, 9, 'c1', 21), prior(9, 9, 'c1', 21)]);
    assert.equal(c.diff, -3);
    assert.equal(c.improved, true);
    assert.match(c.label, /3 fewer putts than your average here/);
  });
});

describe('Low-sample suppression end to end', () => {
  test('a three-hole round yields almost nothing rather than impressive-looking analysis', async () => {
    const holes = makeHoles({ strokes: [6, 5, 4], putts: [3, 2, 2], sg: [1, 0, 0], clubs: [['PW'], ['PW'], []] });

    // The story still works — the buckets only need par.
    assert.ok(strokeStory(holes));
    // ...but stretches are suppressed,
    assert.equal(holeStretches(holes), null);
    // ...no club clears the narrative bar,
    assert.equal(clubUsage(holes).filter((c) => c.holeCount >= MIN_HOLES_FOR_CLUB_SENTENCE).length, 0);
    // ...and the bridge has no range history to stand on.
    assert.deepEqual(rangeCourseBridge(holes, [], () => []), []);
  });

  test('test rounds are excluded from comparison entirely', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'T', source: 'manual', hole_count: 9 });
    const seeded = db.createRound({
      course_id: course.course_id, course_name: 'T', course_source: 'manual',
      hole_count: 9, hole_defs: db.defaultHoleDefs(9), data_source: 'test',
    });
    db.upsertHole(seeded.round_id, 1, { strokes: 4 });
    db.finishRound(seeded.round_id);

    const real = db.listFinishedRounds().filter((r) => db.sessionDataSource(r) === 'real');
    assert.equal(real.length, 0);
  });
});
