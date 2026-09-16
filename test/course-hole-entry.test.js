import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';

// Hole entry behavior — docs/course-mode-spec.md §4.4 (the screen), §5.3
// (autosave and resume), §5.4 (advisory validation), §5.5 (editing earlier
// holes), §5.6 (finishing early).
//
// These cover the rules the hole-entry screen encodes, at the layer that
// can be tested deterministically. The screen itself is verified in a real
// browser.

function reload(db) {
  db.__resetForTests();
}

async function startRound(db, { holeCount = 9, pars = null, yardages = null, courseName = 'Oakmont Golf Center' } = {}) {
  const course = db.upsertCourse({ name: courseName, city: 'Vienna', state: 'VA', source: 'manual', hole_count: holeCount });
  const holeDefs = db.defaultHoleDefs(holeCount).map((d, i) => ({
    hole_number: d.hole_number,
    par: pars ? pars[i] : d.par,
    yardage: yardages ? yardages[i] ?? null : null,
  }));
  const round = db.createRound({
    course_id: course.course_id,
    course_name: course.name, course_city: course.city, course_state: course.state,
    course_source: 'manual', hole_count: holeCount, hole_defs: holeDefs,
  });
  db.recordCoursePlayed(course.course_id, { hole_count: holeCount, hole_defs: holeDefs });
  return { course, round };
}

// The screen's own resume rule: the first hole with nothing recorded, or
// the last hole once everything has been played.
function firstUnplayed(db, round, exclude = null) {
  const played = new Set(db.getHolesForRound(round.round_id).map((h) => h.hole_number));
  for (let n = 1; n <= round.hole_count; n++) {
    if (n !== exclude && !played.has(n)) return n;
  }
  return null;
}

describe('The one-tap hole', () => {
  test('a hole saved without changing anything records par', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);

    // §4.4 — the stepper opens at par, so a routine hole is a single tap on
    // Save + Next Hole.
    const { hole } = db.upsertHole(round.round_id, 3, {});
    assert.equal(hole.par, 3);
    assert.equal(hole.strokes, 3);
    assert.equal(hole.short_game_strokes, 0);
    assert.equal(hole.putts, 0);
    assert.deepEqual(hole.clubs_used, []);
  });

  test('every hole of a 9 opens at its own par', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, {});

    assert.deepEqual(
      db.getHolesForRound(round.round_id).map((h) => h.strokes),
      [4, 4, 3, 4, 5, 4, 3, 4, 4],
    );
  });
});

describe('Multiple selected clubs', () => {
  test('two clubs on one hole', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);

    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 5, clubs_used: ['9i', 'PW'] });
    assert.deepEqual(hole.clubs_used, ['9i', 'PW']);
  });

  test('toggling a club off leaves the rest selected', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 6, clubs_used: ['Driver', '5i', 'SW'] });

    // The screen re-sends the whole set on every toggle.
    db.upsertHole(round.round_id, 1, { clubs_used: ['Driver', 'SW'] });
    assert.deepEqual(db.getHole(round.round_id, 1).clubs_used, ['Driver', 'SW']);
  });

  test('clubs survive a reload as a real multi-club set', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    db.upsertHole(round.round_id, 4, { strokes: 5, clubs_used: ['3W', '7i', 'GW'] });

    reload(db);
    assert.deepEqual(db.getHole(round.round_id, 4).clubs_used, ['3W', '7i', 'GW']);
  });

  test('no clubs selected is valid', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    const { hole, saved } = db.upsertHole(round.round_id, 1, { strokes: 4, clubs_used: [] });
    assert.equal(saved, true);
    assert.deepEqual(hole.clubs_used, []);
  });
});

describe('Short game and putts', () => {
  test('no short-game shots is the default and is recorded as 0', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 4, putts: 2 });
    assert.equal(hole.short_game_strokes, 0);
  });

  test('4+ short-game shots are supported, not collapsed into a category', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (const n of [4, 5, 6, 7]) {
      const { hole } = db.upsertHole(round.round_id, 1, { strokes: 9, short_game_strokes: n });
      assert.equal(hole.short_game_strokes, n);
    }
  });

  test('0 putts is allowed — a chip-in is a real outcome', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    const { hole, saved } = db.upsertHole(round.round_id, 1, { strokes: 3, short_game_strokes: 1, putts: 0 });
    assert.equal(saved, true);
    assert.equal(hole.putts, 0);
  });

  test('neither value can go below its floor', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 0, short_game_strokes: -3, putts: -1 });
    assert.equal(hole.strokes, 1);
    assert.equal(hole.short_game_strokes, 0);
    assert.equal(hole.putts, 0);
  });

  test('short game + putts exceeding strokes still saves exactly as entered', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);

    // §5.4 — advisory, never blocking. Reference C's own par-3 example.
    const { hole, saved } = db.upsertHole(round.round_id, 3, { strokes: 4, short_game_strokes: 2, putts: 2 });
    assert.equal(saved, true);
    assert.equal(hole.strokes, 4);
    assert.equal(hole.short_game_strokes + hole.putts, 4);
  });
});

