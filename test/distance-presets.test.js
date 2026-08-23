import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Distance presets — exact option lists per swing length', () => {
  test('HALF', async () => {
    const db = await import('../js/db.js');
    assert.deepEqual(db.distancePresetsForSwing('half'), ['10', '20', '30', '40', '50', '60', '75']);
  });

  test('3/4 (three-quarter)', async () => {
    const db = await import('../js/db.js');
    assert.deepEqual(db.distancePresetsForSwing('three-quarter'), ['25', '40', '50', '60', '75', '90', '100', '125']);
  });

  test('FULL — unchanged from the original ladder, including "200+"', async () => {
    const db = await import('../js/db.js');
    assert.deepEqual(db.distancePresetsForSwing('full'), ['50', '75', '100', '125', '150', '175', '200+']);
    assert.deepEqual(db.distancePresetsForSwing('full'), db.DISTANCE_LABELS, 'full\'s list is exactly DISTANCE_LABELS, not a parallel copy that could drift');
  });

  test('an unrecognized/missing swing_length falls back to Full, never throws', async () => {
    const db = await import('../js/db.js');
    assert.deepEqual(db.distancePresetsForSwing('bogus'), db.DISTANCE_LABELS);
    assert.deepEqual(db.distancePresetsForSwing(undefined), db.DISTANCE_LABELS);
  });

  test('changing swing length changes which list is offered', async () => {
    const db = await import('../js/db.js');
    assert.notDeepEqual(db.distancePresetsForSwing('half'), db.distancePresetsForSwing('full'));
    assert.notDeepEqual(db.distancePresetsForSwing('three-quarter'), db.distancePresetsForSwing('full'));
    assert.notDeepEqual(db.distancePresetsForSwing('half'), db.distancePresetsForSwing('three-quarter'));
  });
});

describe('Distance presets — storage is swing-agnostic (single distance_yards field, no new fields)', () => {
  test('selecting 10 yd (a Half-only preset, the shortest one) stores plain numeric 10', async () => {
    const db = await (await import('./setup.js')).resetDB();
    assert.equal(db.distanceLabelToYards('10'), 10);
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 10, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    const shot = db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', strike: 'solid', direction: 'straight', height: 'low', distance_yards: db.distanceLabelToYards('10') });
    assert.equal(shot.distance_yards, 10);
    assert.equal(typeof shot.distance_yards, 'number');
    assert.ok(!('distance_bucket' in shot) && !('half_distance' in shot) && !('full_distance' in shot), 'no separate bucket/per-swing field was introduced');
  });

  test('selecting 75 yd (shared across Half, 3/4, and Full) stores plain numeric 75 regardless of which ladder it came from', async () => {
    const db = await (await import('./setup.js')).resetDB();
    assert.equal(db.distanceLabelToYards('75'), 75);
    for (const swing of ['half', 'three-quarter', 'full']) {
      const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: swing });
      const shot = db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: swing, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: db.distanceLabelToYards('75') });
      assert.equal(shot.distance_yards, 75);
    }
  });

  test('custom distance works for Half, 3/4, and Full alike — an arbitrary typed value stores as its own exact number', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const cases = [{ swing: 'half', custom: 37 }, { swing: 'three-quarter', custom: 83 }, { swing: 'full', custom: 168 }];
    for (const { swing, custom } of cases) {
      const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: swing });
      const shot = db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: swing, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: custom });
      assert.equal(db.getShotsForSession(session.session_id)[0].distance_yards, custom);
      assert.equal(db.yardsToDistanceLabel(custom), String(custom), 'a custom value not matching any preset round-trips as its own exact label, not silently bucketed');
    }
  });

  test('edit preserves a non-preset value — a Half-swing shot with distance=37 is not discarded or coerced', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    const shot = db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', strike: 'solid', direction: 'straight', height: 'low', distance_yards: 37 });

    // 37 is not one of Half's seven presets, nor any other swing's — confirms
    // the Distance screen's "isSelected" check (which compares against the
    // rung list) simply won't match any rung, without the underlying value
    // ever being touched, corrupted, or rounded to a nearby preset.
    assert.ok(!db.distancePresetsForSwing('half').includes('37'));
    assert.equal(db.yardsToDistanceLabel(37), '37');

    // Editing only strike/direction/height/distance_yards (per finishShot's
    // edit branch) — re-patching with the SAME distance confirms it's not
    // discarded just because it doesn't match a preset.
    const edited = db.updateShot(session.session_id, shot.shot_id, { strike: 'topped', direction: 'left', height: 'high', distance_yards: 37 });
    assert.equal(edited.distance_yards, 37);
    assert.equal(edited.swing_length, 'half', 'swing_length itself is never touched by an edit');
  });
});

