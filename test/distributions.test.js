import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import * as db from '../js/db.js';
import { generateSession } from './generator.js';

describe('Strike distribution — 100% single-category + mixed', () => {
  for (const strike of db.STRIKE) {
    test(`100% ${strike}: pct=100, count=n, everything else 0, totals sum correctly`, () => {
      const { shots } = generateSession({ seed: 10, shots: 37, strikeMix: { [strike]: 1 } });
      const b = stats.strikeBreakdown(shots);
      assert.equal(b[strike].pct, 100);
      assert.equal(b[strike].count, 37);
      const totalPct = Object.values(b).reduce((s, v) => s + v.pct, 0);
      assert.equal(totalPct, 100);
      const totalCount = Object.values(b).reduce((s, v) => s + v.count, 0);
      assert.equal(totalCount, 37);
    });
  }

  test('mixed distribution: counts+percentages consistent for an odd total (small-sample rounding)', () => {
    const { shots } = generateSession({ seed: 11, shots: 7, strikeMix: { solid: 3, topped: 2, fat: 1, miss: 1 } });
    const b = stats.strikeBreakdown(shots);
    const totalCount = Object.values(b).reduce((s, v) => s + v.count, 0);
    assert.equal(totalCount, 7);
    // pct is rounded to 1 decimal per-category; verify each pct is consistent with its own count/total.
    for (const k of db.STRIKE) assert.equal(b[k].pct, stats.pct(b[k].count, 7));
  });

  test('legend categories are exhaustive and match db.STRIKE exactly', () => {
    const { shots } = generateSession({ seed: 12, shots: 20 });
    const b = stats.strikeBreakdown(shots);
    assert.deepEqual(Object.keys(b).sort(), [...db.STRIKE].sort());
  });

  test('editing a shot recalculates strike breakdown immediately (no caching/staleness)', async () => {
    const database = await import('../js/db.js');
    await database.__resetForTests();
    globalThis.localStorage.clear();
    const session = database.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 3, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const shot = database.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
    let shots = database.getShotsForSession(session.session_id);
    assert.equal(stats.strikeBreakdown(shots).solid.pct, 100);
    database.updateShot(session.session_id, shot.shot_id, { strike: 'topped' });
    shots = database.getShotsForSession(session.session_id);
    assert.equal(stats.strikeBreakdown(shots).solid.pct, 0);
    assert.equal(stats.strikeBreakdown(shots).topped.pct, 100);
  });
});

describe('Direction distribution — 100% single-category + mixed + edit recalculation', () => {
  // strikeMix pinned to all-solid: a random 'miss' shot forces direction to
  // null regardless of directionMix, which would confound a "100% X" check.
  for (const direction of db.DIRECTION) {
    test(`100% ${direction}`, () => {
      const { shots } = generateSession({ seed: 20, shots: 41, strikeMix: { solid: 1 }, directionMix: { [direction]: 1 } });
      const b = stats.directionBreakdown(shots);
      assert.equal(b[direction].pct, 100);
      assert.equal(b[direction].count, 41);
    });
  }
  test('mixed direction session: counts sum to total', () => {
    const { shots } = generateSession({ seed: 21, shots: 33, strikeMix: { solid: 1 } });
    const b = stats.directionBreakdown(shots);
    const total = Object.values(b).reduce((s, v) => s + v.count, 0);
    assert.equal(total, 33);
  });
  test('miss shots have null direction and are excluded from direction percentages (not silently bucketed)', () => {
    const { shots } = generateSession({ seed: 22, shots: 20, strikeMix: { miss: 1 } });
    for (const sh of shots) assert.equal(sh.direction, null);
    const b = stats.directionBreakdown(shots);
    // None of left/straight/right count a null — total denominator still 20, so percentages sum to 0, not 100.
    const totalPct = b.left.pct + b.straight.pct + b.right.pct;
    assert.equal(totalPct, 0);
  });
});

describe('Height distribution — 100% single-category + mixed', () => {
  // Same strikeMix pin as direction, and for the same reason (miss -> null height).
  for (const height of db.HEIGHT) {
    test(`100% ${height}`, () => {
      const { shots } = generateSession({ seed: 30, shots: 29, strikeMix: { solid: 1 }, heightMix: { [height]: 1 } });
      const b = stats.heightBreakdown(shots);
      assert.equal(b[height].pct, 100);
      assert.equal(b[height].count, 29);
    });
  }
  test('export integrity: height survives round-trip through CSV row building unaltered', async () => {
    const database = await import('../js/db.js');
    await database.__resetForTests();
    globalThis.localStorage.clear();
    const exp = await import('../js/export.js');
    const session = database.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    database.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'high', distance_yards: 140 });
    const csv = exp.sessionCSV(session.session_id);
    const headerCols = csv.split('\n')[0].split(',');
    const row = csv.split('\n')[1].split(',');
    assert.equal(row[headerCols.indexOf('height')], 'high');
  });
});