describe('Correcting an earlier hole', () => {
  test('editing hole 3 mid-round leaves later holes untouched', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (const n of [1, 2, 3, 4, 5]) db.upsertHole(round.round_id, n, { strokes: 4, putts: 2 });

    db.upsertHole(round.round_id, 3, { strokes: 7, clubs_used: ['SW'] });

    assert.equal(db.getHole(round.round_id, 3).strokes, 7);
    assert.equal(db.getHole(round.round_id, 3).putts, 2);
    assert.equal(db.getHole(round.round_id, 4).strokes, 4);
    assert.equal(db.getHolesForRound(round.round_id).length, 5);
  });

  test('after correcting an earlier hole, play resumes at the next unplayed one', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (const n of [1, 2, 3, 4, 5, 6]) db.upsertHole(round.round_id, n, { strokes: 4 });

    // §5.5 — a golfer correcting hole 3 returns to where they were rather
    // than replaying holes 4, 5 and 6.
    assert.equal(firstUnplayed(db, round, 3), 7);
  });

  test('editing the last unplayed hole means the round is ready to finish', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4 });

    assert.equal(firstUnplayed(db, round, 9), null);
  });
});

describe('Incomplete holes and interrupted rounds', () => {
  test('a hole never opened is simply absent, never stored as 0', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });

    assert.equal(db.getHole(round.round_id, 2), null);
    assert.equal(db.roundHolesPlayed(round.round_id), 1);
  });

  test('a partially entered hole is kept exactly as far as it got', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);

    // Score bumped, then the golfer is interrupted before touching putts.
    db.upsertHole(round.round_id, 5, { strokes: 6 });
    reload(db);

    const hole = db.getHole(round.round_id, 5);
    assert.equal(hole.strokes, 6);
    assert.equal(hole.putts, 0);
    assert.equal(hole.short_game_strokes, 0);
  });

  test('an interrupted round resumes at the first unplayed hole', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 18 });
    for (const n of [1, 2, 3, 4, 5, 6, 7]) db.upsertHole(round.round_id, n, { strokes: 4 });
    db.pauseRound(round.round_id);

    reload(db);

    const resumed = db.getActiveRound();
    assert.equal(resumed.round_id, round.round_id);
    assert.equal(resumed.status, 'paused');
    assert.equal(firstUnplayed(db, resumed), 8);
    assert.equal(db.roundHolesPlayed(resumed.round_id), 7);
  });

  test('a round with every hole played resumes on the last hole, not past the end', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4 });

    reload(db);
    const resumed = db.getActiveRound();
    assert.equal(firstUnplayed(db, resumed) ?? resumed.hole_count, 9);
  });

  test('a skipped hole is where an interrupted round resumes', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    // The golfer jumped ahead, leaving hole 3 unplayed.
    for (const n of [1, 2, 4, 5]) db.upsertHole(round.round_id, n, { strokes: 4 });

    reload(db);
    assert.equal(firstUnplayed(db, db.getActiveRound()), 3);
  });
});

describe('App refresh during a round', () => {
  test('every completed hole survives a refresh mid-round', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 5, clubs_used: ['PW', '9i'], short_game_strokes: 1, putts: 2 });
    reload(db);
    db.upsertHole(round.round_id, 2, { strokes: 4, clubs_used: ['7i'], putts: 2 });
    reload(db);
    db.upsertHole(round.round_id, 3, { strokes: 3, putts: 1 });
    reload(db);

    const holes = db.getHolesForRound(round.round_id);
    assert.equal(holes.length, 3);
    assert.deepEqual(holes.map((h) => h.strokes), [5, 4, 3]);
    assert.deepEqual(holes[0].clubs_used, ['PW', '9i']);
    assert.equal(db.getActiveRound().round_id, round.round_id);
  });

  test('a refresh between two changes to the SAME hole keeps the later value', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });
    reload(db);
    db.upsertHole(round.round_id, 1, { strokes: 5 });
    reload(db);

    assert.equal(db.getHole(round.round_id, 1).strokes, 5);
    assert.equal(db.getHolesForRound(round.round_id).length, 1);
  });
});

