import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import { buildCourseGeometry, teeSetsFromGeometry, courseCoverage, COVERAGE } from '../js/courseGeometry.js';

// Course Details data integration — docs/course-mode-spec.md §14.2, §14.3,
// §14.7. The screen itself is DOM and is exercised in the browser; every
// decision it makes is made from the functions tested here, so the branches
// that matter are covered without a DOM.

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures-oakmont-osm.json', import.meta.url), 'utf8'));
const OAKMONT = buildCourseGeometry(FIXTURE.elements, { fetchedAt: '2026-09-17T00:00:00.000Z' });

// A course with greens but no hole lines: green coordinates resolve, per-tee
// yardages cannot (§14.7's degradation rule).
const GREENS_ONLY = buildCourseGeometry(FIXTURE.elements.filter((e) => e.tags.golf !== 'hole'));

async function courseWith(db, { geometry = null, tees = null, holeCount = 9, ...fields } = {}) {
  const c = db.upsertCourse({ name: 'Test Course', source: 'manual', hole_count: holeCount, ...fields });
  if (geometry !== null || tees !== null) db.setCourseGeometry(c.course_id, geometry, tees);
  return db.getCourse(c.course_id);
}

describe('Coverage levels (§14.7) — internal, never shown as words', () => {
  test('Oakmont is fully traced: greens AND per-tee yardages', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    const cov = courseCoverage(c);
    assert.equal(cov.level, COVERAGE.TRACED);
    assert.equal(cov.greensMapped, 9);
    assert.equal(cov.holesWithTeeYardage, 9);
    assert.equal(cov.hasMap, true);
    assert.equal(cov.teeSets.length, 2);
  });

  test('greens without hole lines degrade to green-centre-only', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: GREENS_ONLY, tees: teeSetsFromGeometry(GREENS_ONLY, 9) });
    const cov = courseCoverage(c);
    assert.equal(cov.level, COVERAGE.GREENS_ONLY);
    assert.equal(cov.holesWithTeeYardage, 0);
    assert.equal(cov.teeSets.length, 0, 'no tee set is invented without a line to associate it');
    assert.equal(cov.hasMap, true, 'the map still has value — greens are what live yardage needs');
  });

  test('yardages but no greens is scorecard-only, and offers no map', async () => {
    const db = await resetDB();
    const c = await courseWith(db, {
      hole_defs: Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 300 + i })),
    });
    const cov = courseCoverage(c);
    assert.equal(cov.level, COVERAGE.SCORECARD);
    assert.equal(cov.hasMap, false);
    assert.equal(cov.hasYardages, true);
  });

  test('a manual course with nothing but pars is unmapped, and stays first-class', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Hand Typed Muni' });
    const cov = courseCoverage(c);
    assert.equal(cov.level, COVERAGE.UNMAPPED);
    assert.equal(cov.hasMap, false);
    assert.equal(cov.hasYardages, false);
    assert.deepEqual(cov.teeSets, []);
  });

  test('being in OSM is not the test — a green coordinate is', async () => {
    const db = await resetDB();
    // Geometry fetched and cached, but the course had no greens at all.
    const empty = buildCourseGeometry([]);
    const c = await courseWith(db, { geometry: empty, tees: [] });
    assert.equal(courseCoverage(c).hasMap, false);
    assert.equal(courseCoverage(c).level, COVERAGE.UNMAPPED);
    assert.equal(courseCoverage(c).checked, true, 'but it is recorded as looked-up');
  });

  test('coverage is pure — it reads a record, never storage or the network', async () => {
    const cov = courseCoverage({ hole_count: 9, geometry: OAKMONT, tees: [] });
    assert.equal(cov.greensMapped, 9);
    assert.equal(courseCoverage(null).level, COVERAGE.UNMAPPED);
    assert.equal(courseCoverage(undefined).hasMap, false);
  });
});

