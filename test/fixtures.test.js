import '../js/db.js'; // ensure module graph resolves before setup shims (harmless if unused)
import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import {
  ALL_SOLID, ALL_TOPPED, ALL_THIN, ALL_FAT, ALL_SHANK, ALL_MISS,
  ALTERNATING_SOLID_TOPPED, KNOWN_BEST_10_AT_18_27, KNOWN_TARGET_SESSION_100YD, MULTI_DRILL_BLOCKS,
} from './fixtures.js';

describe('Fixture: ALL_SOLID (50 shots, all Solid/Straight/Medium/100yd)', () => {
  const s = stats.sessionSummary(ALL_SOLID);
  test('Solid = 100%, Straight = 100%', () => {
    assert.equal(s.strike.solid.pct, 100);
    assert.equal(s.direction.straight.pct, 100);
  });
  test('Median Solid = 100 yd', () => {
    assert.equal(s.distance.medianSolid, 100);
  });
  test('every streak = 50', () => {
    assert.equal(s.streaks.solid.length, 50);
    assert.equal(s.streaks.straight.length, 50);
    assert.equal(s.streaks.noTop.length, 50);
    assert.equal(s.streaks.noFat.length, 50);
    assert.equal(s.streaks.cleanContact.length, 50);
  });
  test('streak range is balls 1-50', () => {
    assert.equal(s.streaks.solid.startBall, 1);
    assert.equal(s.streaks.solid.endBall, 50);
  });
});

describe('Fixture: ALL_TOPPED (50 shots, all Topped)', () => {
  const s = stats.sessionSummary(ALL_TOPPED);
  test('Solid = 0%, Topped = 100%', () => {
    assert.equal(s.strike.solid.pct, 0);
    assert.equal(s.strike.topped.pct, 100);
  });
  test('longest Solid streak = 0', () => {
    assert.equal(s.streaks.solid.length, 0);
    assert.equal(s.streaks.solid.startBall, null);
  });
  test('no-Top streak = 0, clean-contact = 0', () => {
    assert.equal(s.streaks.noTop.length, 0);
    assert.equal(s.streaks.cleanContact.length, 0);
  });
  test('no-Fat streak = 50 (topped shots never violate the no-fat rule)', () => {
    assert.equal(s.streaks.noFat.length, 50);
  });
});

describe('Fixture: 100% single-category sweeps (percentages + no divide-by-zero)', () => {
  for (const [name, fixture, key] of [
    ['ALL_THIN', ALL_THIN, 'thin'], ['ALL_FAT', ALL_FAT, 'fat'],
    ['ALL_SHANK', ALL_SHANK, 'shank'], ['ALL_MISS', ALL_MISS, 'miss'],
  ]) {
    test(`${name}: ${key} = 100%, everything else = 0%, counts sum to 50`, () => {
      const b = stats.strikeBreakdown(fixture);
      assert.equal(b[key].pct, 100);
      assert.equal(b[key].count, 50);
      const totalCount = Object.values(b).reduce((s, v) => s + v.count, 0);
      assert.equal(totalCount, 50);
      for (const k of Object.keys(b)) {
        if (k !== key) { assert.equal(b[k].pct, 0); assert.equal(b[k].count, 0); }
      }
    });
  }

  test('ALL_MISS: distance/direction/height analytics do not crash or divide by zero', () => {
    const s = stats.sessionSummary(ALL_MISS);
    assert.equal(s.distance.medianAll, null);
    assert.equal(s.distance.medianSolid, null);
    assert.equal(s.direction.straight.pct, 0);
    assert.equal(s.consistency.distance.solid.enoughData, false);
    assert.equal(s.consistency.distance.solid.cv, null);
    assert.ok(s.bestWindow); // still computable — just all-zero contact
    assert.equal(s.bestWindow.solidPct, 0);
  });
});

