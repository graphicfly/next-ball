import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import { buildCourseGeometry, teeSetsFromGeometry } from '../js/courseGeometry.js';
import { setHoleEntryState, getHoleEntryState, clearHoleEntryState } from '../js/state.js';

// Hole Entry GPS integration — docs/course-mode-spec.md §14.4.
//
// Two decisions are made here and nowhere else: whether the View Map pill
// appears for a given hole, and what survives a trip to the map and back.

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures-oakmont-osm.json', import.meta.url), 'utf8'));
const OAKMONT = buildCourseGeometry(FIXTURE.elements, { fetchedAt: '2026-09-17T00:00:00.000Z' });

// Oakmont with holes 2, 5 and 7's greens removed — the "6 of 9 greens
// mapped" course §14.4 describes.
function partialGeometry(missing = [2, 5, 7]) {
  const g = JSON.parse(JSON.stringify(OAKMONT));
  for (const h of g.holes) if (missing.includes(h.hole_number)) h.green = null;
  return g;
}

async function seedRound(db, geometry, teeId = 'blue') {
  const c = db.upsertCourse({ name: 'Oakmont Golf Center', source: 'manual', hole_count: 9 });
  db.setCourseGeometry(c.course_id, geometry, teeSetsFromGeometry(OAKMONT, 9));
  db.setSelectedTee(c.course_id, teeId);
  const holeDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId });
  const round = db.createRound({
    course_id: c.course_id, course_name: c.name, course_source: 'manual',
    hole_count: 9, hole_defs: holeDefs, tee_id: teeId, tee_name: teeId,
  });
  return { course: c, round };
}

describe('View Map availability is per hole, not per course (§14.4)', () => {
  test('a fully traced course offers the map on every hole', async () => {
    const db = await resetDB();
    const { course } = await seedRound(db, OAKMONT);
    for (let n = 1; n <= 9; n++) {
      assert.ok(db.getGreenForHole(course.course_id, n)?.centroid, `hole ${n}`);
    }
  });

  test('6 of 9 greens mapped offers it on exactly those 6', async () => {
    const db = await resetDB();
    const { course } = await seedRound(db, partialGeometry());
    const available = [];
    for (let n = 1; n <= 9; n++) {
      if (db.getGreenForHole(course.course_id, n)?.centroid) available.push(n);
    }
    assert.deepEqual(available, [1, 3, 4, 6, 8, 9]);
  });

  // The brief's rule: not merely because the course has OSM features.
  test('a course with tee geometry but no greens offers it nowhere', async () => {
    const db = await resetDB();
    const noGreens = JSON.parse(JSON.stringify(OAKMONT));
    for (const h of noGreens.holes) h.green = null;
    noGreens.greens = [];
    const { course } = await seedRound(db, noGreens);
    for (let n = 1; n <= 9; n++) {
      assert.equal(db.getGreenForHole(course.course_id, n), null, `hole ${n}`);
    }
    // ...while the published yardages still work, so the header is unchanged.
    assert.equal(db.totalYardsForTee(course.course_id, { holeCount: 9, teeId: 'blue' }), 1374);
  });

  test('an unmapped course offers it nowhere and still plays normally', async () => {
    const db = await resetDB();
    const c = db.upsertCourse({ name: 'Hand Typed Muni', source: 'manual', hole_count: 9 });
    assert.equal(db.getGreenForHole(c.course_id, 1), null);
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.equal(defs.length, 9);
    assert.ok(defs.every((d) => Number.isFinite(d.par)));
  });

  test('a deleted course mid-round removes the affordance rather than erroring', async () => {
    const db = await resetDB();
    const { course, round } = await seedRound(db, OAKMONT);
    assert.ok(db.getGreenForHole(course.course_id, 4));
    // The round keeps its own snapshot, so scoring is unaffected.
    assert.equal(db.getGreenForHole('gone', 4), null);
    assert.equal(db.getRound(round.round_id).hole_defs.length, 9);
  });

  test('the green a hole offers is the one measured for it', async () => {
    const db = await resetDB();
    const { course } = await seedRound(db, OAKMONT);
    const g4 = db.getGreenForHole(course.course_id, 4);
    assert.ok(g4.polygon.length >= 3, 'the full ring, so front/back can be computed live');
    assert.equal(g4.source, 'osm');
    assert.notEqual(
      JSON.stringify(g4.centroid),
      JSON.stringify(db.getGreenForHole(course.course_id, 5).centroid),
      'each hole gets its own green',
    );
  });
});

