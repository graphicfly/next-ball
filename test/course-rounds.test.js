import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';

// Course Mode data layer — docs/course-mode-spec.md §6 (data captured),
// §4.3 (pars remembered per course), §5.3/§5.6 (persistence, holes actually
// played), §5.4 (advisory-only validation), §11.1 (rounds are a separate
// entity from sessions).
//
// Phase 1 is storage only: no screens, no routing, no analytics.

// Simulates a browser refresh / PWA relaunch / phone unlock: drops db.js's
// module-scope caches WITHOUT clearing localStorage, so the next read has to
// re-parse whatever was actually persisted. This is the only honest way to
// test "the round survived" — asserting against the in-memory object would
// pass even if nothing were ever written.
function reload(db) {
  db.__resetForTests();
}

async function makeManualCourse(db, { name = 'Oakmont Golf Center', city = 'Vienna', state = 'VA', holeCount = 9 } = {}) {
  return db.upsertCourse({ name, city, state, source: 'manual', hole_count: holeCount });
}

async function makeRound(db, { course = null, holeCount = 9, holeDefs, ...rest } = {}) {
  return db.createRound({
    course_id: course?.course_id ?? null,
    course_name: course?.name ?? 'Oakmont Golf Center',
    course_city: course?.city ?? 'Vienna',
    course_state: course?.state ?? 'VA',
    course_place_id: course?.place_id ?? null,
    course_source: course?.source ?? 'manual',
    hole_count: holeCount,
    hole_defs: holeDefs ?? course?.hole_defs,
    ...rest,
  });
}

describe('Creating a round', () => {
  test('creates an active round carrying a full course snapshot', async () => {
    const db = await resetDB();
    const course = await makeManualCourse(db);
    const round = await makeRound(db, { course });

    assert.ok(round.round_id);
    assert.equal(round.status, 'active');
    assert.equal(round.course_id, course.course_id);
    assert.equal(round.course_name, 'Oakmont Golf Center');
    assert.equal(round.course_city, 'Vienna');
    assert.equal(round.course_state, 'VA');
    assert.equal(round.course_source, 'manual');
    assert.equal(round.hole_count, 9);
    assert.equal(round.end_time, null);
    assert.equal(round.completed_at, null);
    assert.equal(round.data_source, 'real');
    assert.ok(round.date && round.start_time && round.created_at);
  });

  test('getActiveRound finds it; a finished round is no longer active', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    assert.equal(db.getActiveRound()?.round_id, round.round_id);

    db.upsertHole(round.round_id, 1, { strokes: 4 });
    db.finishRound(round.round_id);
    assert.equal(db.getActiveRound(), null);
  });

  test('a round is created with a full set of hole definitions from the standard template', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 9 });

    assert.equal(round.hole_defs.length, 9);
    assert.deepEqual(round.hole_defs.map((d) => d.hole_number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(round.hole_defs.map((d) => d.par), [4, 4, 3, 4, 5, 4, 3, 4, 4]);
    // Yardage is never invented (§4.3) — unknown stays null so display can
    // omit it rather than render "— yd".
    assert.ok(round.hole_defs.every((d) => d.yardage === null));
  });

  test('rounds and sessions are independent entities — neither appears in the other\'s lists', async () => {
    const db = await resetDB();
    const session = db.createSession({
      date: '2026-09-16', start_time: '10:00', target_ball_count: 20,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    });
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });

    // §11.1: the range path must need no type guards at all.
    assert.equal(db.listSessions().length, 1);
    assert.equal(db.listRounds().length, 1);
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
    assert.equal(db.getHolesForRound(round.round_id).length, 1);
    assert.equal(db.getAllShots().length, 1);
    assert.equal(db.getActiveSession().session_id, session.session_id);
    assert.equal(db.getActiveRound().round_id, round.round_id);
  });
});