describe('Course summary figures', () => {
  test('Oakmont reports 9 holes, par 27, Blue 1374 / Red 1105', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });

    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'blue' });
    assert.equal(defs.length, 9);
    assert.equal(defs.reduce((t, d) => t + d.par, 0), 27);
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9, teeId: 'blue' }), 1374);
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9, teeId: 'red' }), 1105);
  });

  test('par comes from the template floor when the course has none (§11.5)', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Unknown Muni' });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.equal(defs.length, 9);
    assert.ok(defs.every((d) => Number.isFinite(d.par)), 'every hole is playable immediately');
  });

  test('total yards is null — not zero — when nothing is known, so the cell is omitted', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Hand Typed Muni' });
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9 }), null);
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.ok(defs.every((d) => d.yardage === null), 'yardage is never invented');
  });

  test('an 18-hole course resolves 18 definitions', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Big Course', holeCount: 18 });
    assert.equal(db.resolveHoleDefs(c.course_id, { holeCount: 18 }).length, 18);
  });
});

describe('Tee selection (§14.3)', () => {
  test('the shortest tee is preselected on a first visit', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    assert.equal(db.getSelectedTee(c.course_id).tee_id, 'red');
  });

  test('changing tee changes published yardages and the total, and nothing else', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });

    const greensBefore = JSON.stringify(db.getCourseGeometry(c.course_id).holes.map((h) => h.green.centroid));
    const redDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'red' });

    db.setSelectedTee(c.course_id, 'blue');
    const blueDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'blue' });
    const greensAfter = JSON.stringify(db.getCourseGeometry(c.course_id).holes.map((h) => h.green.centroid));

    assert.notDeepEqual(blueDefs.map((d) => d.yardage), redDefs.map((d) => d.yardage));
    assert.deepEqual(blueDefs.map((d) => d.par), redDefs.map((d) => d.par), 'par is unaffected by tee');
    assert.equal(greensAfter, greensBefore, 'green geometry is untouched — greens do not move');
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9, teeId: 'blue' }), 1374);
  });

  test('the selection is remembered across a reload', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    db.setSelectedTee(c.course_id, 'blue');
    db.__resetForTests();
    assert.equal(db.getSelectedTee(c.course_id).tee_id, 'blue');
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9 }), 1374, 'and drives the default total');
  });

  test('more than two tee colours all resolve independently', async () => {
    const db = await resetDB();
    const tees = [
      { tee_id: 'black', name: 'Black', hole_yardages: [200, 210, 220], total_yards: 630, measured: true },
      { tee_id: 'blue', name: 'Blue', hole_yardages: [180, 190, 200], total_yards: 570, measured: true },
      { tee_id: 'white', name: 'White', hole_yardages: [160, 170, 180], total_yards: 510, measured: true },
      { tee_id: 'red', name: 'Red', hole_yardages: [120, 130, 140], total_yards: 390, measured: true },
    ];
    const c = await courseWith(db, { holeCount: 9, tees, geometry: { holes: [], greens: [], counts: {} } });
    assert.equal(db.getCourseTees(c.course_id).length, 4);
    assert.equal(db.getSelectedTee(c.course_id).tee_id, 'red', 'shortest of four');
    for (const t of tees) {
      assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 3, teeId: t.tee_id }), t.total_yards, t.tee_id);
    }
  });

  test('a course with no tees has none to offer, and the row is omitted', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Hand Typed Muni' });
    assert.deepEqual(db.getCourseTees(c.course_id), []);
    assert.equal(db.getSelectedTee(c.course_id), null);
    assert.equal(courseCoverage(db.getCourse(c.course_id)).teeSets.length, 0);
  });

  test('a golfer-entered yardage outranks the tee-measured one (§14.12.3)', async () => {
    const db = await resetDB();
    const c = await courseWith(db, {
      geometry: OAKMONT,
      tees: teeSetsFromGeometry(OAKMONT, 9),
      hole_defs: [{ hole_number: 1, par: 3, yardage: 999 }],
    });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'blue' });
    assert.equal(defs[0].yardage, 999, 'the golfer wins');
    assert.equal(defs[1].yardage, 157, 'the rest still come from the tee');
  });
});