describe('Published yardage in the header is the selected tee (§14.6)', () => {
  test('the round snapshots the tee the golfer chose', async () => {
    const db = await resetDB();
    const { round } = await seedRound(db, OAKMONT, 'blue');
    const yards = round.hole_defs.map((d) => d.yardage);
    assert.deepEqual(yards, [124, 157, 178, 190, 165, 138, 174, 111, 137]);
  });

  test('a different tee gives a different header on the same hole', async () => {
    const db = await resetDB();
    const { round } = await seedRound(db, OAKMONT, 'red');
    assert.equal(round.hole_defs.find((d) => d.hole_number === 1).yardage, 101);
    assert.equal(round.hole_defs.find((d) => d.hole_number === 8).yardage, 84);
  });

  test('yardage stays null rather than invented when unknown', async () => {
    const db = await resetDB();
    const c = db.upsertCourse({ name: 'Hand Typed Muni', source: 'manual', hole_count: 9 });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.ok(defs.every((d) => d.yardage === null), 'the separator and value are both omitted');
  });
});

describe('Hole-entry state survives the map round trip (§14.4)', () => {
  test('score, clubs, short game and putts all come back', async () => {
    clearHoleEntryState();
    const draft = { strokes: 6, clubs_used: ['7i', 'PW'], short_game_strokes: 1, putts: 2 };
    setHoleEntryState('r1', 4, draft);
    const back = getHoleEntryState('r1');
    assert.equal(back.holeNumber, 4);
    assert.deepEqual(back.draft, draft);
  });

  test('it is scoped to its round, so a finished round cannot seed the next', async () => {
    clearHoleEntryState();
    setHoleEntryState('r1', 7, { strokes: 9, clubs_used: [] });
    assert.equal(getHoleEntryState('r2'), null);
    assert.ok(getHoleEntryState('r1'));
  });

  test('clearing removes it entirely', async () => {
    setHoleEntryState('r1', 3, { strokes: 4, clubs_used: [] });
    clearHoleEntryState();
    assert.equal(getHoleEntryState('r1'), null);
  });

  // Hole entry mutates its draft on every tap. If the stored object were
  // handed back by reference those taps would rewrite the memory of where
  // the golfer was, and a second read would return the mutated values.
  test('the stored draft cannot be mutated through a read', async () => {
    clearHoleEntryState();
    setHoleEntryState('r1', 4, { strokes: 5, clubs_used: ['7i'] });
    const a = getHoleEntryState('r1');
    a.draft.strokes = 99;
    a.draft.clubs_used.push('Driver');
    assert.deepEqual(getHoleEntryState('r1').draft, { strokes: 5, clubs_used: ['7i'] });
  });

  test('nor through the object handed in', async () => {
    clearHoleEntryState();
    const mine = { strokes: 5, clubs_used: ['7i'] };
    setHoleEntryState('r1', 4, mine);
    mine.strokes = 99;
    mine.clubs_used.push('Driver');
    assert.deepEqual(getHoleEntryState('r1').draft, { strokes: 5, clubs_used: ['7i'] });
  });

  // The reason this is memory and not storage: writing the draft on the way
  // to the map would turn a hole the golfer merely looked at into a played
  // one — counted in holes played, skipped by Save + Next Hole, and present
  // in the round summary.
  test('remembering a hole writes nothing to the round', async () => {
    const db = await resetDB();
    const { round } = await seedRound(db, OAKMONT);
    db.upsertHole(round.round_id, 1, { strokes: 4, putts: 2 });
    const before = db.roundHolesPlayed(round.round_id);

    setHoleEntryState(round.round_id, 5, { strokes: 3, clubs_used: [], short_game_strokes: 0, putts: 0 });
    assert.equal(db.roundHolesPlayed(round.round_id), before, 'no phantom hole');
    assert.equal(db.getHole(round.round_id, 5), null);
    clearHoleEntryState();
  });
});