describe('Fixture: ALTERNATING_SOLID_TOPPED', () => {
  const s = stats.sessionSummary(ALTERNATING_SOLID_TOPPED);
  test('25 solid, 25 topped', () => {
    assert.equal(s.strike.solid.count, 25);
    assert.equal(s.strike.topped.count, 25);
  });
  test('longest Solid streak = 1 (never two in a row)', () => {
    assert.equal(s.streaks.solid.length, 1);
  });
  test('longest no-Top streak = 1', () => {
    assert.equal(s.streaks.noTop.length, 1);
  });
  test('longest clean-contact streak = 1', () => {
    assert.equal(s.streaks.cleanContact.length, 1);
  });
});

describe('Fixture: KNOWN_BEST_10_AT_18_27 (rolling-window cross-block detection)', () => {
  const s = stats.sessionSummary(KNOWN_BEST_10_AT_18_27);
  test('best window is exactly balls 18-27', () => {
    assert.equal(s.bestWindow.startBall, 18);
    assert.equal(s.bestWindow.endBall, 27);
  });
  test('best window is NOT forced to a fixed 11-20 or 21-30 block', () => {
    assert.notEqual(`${s.bestWindow.startBall}-${s.bestWindow.endBall}`, '11-20');
    assert.notEqual(`${s.bestWindow.startBall}-${s.bestWindow.endBall}`, '21-30');
  });
  test('best window is 100% solid/straight, 0% topped/fat', () => {
    assert.equal(s.bestWindow.solidPct, 100);
    assert.equal(s.bestWindow.straightPct, 100);
    assert.equal(s.bestWindow.toppedFatPct, 0);
  });
  test('rollingTenShotWindows produces exactly 41 windows for 50 shots', () => {
    assert.equal(stats.rollingTenShotWindows(KNOWN_BEST_10_AT_18_27).length, 41);
  });
  test('every window has exactly 10 shots', () => {
    for (const w of stats.rollingTenShotWindows(KNOWN_BEST_10_AT_18_27)) assert.equal(w.count, 10);
  });
});

describe('Fixture: KNOWN_TARGET_SESSION_100YD', () => {
  const groups = stats.targetAccuracyGroups(KNOWN_TARGET_SESSION_100YD);
  test('exactly one target group, at 100yd, 10 shots', () => {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].target, 100);
    assert.equal(groups[0].count, 10);
  });
  test('medianActual = 100, medianSignedError = 0, medianAbsoluteError = 5', () => {
    assert.equal(groups[0].medianActual, 100);
    assert.equal(groups[0].medianSignedError, 0);
    assert.equal(groups[0].medianAbsoluteError, 5);
  });
  test('within5Pct = 60, within10Pct = 100', () => {
    assert.equal(groups[0].within5Pct, 60);
    assert.equal(groups[0].within10Pct, 100);
  });
});

describe('Fixture: MULTI_DRILL_BLOCKS (1-10 Low Point, 11-20 Normal Swing, 21-30 Connection, 31-50 Normal Swing)', () => {
  test('each shot retains the correct drill', () => {
    for (let i = 0; i < 10; i++) assert.equal(MULTI_DRILL_BLOCKS[i].drill, 'Low Point');
    for (let i = 10; i < 20; i++) assert.equal(MULTI_DRILL_BLOCKS[i].drill, 'Normal Swing');
    for (let i = 20; i < 30; i++) assert.equal(MULTI_DRILL_BLOCKS[i].drill, 'Connection');
    for (let i = 30; i < 50; i++) assert.equal(MULTI_DRILL_BLOCKS[i].drill, 'Normal Swing');
  });
  test('drillBreakdown aggregates Normal Swing across both non-contiguous blocks (balls 11-20 + 31-50 = 30 shots)', () => {
    const breakdown = stats.drillBreakdown(MULTI_DRILL_BLOCKS);
    const normalSwing = breakdown.find((d) => d.drill === 'Normal Swing');
    const lowPoint = breakdown.find((d) => d.drill === 'Low Point');
    const connection = breakdown.find((d) => d.drill === 'Connection');
    assert.equal(normalSwing.count, 30);
    assert.equal(lowPoint.count, 10);
    assert.equal(connection.count, 10);
  });
});