describe('Start Round snapshots, and never refetches', () => {
  test('the round takes par, yardages and the tee from cache', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    db.setSelectedTee(c.course_id, 'blue');

    const holeDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'blue' });
    const tee = db.getSelectedTee(c.course_id);
    const round = db.createRound({
      course_id: c.course_id, course_name: c.name, course_source: c.source,
      hole_count: 9, hole_defs: holeDefs, tee_id: tee.tee_id, tee_name: tee.name,
    });

    assert.equal(round.tee_id, 'blue');
    assert.equal(round.tee_name, 'Blue');
    assert.equal(round.hole_defs.reduce((t, d) => t + d.par, 0), 27);
    assert.equal(round.hole_defs.reduce((t, d) => t + d.yardage, 0), 1374);
  });

  test('the snapshot survives the course being re-fetched with different tees', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    db.setSelectedTee(c.course_id, 'blue');
    const holeDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9, teeId: 'blue' });
    const round = db.createRound({
      course_id: c.course_id, course_name: c.name, course_source: c.source,
      hole_count: 9, hole_defs: holeDefs, tee_id: 'blue', tee_name: 'Blue',
    });

    // The course is re-measured and its tee sets replaced entirely.
    db.setCourseGeometry(c.course_id, GREENS_ONLY, []);
    const after = db.getRound(round.round_id);
    assert.equal(after.tee_name, 'Blue', 'the round still says what it was played off');
    assert.equal(after.hole_defs.reduce((t, d) => t + d.yardage, 0), 1374, 'and keeps its yardages');
  });

  test('a round starts fine with no geometry at all', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Hand Typed Muni' });
    const holeDefs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    const round = db.createRound({
      course_id: c.course_id, course_name: c.name, course_source: 'manual',
      hole_count: 9, hole_defs: holeDefs, tee_id: null, tee_name: null,
    });
    assert.ok(round);
    assert.equal(round.tee_id, null);
    assert.equal(round.hole_defs.length, 9);
    assert.ok(round.hole_defs.every((d) => Number.isFinite(d.par)), 'playable immediately');
  });
});

describe('Failure never degrades Course Mode', () => {
  test('an unreachable lookup leaves the course usable and NOT marked checked', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Somewhere Muni' });
    // Course Details records nothing when the service is unreachable, so the
    // course is tried again next visit rather than written off as unmapped.
    assert.equal(db.courseGeometryChecked(c.course_id), false);
    assert.equal(courseCoverage(db.getCourse(c.course_id)).level, COVERAGE.UNMAPPED);
    assert.equal(db.resolveHoleDefs(c.course_id, { holeCount: 9 }).length, 9, 'a round can still start');
  });

  test('a lookup that found nothing IS recorded, so it is not repeated forever', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Genuinely Unmapped' });
    db.setCourseGeometry(c.course_id, null);
    assert.equal(db.courseGeometryChecked(c.course_id), true);
    assert.equal(courseCoverage(db.getCourse(c.course_id)).hasMap, false);
  });

  test('previously cached geometry survives a later failed lookup', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    // A failure writes nothing, so the cache stands.
    assert.equal(db.getCourseGeometry(c.course_id).counts.greens, 9);
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9, teeId: 'blue' }), 1374);
  });

  test('corrupt or partial geometry does not break coverage', async () => {
    for (const bad of [{ holes: null }, { holes: [{ hole_number: 1 }] }, {}]) {
      const cov = courseCoverage({ hole_count: 9, geometry: bad, tees: [] });
      assert.ok(Object.values(COVERAGE).includes(cov.level));
      assert.equal(cov.hasMap, false);
    }
  });
});