describe('Saving a hole', () => {
  test('saves score, short game and putts, reporting the write succeeded', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    const { hole, saved } = db.upsertHole(round.round_id, 1, {
      strokes: 5, short_game_strokes: 1, putts: 2,
    });

    assert.equal(saved, true);
    assert.equal(hole.hole_number, 1);
    assert.equal(hole.strokes, 5);
    assert.equal(hole.short_game_strokes, 1);
    assert.equal(hole.putts, 2);
    assert.ok(hole.updated_at);
  });

  test('par and yardage default from the round\'s own hole definitions', async () => {
    const db = await resetDB();
    const round = await makeRound(db, {
      holeDefs: [{ hole_number: 1, par: 3, yardage: 127 }],
    });

    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 4 });
    assert.equal(hole.par, 3);
    assert.equal(hole.yardage, 127);
  });

  test('short game and putts default to 0, and a hole omitting strokes opens at par', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    const { hole } = db.upsertHole(round.round_id, 3, {});
    assert.equal(hole.par, 3);
    assert.equal(hole.strokes, 3); // §4.4 — the stepper opens at par
    assert.equal(hole.short_game_strokes, 0);
    assert.equal(hole.putts, 0);
    assert.deepEqual(hole.clubs_used, []);
  });

  test('a played hole keeps its own par even after the round\'s definitions are edited', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });
    assert.equal(db.getHole(round.round_id, 1).par, 4);

    const edited = round.hole_defs.map((d) => (d.hole_number === 1 ? { ...d, par: 5 } : d));
    db.updateRound(round.round_id, { hole_defs: edited });

    // The played hole snapshotted its par, exactly as a shot snapshots its
    // club — history is never rewritten underneath the golfer.
    assert.equal(db.getHole(round.round_id, 1).par, 4);
  });

  test('rejects a hole number outside the round without writing anything', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 9 });

    assert.deepEqual(db.upsertHole(round.round_id, 10, { strokes: 4 }), { hole: null, saved: false });
    assert.deepEqual(db.upsertHole(round.round_id, 0, { strokes: 4 }), { hole: null, saved: false });
    assert.equal(db.getHolesForRound(round.round_id).length, 0);
  });

  test('validation is advisory, never blocking: short game + putts may exceed strokes', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    // §5.4 / Reference C's own par-3 example. Storage records what the
    // golfer said; advising them is the hole screen's job.
    const { hole, saved } = db.upsertHole(round.round_id, 3, {
      strokes: 4, short_game_strokes: 2, putts: 2,
    });

    assert.equal(saved, true);
    assert.equal(hole.strokes, 4);
    assert.equal(hole.short_game_strokes, 2);
    assert.equal(hole.putts, 2);
  });
});

describe('Multiple clubs on one hole', () => {
  test('clubs_used stores more than one club, in the order given', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 5, clubs_used: ['9i', 'PW'] });
    assert.deepEqual(hole.clubs_used, ['9i', 'PW']);
  });

  test('survives a reload as a real multi-club set', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 6, clubs_used: ['Driver', '5i', 'SW'] });

    reload(db);
    assert.deepEqual(db.getHole(round.round_id, 1).clubs_used, ['Driver', '5i', 'SW']);
  });

  test('de-duplicates, trims, and drops non-strings — it is an unordered set with no counts', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    const { hole } = db.upsertHole(round.round_id, 1, {
      strokes: 5, clubs_used: ['9i', ' 9i ', 'PW', '', null, 7, 'pw'],
    });
    assert.deepEqual(hole.clubs_used, ['9i', 'PW']);
  });

  test('the putter is excluded — putts are counted in their own field', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    // §4.4/§6: including it would double-record the same strokes and imply
    // per-shot club tracking the feature does not do.
    const { hole } = db.upsertHole(round.round_id, 1, {
      strokes: 4, clubs_used: ['9i', 'Putter'], putts: 2,
    });
    assert.deepEqual(hole.clubs_used, ['9i']);
    assert.equal(hole.putts, 2);
  });

  test('an empty club set is valid and common', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    const { hole, saved } = db.upsertHole(round.round_id, 1, { strokes: 4, clubs_used: [] });
    assert.equal(saved, true);
    assert.deepEqual(hole.clubs_used, []);
  });
});

