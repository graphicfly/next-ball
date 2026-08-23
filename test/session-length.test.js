import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import { generateSession } from './generator.js';

const LENGTHS = [0, 1, 2, 3, 5, 9, 10, 11, 19, 20, 21, 25, 30, 43, 49, 50, 51, 60, 75, 100];

describe('Session length matrix — sessionSummary never throws / produces NaN', () => {
  for (const n of LENGTHS) {
    test(`${n} shots: sessionSummary completes without throwing or NaN`, () => {
      const { shots } = generateSession({ seed: 1000 + n, shots: n });
      assert.equal(shots.length, n);
      const s = stats.sessionSummary(shots);
      assert.equal(s.total, n);
      // Recursively scan every numeric leaf for NaN.
      const scan = (obj, path = '') => {
        if (obj === null || obj === undefined) return;
        if (typeof obj === 'number') { assert.ok(!Number.isNaN(obj), `NaN at ${path}`); return; }
        if (Array.isArray(obj)) { obj.forEach((v, i) => scan(v, `${path}[${i}]`)); return; }
        if (typeof obj === 'object') { for (const k of Object.keys(obj)) scan(obj[k], `${path}.${k}`); }
      };
      scan(s);
    });
  }
});

describe('Best 10-Shot Window threshold: unavailable below 10 shots', () => {
  for (const n of [0, 1, 5, 9]) {
    test(`${n} shots: bestWindow is null`, () => {
      const { shots } = generateSession({ seed: 2000 + n, shots: n });
      assert.equal(stats.bestWindow(shots), null);
    });
  }
  for (const n of [10, 11, 25, 50, 100]) {
    test(`${n} shots: bestWindow is available and covers exactly 10 shots`, () => {
      const { shots } = generateSession({ seed: 2000 + n, shots: n });
      const w = stats.bestWindow(shots);
      assert.ok(w);
      assert.equal(w.count, 10);
      assert.equal(w.endBall - w.startBall, 9);
    });
  }
  test('rollingTenShotWindows count = max(0, n - 9) for every length', () => {
    for (const n of LENGTHS) {
      const { shots } = generateSession({ seed: 3000 + n, shots: n });
      const expected = Math.max(0, n - 9);
      assert.equal(stats.rollingTenShotWindows(shots).length, expected, `n=${n}`);
    }
  });
});

describe('First 10 vs Last 10 threshold: overlapping flag below 20 shots', () => {
  for (const n of [1, 9, 10, 19]) {
    test(`${n} shots: overlapping = true (misleading comparison must not be presented as clean)`, () => {
      const { shots } = generateSession({ seed: 4000 + n, shots: n });
      assert.equal(stats.firstLastCompare(shots).overlapping, true);
    });
  }
  for (const n of [20, 21, 50, 100]) {
    test(`${n} shots: overlapping = false`, () => {
      const { shots } = generateSession({ seed: 4000 + n, shots: n });
      assert.equal(stats.firstLastCompare(shots).overlapping, false);
    });
  }
  test('exactly 19: first10 = balls 1-10, last10 = balls 10-19, overlapping by exactly ball 10', () => {
    const { shots } = generateSession({ seed: 4019, shots: 19 });
    const { first10, last10 } = stats.firstLastCompare(shots);
    assert.deepEqual(first10.map((s) => s.shot_number), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(last10.map((s) => s.shot_number), [10,11,12,13,14,15,16,17,18,19]);
    const firstNums = first10.map((s) => s.shot_number);
    const lastNums = last10.map((s) => s.shot_number);
    const shared = firstNums.filter((n) => lastNums.includes(n));
    assert.equal(shared.length, 1);
  });
  test('exactly 20: first10 = balls 1-10, last10 = balls 11-20, no overlap', () => {
    const { shots } = generateSession({ seed: 4020, shots: 20 });
    const { first10, last10 } = stats.firstLastCompare(shots);
    assert.deepEqual(first10.map((s) => s.shot_number), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(last10.map((s) => s.shot_number), [11,12,13,14,15,16,17,18,19,20]);
  });
  test('exactly 21: first10 = balls 1-10, last10 = balls 12-21 (still the trailing 10, not 11-20)', () => {
    const { shots } = generateSession({ seed: 4021, shots: 21 });
    const { first10, last10 } = stats.firstLastCompare(shots);
    assert.deepEqual(first10.map((s) => s.shot_number), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(last10.map((s) => s.shot_number), [12,13,14,15,16,17,18,19,20,21]);
  });
  test('50 shots: first10 = 1-10, last10 = 41-50 (matches prompt spec exactly)', () => {
    const { shots } = generateSession({ seed: 4050, shots: 50 });
    const { first10, last10 } = stats.firstLastCompare(shots);
    assert.deepEqual(first10.map((s) => s.shot_number), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(last10.map((s) => s.shot_number), [41,42,43,44,45,46,47,48,49,50]);
  });
});

describe('10-Ball Blocks: standard 5x10 map at 50, partial trailing block otherwise', () => {
  test('50 shots -> 5 blocks of exactly 10', () => {
    const { shots } = generateSession({ seed: 5050, shots: 50 });
    const blocks = stats.tenBallBlocks(shots);
    assert.equal(blocks.length, 5);
    for (const b of blocks) assert.equal(b.count, 10);
    assert.equal(blocks[0].label, 'Balls 1-10');
    assert.equal(blocks[4].label, 'Balls 41-50');
  });
  test('43 shots -> 5 blocks, last block has 3 shots (Balls 41-43)', () => {
    const { shots } = generateSession({ seed: 5043, shots: 43 });
    const blocks = stats.tenBallBlocks(shots);
    assert.equal(blocks.length, 5);
    assert.equal(blocks[4].count, 3);
    assert.equal(blocks[4].label, 'Balls 41-43');
  });
  test('100 shots -> 10 full blocks (adaptive above 50)', () => {
    const { shots } = generateSession({ seed: 5100, shots: 100 });
    const blocks = stats.tenBallBlocks(shots);
    assert.equal(blocks.length, 10);
    for (const b of blocks) assert.equal(b.count, 10);
  });
  test('0 shots -> 0 blocks, no crash', () => {
    const blocks = stats.tenBallBlocks([]);
    assert.deepEqual(blocks, []);
  });
});

describe('0-shot session: fully empty but structurally valid', () => {
  const s = stats.sessionSummary([]);
  test('all percentages are 0, not NaN', () => {
    assert.equal(s.strike.solid.pct, 0);
    assert.equal(s.direction.straight.pct, 0);
  });
  test('medians/best-window/streaks are all null/zero, not throwing', () => {
    assert.equal(s.distance.medianAll, null);
    assert.equal(s.bestWindow, null);
    assert.equal(s.bestTargetedWindow, null);
    assert.equal(s.streaks.solid.length, 0);
    assert.deepEqual(s.targetAccuracy, []);
    assert.deepEqual(s.drills, []);
  });
});