describe('Distance presets — analytics, export, and historical compatibility', () => {
  test('session analytics remain correct across a mix of Half/3-4/Full shots with wide-ranging distances', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    const rows = [
      { swing: 'half', distance: 5 },
      { swing: 'half', distance: 25 },
      { swing: 'three-quarter', distance: 75 },
      { swing: 'full', distance: 150 },
      { swing: 'full', distance: 201 }, // the "200+" sentinel
    ];
    for (const r of rows) {
      db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: r.swing, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: r.distance });
    }
    const shots = db.getShotsForSession(session.session_id);
    const summary = stats.sessionSummary(shots);
    assert.equal(summary.total, 5);
    assert.equal(summary.distance.medianSolid, 75, 'median of [5,25,75,150,201] is 75');
    const consistency = stats.distanceConsistency(shots);
    assert.equal(consistency.all.min, 5);
    assert.equal(consistency.all.max, 201);
    assert.ok(Number.isFinite(consistency.solid.mean));
  });

  test('CSV export remains correct for small Half-swing distances', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const exp = await import('../js/export.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 1, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', strike: 'solid', direction: 'straight', height: 'low', distance_yards: 5 });
    const csv = exp.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const row = csv.split('\n')[1].split(',');
    assert.equal(row[header.indexOf('distance_yards')], '5');
    assert.equal(row[header.indexOf('swing_length')], 'half');
  });

  test('JSON export/import round-trips small and legacy distances unchanged', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', strike: 'solid', direction: 'straight', height: 'low', distance_yards: 10 });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', strike: 'thin', direction: 'left', height: 'low', distance_yards: 39 }); // legacy "<40" sentinel
    const backup = db.exportFullDB();
    const serialized = JSON.parse(JSON.stringify(backup));
    db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(serialized);
    const shots = db.getAllShots();
    assert.deepEqual(shots.map((s) => s.distance_yards).sort((a, b) => a - b), [10, 39]);
    assert.equal(db.yardsToDistanceLabel(39), '<40', 'legacy sentinel semantics untouched');
  });

  test('historical sessions with no concept of swing-aware presets still load and compute correctly', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    // Simulates a shot logged before this change existed — swing_length is
    // still one of the pre-existing enum values, distance_yards is a plain
    // legacy value (180+ sentinel), nothing new about its shape.
    const session = db.createSession({ date: '2020-01-01', start_time: '09:00', target_ball_count: 1, default_club: 'Driver', default_setup: 'tee', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: 'Driver', setup: 'tee', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'high', distance_yards: 181 });
    db.finishSession(session.session_id);

    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 1);
    assert.equal(db.yardsToDistanceLabel(shots[0].distance_yards), '180+');
    const summary = stats.sessionSummary(shots);
    assert.equal(summary.total, 1);
    assert.ok(Number.isFinite(summary.distance.medianAll));
  });

  test('target-distance calculations are unaffected — same results regardless of swing_length variety', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 3, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'half' });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', target_distance_yards: 20, strike: 'solid', direction: 'straight', height: 'low', distance_yards: 22 });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'half', target_distance_yards: 20, strike: 'solid', direction: 'straight', height: 'low', distance_yards: 18 });
    db.addShot(session.session_id, { club: 'PW', setup: 'ground', surface: 'mat', swing_length: 'three-quarter', target_distance_yards: 20, strike: 'solid', direction: 'straight', height: 'low', distance_yards: 20 });
    const shots = db.getShotsForSession(session.session_id);
    const groups = stats.targetAccuracyGroups(shots);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].target, 20);
    assert.equal(groups[0].count, 3);
    assert.equal(groups[0].medianActual, 20);
  });
});