describe('Editing an earlier hole', () => {
  test('updates in place without creating a duplicate or disturbing other holes', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4, clubs_used: ['PW'], putts: 2 });
    db.upsertHole(round.round_id, 2, { strokes: 5, clubs_used: ['9i'], putts: 1 });
    db.upsertHole(round.round_id, 3, { strokes: 3, clubs_used: ['GW'], putts: 1 });

    // §5.5 — jump back to hole 1 mid-round and correct it.
    const { hole, saved } = db.upsertHole(round.round_id, 1, { strokes: 6, clubs_used: ['PW', 'SW'] });

    assert.equal(saved, true);
    assert.equal(db.getHolesForRound(round.round_id).length, 3);
    assert.equal(hole.strokes, 6);
    assert.deepEqual(hole.clubs_used, ['PW', 'SW']);
    // Untouched fields on the edited hole survive.
    assert.equal(hole.putts, 2);
    // Other holes are completely unaffected.
    assert.equal(db.getHole(round.round_id, 2).strokes, 5);
    assert.equal(db.getHole(round.round_id, 3).strokes, 3);
  });

  test('a partial edit touches only the fields supplied', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 4, { strokes: 5, clubs_used: ['7i'], short_game_strokes: 1, putts: 2 });

    db.upsertHole(round.round_id, 4, { putts: 3 });

    const hole = db.getHole(round.round_id, 4);
    assert.equal(hole.putts, 3);
    assert.equal(hole.strokes, 5);
    assert.equal(hole.short_game_strokes, 1);
    assert.deepEqual(hole.clubs_used, ['7i']);
  });

  test('an edit persists across a reload', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });
    db.upsertHole(round.round_id, 1, { strokes: 7 });

    reload(db);
    assert.equal(db.getHole(round.round_id, 1).strokes, 7);
    assert.equal(db.getHolesForRound(round.round_id).length, 1);
  });

  test('holes read back in hole order regardless of the order they were played', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 5, { strokes: 4 });
    db.upsertHole(round.round_id, 2, { strokes: 3 });
    db.upsertHole(round.round_id, 9, { strokes: 6 });

    assert.deepEqual(db.getHolesForRound(round.round_id).map((h) => h.hole_number), [2, 5, 9]);
  });
});

describe('Persisting and reloading an incomplete round', () => {
  test('an in-progress round and its holes survive a reload intact', async () => {
    const db = await resetDB();
    const course = await makeManualCourse(db);
    const round = await makeRound(db, { course });
    db.upsertHole(round.round_id, 1, { strokes: 4, clubs_used: ['PW'], putts: 2 });
    db.upsertHole(round.round_id, 2, { strokes: 5, clubs_used: ['9i', 'SW'], short_game_strokes: 1, putts: 2 });

    // Navigation, refresh, PWA close/reopen, phone lock — all the same thing
    // from storage's point of view (§5.3).
    reload(db);

    const resumed = db.getActiveRound();
    assert.equal(resumed.round_id, round.round_id);
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.course_name, 'Oakmont Golf Center');
    assert.equal(resumed.hole_count, 9);
    assert.equal(resumed.hole_defs.length, 9);

    const holes = db.getHolesForRound(round.round_id);
    assert.equal(holes.length, 2);
    assert.equal(holes[0].strokes, 4);
    assert.deepEqual(holes[1].clubs_used, ['9i', 'SW']);
    assert.equal(holes[1].short_game_strokes, 1);
  });

  test('each hole is persisted incrementally, not only when the round finishes', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    db.upsertHole(round.round_id, 1, { strokes: 4 });
    reload(db);
    assert.equal(db.roundHolesPlayed(round.round_id), 1);

    db.upsertHole(round.round_id, 2, { strokes: 5 });
    reload(db);
    assert.equal(db.roundHolesPlayed(round.round_id), 2);

    // Still unfinished the whole time — nothing about persistence waited for
    // the round to end.
    assert.equal(db.getRound(round.round_id).status, 'active');
    assert.equal(db.getRound(round.round_id).completed_at, null);
  });

  test('a paused round is still the active round after a reload', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });
    db.pauseRound(round.round_id);

    reload(db);
    assert.equal(db.getActiveRound()?.round_id, round.round_id);
    assert.equal(db.getActiveRound().status, 'paused');

    db.resumeRound(round.round_id);
    assert.equal(db.getRound(round.round_id).status, 'active');
  });

  test('unplayed holes are omitted entirely, never stored as 0', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 18 });
    for (const n of [1, 2, 3, 4, 5, 6, 7]) db.upsertHole(round.round_id, n, { strokes: 4 });

    reload(db);

    // §5.6 — a golfer who walks off after 7 holes records 7 holes.
    const holes = db.getHolesForRound(round.round_id);
    assert.equal(holes.length, 7);
    assert.equal(db.roundHolesPlayed(round.round_id), 7);
    assert.ok(holes.every((h) => h.strokes >= 1));
    assert.equal(db.getHole(round.round_id, 8), null);
  });

  test('two rounds keep their holes in separate chunks', async () => {
    const db = await resetDB();
    const first = await makeRound(db);
    db.upsertHole(first.round_id, 1, { strokes: 4 });
    db.finishRound(first.round_id);

    const second = await makeRound(db);
    db.upsertHole(second.round_id, 1, { strokes: 6 });

    reload(db);
    assert.equal(db.getHole(first.round_id, 1).strokes, 4);
    assert.equal(db.getHole(second.round_id, 1).strokes, 6);
  });
});