describe('Distance — ladder values, custom values, and legacy sentinels', () => {
  test('current ladder values round-trip exactly through label<->yards', () => {
    for (const label of db.DISTANCE_LABELS) {
      const yards = db.distanceLabelToYards(label);
      if (label === '200+') { assert.equal(yards, 201); continue; }
      assert.equal(yards, Number(label));
      assert.equal(db.yardsToDistanceLabel(yards), label);
    }
  });

  test('custom/arbitrary numeric values round-trip as their exact number (not bucketed)', () => {
    for (const yards of [1, 37, 62, 101, 149, 250]) {
      assert.equal(db.yardsToDistanceLabel(yards), String(yards));
    }
  });

  test('legacy sentinel 39 ("<40") and 181 ("180+") still resolve to their bucket labels', () => {
    assert.equal(db.yardsToDistanceLabel(39), '<40');
    assert.equal(db.yardsToDistanceLabel(181), '180+');
  });

  test('"200+" (internal value 201) participates in numeric analytics as a real number, not excluded', () => {
    const shots = [
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 201, shot_number: 1 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 190, shot_number: 2 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 195, shot_number: 3 },
    ];
    const d = stats.distanceConsistency(shots);
    assert.equal(d.all.max, 201); // the 200+ shot correctly sets the max, not silently dropped
    assert.equal(d.solid.max, 201);
    assert.ok(d.all.median >= 190 && d.all.median <= 201);
  });

  test('null distance (Unknown) is excluded from median/min/max/mean/stddev entirely', () => {
    const shots = [
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140, shot_number: 1 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150, shot_number: 2 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: null, shot_number: 3 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 160, shot_number: 4 },
    ];
    const d = stats.distanceConsistency(shots);
    assert.equal(d.all.count, 3); // the null is excluded from the count entirely
    assert.equal(d.solid.count, 3);
    assert.equal(d.all.min, 140);
    assert.equal(d.all.max, 160);
  });

  test('median, mean, stddev, CV: hand-verified against a known array [100,110,120,130,140]', () => {
    const shots = [100, 110, 120, 130, 140].map((d, i) => ({ strike: 'solid', direction: 'straight', height: 'medium', distance_yards: d, shot_number: i + 1 }));
    const d = stats.distanceConsistency(shots);
    assert.equal(d.solid.median, 120);
    assert.equal(d.solid.mean, 120);
    assert.equal(d.solid.min, 100);
    assert.equal(d.solid.max, 140);
    assert.equal(d.solid.range, 40);
    // population stddev of [100,110,120,130,140] = sqrt(200) ≈ 14.142..., rounded to 1 decimal = 14.1
    assert.equal(d.solid.stddev, 14.1);
    // CV = stddev/mean*100 = 14.142/120*100 ≈ 11.786 -> 11.8
    assert.equal(d.solid.cv, 11.8);
  });

  test('fewer than 3 solid shots with distance: stddev/CV are null with enoughData=false ("Not enough data"), not zero', () => {
    for (const n of [0, 1, 2]) {
      const shots = Array.from({ length: n }, (_, i) => ({ strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 100 + i, shot_number: i + 1 }));
      const d = stats.distanceConsistency(shots);
      assert.equal(d.solid.enoughData, false);
      assert.equal(d.solid.stddev, null);
      assert.equal(d.solid.cv, null);
      // median/min/max should still be present once there's at least 1 shot — only variability needs 3+.
      if (n > 0) assert.notEqual(d.solid.median, null);
    }
  });
  test('exactly 3 solid shots: enoughData=true, variability computed', () => {
    const shots = [100, 110, 120].map((d, i) => ({ strike: 'solid', direction: 'straight', height: 'medium', distance_yards: d, shot_number: i + 1 }));
    const d = stats.distanceConsistency(shots);
    assert.equal(d.solid.enoughData, true);
    assert.notEqual(d.solid.stddev, null);
  });

  test('non-solid shots do not contribute to the solid-only distance stats', () => {
    const shots = [
      { strike: 'topped', direction: 'left', height: 'low', distance_yards: 9999, shot_number: 1 },
      { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140, shot_number: 2 },
    ];
    const d = stats.distanceConsistency(shots);
    assert.equal(d.solid.max, 140); // the topped shot's absurd distance never leaks into solid-only stats
    assert.equal(d.all.max, 9999); // but it IS present in the "all shots" numeric stats
  });
});