describe('Finishing', () => {
  test('finishing on the final hole completes the round', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4, putts: 2 });

    db.finishRound(round.round_id);
    assert.equal(db.getRound(round.round_id).status, 'finished');
    assert.equal(db.getActiveRound(), null);
    assert.equal(db.listFinishedRounds().length, 1);
  });

  test('walking off after 7 of 18 records 7 holes', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 18 });
    for (let n = 1; n <= 7; n++) db.upsertHole(round.round_id, n, { strokes: 5 });

    // §5.6 — Finish Round is reachable at any point.
    db.finishRound(round.round_id);
    assert.equal(db.roundHolesPlayed(round.round_id), 7);
    assert.equal(db.getRound(round.round_id).hole_count, 18);
  });

  test('score to par is computed only over the holes actually played', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 18 });
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 5 });
    db.finishRound(round.round_id);

    const holes = db.getHolesForRound(round.round_id);
    const strokes = holes.reduce((s, h) => s + h.strokes, 0);
    const par = holes.reduce((s, h) => s + h.par, 0);
    assert.equal(strokes, 45);
    assert.equal(par, 35);
    assert.equal(strokes - par, 10);
  });

  test('a round finished with no holes played is discarded, not kept empty', async () => {
    const db = await resetDB();
    const { round } = await startRound(db);

    // §8 — the screen confirms, then discards.
    db.finishRound(round.round_id);
    assert.equal(db.roundHolesPlayed(round.round_id), 0);
    db.deleteRound(round.round_id);

    reload(db);
    assert.equal(db.getRound(round.round_id), null);
    assert.equal(db.listFinishedRounds().length, 0);
  });
});

describe('9 and 18 hole rounds', () => {
  test('a full 9 plays through and finishes', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 9 });
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4, clubs_used: ['7i'], putts: 2 });
    db.finishRound(round.round_id);

    reload(db);
    assert.equal(db.getHolesForRound(round.round_id).length, 9);
    assert.equal(db.getRound(round.round_id).hole_count, 9);
  });

  test('a full 18 plays through and finishes', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 18 });
    for (let n = 1; n <= 18; n++) db.upsertHole(round.round_id, n, { strokes: 5, clubs_used: ['Driver', '7i'], putts: 2 });
    db.finishRound(round.round_id);

    reload(db);
    const holes = db.getHolesForRound(round.round_id);
    assert.equal(holes.length, 18);
    assert.deepEqual(holes.map((h) => h.hole_number), Array.from({ length: 18 }, (_, i) => i + 1));
    assert.ok(holes.every((h) => h.clubs_used.length === 2));
  });

  test('a hole number beyond the round is refused', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { holeCount: 9 });
    assert.deepEqual(db.upsertHole(round.round_id, 10, { strokes: 4 }), { hole: null, saved: false });
  });
});

describe('Missing yardage and manual courses', () => {
  test('a manual course with no yardage still plays normally', async () => {
    const db = await resetDB();
    const { course, round } = await startRound(db, { courseName: 'Pine Ridge Muni' });

    assert.equal(course.source, 'manual');
    assert.ok(round.hole_defs.every((d) => d.yardage === null));
    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 4 });
    assert.equal(hole.yardage, null);
    assert.equal(hole.par, 4);
  });

  test('yardage shows on the holes that have it and is absent on the rest', async () => {
    const db = await resetDB();
    const { round } = await startRound(db, { yardages: [127, null, 410] });

    assert.equal(round.hole_defs[0].yardage, 127);
    assert.equal(round.hole_defs[1].yardage, null);
    assert.equal(db.upsertHole(round.round_id, 1, { strokes: 3 }).hole.yardage, 127);
    assert.equal(db.upsertHole(round.round_id, 2, { strokes: 4 }).hole.yardage, null);
  });

  test('a course remembers its pars for the next round there', async () => {
    const db = await resetDB();
    const allThrees = [3, 3, 3, 3, 3, 3, 3, 3, 3];
    const { course } = await startRound(db, { pars: allThrees });

    reload(db);
    const remembered = db.getCourse(course.course_id);
    assert.deepEqual(remembered.hole_defs.map((d) => d.par), allThrees);
    assert.equal(remembered.play_count, 1);
  });
});

describe('Range sessions are unaffected', () => {
  test('playing a round changes nothing about range history', async () => {
    const db = await resetDB();
    const session = db.createSession({
      date: '2026-09-16', start_time: '10:00', target_ball_count: 20,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    });
    db.finishSession(session.session_id);

    const { round } = await startRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4 });
    db.finishRound(round.round_id);

    reload(db);
    assert.equal(db.listSessions().length, 1);
    assert.equal(db.listFinishedSessions().length, 1);
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
    assert.equal(db.getAllShots().length, 1);
  });
});