describe('Completing a round', () => {
  test('finishing stamps status, end time and a full-precision completion timestamp', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4, putts: 2 });

    const finished = db.finishRound(round.round_id);

    assert.equal(finished.status, 'finished');
    assert.match(finished.end_time, /^\d{2}:\d{2}$/);
    assert.ok(finished.completed_at);
    assert.equal(db.listFinishedRounds().length, 1);
    assert.equal(db.getActiveRound(), null);
  });

  test('a finished round and its holes survive a reload', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    for (let n = 1; n <= 9; n++) db.upsertHole(round.round_id, n, { strokes: 4 });
    db.finishRound(round.round_id);

    reload(db);
    assert.equal(db.getRound(round.round_id).status, 'finished');
    assert.equal(db.getHolesForRound(round.round_id).length, 9);
  });

  test('a round ended early records only the holes played', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 18 });
    for (let n = 1; n <= 7; n++) db.upsertHole(round.round_id, n, { strokes: 5 });

    db.finishRound(round.round_id);

    assert.equal(db.roundHolesPlayed(round.round_id), 7);
    assert.equal(db.getRound(round.round_id).hole_count, 18);
  });

  test('a finished round can be deleted; an in-progress one cannot', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });

    assert.throws(() => db.deleteRound(round.round_id), (err) => err.code === 'active_round');

    db.finishRound(round.round_id);
    const removed = db.deleteRound(round.round_id);
    assert.equal(removed.round.round_id, round.round_id);
    assert.equal(removed.holes.length, 1);

    reload(db);
    assert.equal(db.getRound(round.round_id), null);
    assert.equal(db.getHolesForRound(round.round_id).length, 0);
  });
});

describe('Manual course', () => {
  test('a manual course needs only a name, and is marked as not provider-backed', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Pine Ridge Muni', source: 'manual' });

    assert.ok(course.course_id);
    assert.equal(course.name, 'Pine Ridge Muni');
    assert.equal(course.source, 'manual');
    assert.equal(course.place_id, null);
    assert.equal(course.provider, null);
    assert.equal(db.isProviderBackedCourse(course), false);
    // City/State are optional (§4.2) and stay null rather than empty strings.
    assert.equal(course.city, null);
    assert.equal(course.state, null);
    assert.equal(course.hole_count, 9);
  });

  test('a provider-backed course keeps its place id and provider', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({
      name: 'Reston National Golf Course', city: 'Reston', state: 'VA',
      source: 'gps_place', place_id: 'way/12345', latitude: 38.9, longitude: -77.3, hole_count: 18,
    });

    assert.equal(course.source, 'gps_place');
    assert.equal(course.place_id, 'way/12345');
    assert.equal(course.provider, 'osm');
    assert.equal(db.isProviderBackedCourse(course), true);
    assert.equal(db.findCourseByPlaceId('way/12345').course_id, course.course_id);
  });

  test('re-entering the same manual course updates one record rather than duplicating it', async () => {
    const db = await resetDB();
    const first = db.upsertCourse({ name: 'Pine Ridge Muni', city: 'Vienna', source: 'manual' });
    const second = db.upsertCourse({ name: 'pine ridge muni', city: 'vienna', state: 'VA', source: 'manual' });

    assert.equal(second.course_id, first.course_id);
    assert.equal(db.listCourses().length, 1);
    assert.equal(second.state, 'VA');
  });

  test('a course with no name is rejected', async () => {
    const db = await resetDB();
    assert.equal(db.upsertCourse({ name: '   ', source: 'manual' }), null);
    assert.equal(db.upsertCourse({}), null);
    assert.equal(db.listCourses().length, 0);
  });

  test('a round carries the course snapshot even after the course is renamed', async () => {
    const db = await resetDB();
    const course = await makeManualCourse(db, { name: 'Oakmont Golf Center' });
    const round = await makeRound(db, { course });

    db.upsertCourse({ name: 'Oakmont Golf Club', city: 'Vienna', source: 'manual' });
    // Renaming via a new record must not rewrite the played round's history.
    reload(db);
    assert.equal(db.getRound(round.round_id).course_name, 'Oakmont Golf Center');
  });

  test('pars are remembered per course, so the next round there starts pre-filled', async () => {
    const db = await resetDB();
    const course = await makeManualCourse(db);
    const customPars = db.defaultHoleDefs(9).map((d) => ({ ...d, par: 3 }));

    const round = await makeRound(db, { course, holeDefs: customPars });
    db.recordCoursePlayed(course.course_id, { hole_count: round.hole_count, hole_defs: round.hole_defs });

    reload(db);
    const remembered = db.getCourse(course.course_id);
    assert.deepEqual(remembered.hole_defs.map((d) => d.par), [3, 3, 3, 3, 3, 3, 3, 3, 3]);
    assert.equal(remembered.play_count, 1);
    assert.ok(remembered.last_played_at);
    // §4.2 — Select a Course surfaces exactly one recent course.
    assert.equal(db.getRecentCourse().course_id, course.course_id);
  });

  test('a course that has never been played is not offered as the recent course', async () => {
    const db = await resetDB();
    await makeManualCourse(db, { name: 'Never Played' });
    assert.equal(db.getRecentCourse(), null);
    assert.equal(db.listCourses().length, 1);
  });
});