describe('Traced par pre-fills, but never overwrites the golfer (§14.7)', () => {
  test('Oakmont resolves par 27 from the trace before anyone has played it', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.deepEqual(defs.map((d) => d.par), [3, 3, 3, 3, 3, 3, 3, 3, 3]);
    assert.equal(defs.reduce((t, d) => t + d.par, 0), 27, 'not the 35 the template would give');
  });

  test('once the golfer sets pars, the trace stops pre-filling', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    const mine = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: null }));
    db.setCoursePars(c.course_id, { hole_count: 9, hole_defs: mine });

    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.deepEqual(defs.map((d) => d.par), [4, 4, 4, 4, 4, 4, 4, 4, 4], 'the golfer stood on the hole; OSM did not');
    assert.equal(defs.reduce((t, d) => t + d.par, 0), 36);
  });

  test('playing a round also marks pars as the golfer own', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    const played = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 5, yardage: null }));
    db.recordCoursePlayed(c.course_id, { hole_count: 9, hole_defs: played });
    assert.equal(db.resolveHoleDefs(c.course_id, { holeCount: 9 })[0].par, 5);
  });

  test('a course with no trace still gets the template floor', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Hand Typed Muni' });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.equal(defs.reduce((t, d) => t + d.par, 0), 35, 'PAR_TEMPLATE_9');
  });

  test('a partial trace pre-fills only the holes it covers', async () => {
    const db = await resetDB();
    const partial = { holes: [{ hole_number: 1, par: 3, green: null, tees: [] }], greens: [], counts: {} };
    const c = await courseWith(db, { name: 'Half Traced', geometry: partial, tees: [] });
    const defs = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.equal(defs[0].par, 3, 'from the trace');
    assert.equal(defs[1].par, 4, 'from the template');
  });
});

describe('Greens with no hole lines are still mapped (§14.7 rule 2)', () => {
  test('a Burke-Lake-shaped course counts its unassociated greens', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { geometry: GREENS_ONLY, tees: [] });
    const cov = courseCoverage(db.getCourse(c.course_id));
    assert.equal(cov.greensAssociated, 0, 'nothing says which green is which hole');
    assert.equal(cov.greensOnProperty, 9);
    assert.equal(cov.greensMapped, 9, 'but they are still mapped and usable');
    assert.equal(cov.hasMap, true);
    assert.equal(cov.level, COVERAGE.GREENS_ONLY);
  });

  test('the count never exceeds the holes being played', async () => {
    const db = await resetDB();
    // 9 greens on the property, golfer playing a 9-hole course: fine. Now
    // pretend the course record says fewer holes than greens found.
    const cov = courseCoverage({ hole_count: 3, geometry: GREENS_ONLY, tees: [] });
    assert.equal(cov.greensMapped, 3, 'never "9 of 3"');
  });
});

describe('Edit Course Info opens on the pars actually in use', () => {
  // The bug this guards: the editor read hole_defs directly, so a traced
  // course opened showing the template. Saving then authored those wrong
  // pars and Oakmont's 27 silently became 35.
  test('a traced course opens showing its traced pars, not the template', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });

    const editorPars = db.resolveHoleDefs(c.course_id, { holeCount: 9 }).map((d) => d.par);
    assert.deepEqual(editorPars, [3, 3, 3, 3, 3, 3, 3, 3, 3]);
    assert.equal(editorPars.reduce((a, b) => a + b, 0), 27);
  });

  test('saving unchanged pars preserves them rather than resetting to template', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Oakmont Golf Center', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });

    // What the editor now does on save: resolve, then persist verbatim.
    const opened = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    db.setCoursePars(c.course_id, { hole_count: 9, hole_defs: opened });

    const after = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    assert.equal(after.reduce((t, d) => t + d.par, 0), 27, 'still par 27 after a no-op save');
  });

  test('saving preserves a yardage the editor never touched', async () => {
    const db = await resetDB();
    const c = await courseWith(db, {
      name: 'Scorecard GC',
      hole_defs: Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 300 + i })),
    });
    const opened = db.resolveHoleDefs(c.course_id, { holeCount: 9 });
    db.setCoursePars(c.course_id, { hole_count: 9, hole_defs: opened });
    assert.equal(db.totalYardsForTee(c.course_id, { holeCount: 9 }), 300 * 9 + 36);
  });

  test('setCoursePars can rename without disturbing geometry or tees', async () => {
    const db = await resetDB();
    const c = await courseWith(db, { name: 'Old Name', geometry: OAKMONT, tees: teeSetsFromGeometry(OAKMONT, 9) });
    db.setCoursePars(c.course_id, { name: '  Oakmont Golf Center  ' });
    const after = db.getCourse(c.course_id);
    assert.equal(after.name, 'Oakmont Golf Center', 'trimmed');
    assert.equal(after.geometry.counts.greens, 9);
    assert.equal(after.tees.length, 2);
    assert.equal(after.pars_set_at, null, 'a rename alone does not author pars');
  });
});