describe('Missing yardage', () => {
  test('yardage stays null when unknown, on both definitions and played holes', async () => {
    const db = await resetDB();
    const round = await makeRound(db);

    assert.ok(round.hole_defs.every((d) => d.yardage === null));
    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 4 });
    assert.equal(hole.yardage, null);
    // Par is still known from the template, so "Par 4" renders without a
    // yardage half (§8: never "— yd").
    assert.equal(hole.par, 4);
  });

  test('yardage is recorded when a source does provide it', async () => {
    const db = await resetDB();
    const round = await makeRound(db, {
      holeDefs: [{ hole_number: 1, par: 3, yardage: 127 }, { hole_number: 2, par: 4 }],
    });

    assert.equal(round.hole_defs[0].yardage, 127);
    assert.equal(round.hole_defs[1].yardage, null);
    assert.equal(db.upsertHole(round.round_id, 1, { strokes: 3 }).hole.yardage, 127);
    assert.equal(db.upsertHole(round.round_id, 2, { strokes: 4 }).hole.yardage, null);
  });

  test('unusable yardage and par values degrade to null rather than being invented', async () => {
    const db = await resetDB();
    const round = await makeRound(db, {
      holeDefs: [{ hole_number: 1, par: 'abc', yardage: 'unknown' }],
    });

    // Par falls back to the template rather than becoming null, since the
    // score stepper needs a value to open on (§4.4).
    assert.equal(round.hole_defs[0].par, 4);
    assert.equal(round.hole_defs[0].yardage, null);

    const { hole } = db.upsertHole(round.round_id, 1, { strokes: 4, yardage: -20 });
    assert.equal(hole.yardage, null);
  });

  test('a par explicitly set to null is preserved as unknown', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    const { hole } = db.upsertHole(round.round_id, 1, { par: null, strokes: 4 });
    assert.equal(hole.par, null);
  });
});

describe('9-hole and 18-hole rounds', () => {
  test('a 9-hole round defines 9 holes at par 35', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 9 });

    assert.equal(round.hole_count, 9);
    assert.equal(round.hole_defs.length, 9);
    assert.equal(round.hole_defs.reduce((sum, d) => sum + d.par, 0), 35);
  });

  test('an 18-hole round is two standard nines at par 70', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 18 });

    assert.equal(round.hole_count, 18);
    assert.equal(round.hole_defs.length, 18);
    assert.deepEqual(round.hole_defs.map((d) => d.par).slice(9), [4, 4, 3, 4, 5, 4, 3, 4, 4]);
    assert.equal(round.hole_defs.reduce((sum, d) => sum + d.par, 0), 70);
  });

  test('all 18 holes can be played, persisted and read back', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 18 });
    for (let n = 1; n <= 18; n++) {
      db.upsertHole(round.round_id, n, { strokes: 4 + (n % 3), clubs_used: ['7i', 'PW'], putts: 2 });
    }
    db.finishRound(round.round_id);

    reload(db);
    const holes = db.getHolesForRound(round.round_id);
    assert.equal(holes.length, 18);
    assert.deepEqual(holes.map((h) => h.hole_number), Array.from({ length: 18 }, (_, i) => i + 1));
    assert.ok(holes.every((h) => h.clubs_used.length === 2));
  });

  test('an unsupported hole count falls back to 9 rather than producing a malformed round', async () => {
    const db = await resetDB();
    const round = await makeRound(db, { holeCount: 12 });
    assert.equal(round.hole_count, 9);
    assert.equal(round.hole_defs.length, 9);
  });

  test('a course remembers whether it is a 9 or an 18', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'Big Course', source: 'manual', hole_count: 18 });
    assert.equal(course.hole_count, 18);
    assert.equal(course.hole_defs.length, 18);
  });
});

describe('Backward compatibility', () => {
  test('an index written before Course Mode gains the new collections on read', async () => {
    const db = await resetDB();
    // Exactly the shape schemaVersion 2 wrote: no rounds, no courses.
    globalThis.localStorage.setItem('rangelog_index_v1', JSON.stringify({
      schemaVersion: 2,
      sessions: [],
      goals: [],
      settings: { theme: 'dark' },
    }));
    reload(db);

    assert.deepEqual(db.listRounds(), []);
    assert.deepEqual(db.listCourses(), []);
    assert.equal(db.getActiveRound(), null);
    assert.equal(db.getRecentCourse(), null);
    // The legacy index is not rewritten just by being read.
    assert.equal(db.getSettings().theme, 'dark');
  });

  test('a JSON backup round-trips rounds, courses and holes without loss', async () => {
    const db = await resetDB();
    const course = await makeManualCourse(db);
    const round = await makeRound(db, { course });
    db.upsertHole(round.round_id, 1, { strokes: 4, clubs_used: ['PW', '9i'], putts: 2 });
    db.upsertHole(round.round_id, 2, { strokes: 5 });
    db.finishRound(round.round_id);
    db.recordCoursePlayed(course.course_id, { hole_count: 9, hole_defs: round.hole_defs });

    const backup = db.exportFullDB();
    assert.equal(backup.rounds.length, 1);
    assert.equal(backup.courses.length, 1);
    assert.equal(backup.holes.length, 2);

    // Wipe, then restore from the backup.
    db.importFullDB({ schemaVersion: 3, sessions: [], shots: [], settings: {} });
    assert.equal(db.listRounds().length, 0);

    db.importFullDB(backup);
    reload(db);

    assert.equal(db.listRounds().length, 1);
    assert.equal(db.listCourses().length, 1);
    assert.equal(db.getRound(round.round_id).course_name, 'Oakmont Golf Center');
    assert.deepEqual(db.getHole(round.round_id, 1).clubs_used, ['PW', '9i']);
    assert.equal(db.getHolesForRound(round.round_id).length, 2);
  });

  test('restoring a pre-Course-Mode backup clears rounds and leaves no orphaned hole data', async () => {
    const db = await resetDB();
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });

    // A backup taken before Course Mode existed simply has no rounds key.
    db.importFullDB({ schemaVersion: 2, sessions: [], shots: [], goals: [], settings: {} });
    reload(db);

    assert.equal(db.listRounds().length, 0);
    assert.equal(globalThis.localStorage.getItem(`rangelog_holes_v1_${round.round_id}`), null);
  });

  test('importing a backup preserves range sessions and shots alongside rounds', async () => {
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
    const round = await makeRound(db);
    db.upsertHole(round.round_id, 1, { strokes: 4 });
    db.finishRound(round.round_id);

    const backup = db.exportFullDB();
    db.importFullDB(backup);
    reload(db);

    assert.equal(db.listSessions().length, 1);
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
    assert.equal(db.listRounds().length, 1);
    assert.equal(db.getHolesForRound(round.round_id).length, 1);
  });

  test('test rounds are marked as such, exactly like test sessions', async () => {
    const db = await resetDB();
    const real = await makeRound(db);
    const seeded = await makeRound(db, { data_source: 'test' });

    assert.equal(real.data_source, 'real');
    assert.equal(seeded.data_source, 'test');
  });
});
