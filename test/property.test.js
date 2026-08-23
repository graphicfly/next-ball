import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import * as db from '../js/db.js';
import { generateSession } from './generator.js';

const N_SESSIONS = 520;
const CLUBS = db.CLUBS;
const DRILLS = [null, ...db.DRILLS];
const TARGETS = [null, 60, 80, 100, 120, 150];

// Deterministic pseudo-random session-length + mix selection driven purely
// by the loop index, so this whole property run is itself reproducible.
function mixFor(seed, keys) {
  const mix = {};
  for (const k of keys) mix[k] = ((seed * 7919 + k.length * 131) % 97) + 1; // always positive weight
  return mix;
}

function scanForNaNOrInfinity(obj, path, bad) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    if (Number.isNaN(obj)) bad.push(`NaN at ${path}`);
    if (!Number.isFinite(obj) && !Number.isNaN(obj)) bad.push(`Infinity at ${path}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => scanForNaNOrInfinity(v, `${path}[${i}]`, bad)); return; }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) scanForNaNOrInfinity(obj[k], `${path}.${k}`, bad); }
}

describe(`Randomized property testing — ${N_SESSIONS} seeded sessions, lengths 1-100`, () => {
  let totalShots = 0;

  for (let seed = 1; seed <= N_SESSIONS; seed++) {
    const shotCount = 1 + (seed * 37) % 100; // deterministically spans 1..100
    const club = CLUBS[seed % CLUBS.length];
    const drill = DRILLS[seed % DRILLS.length];
    const target = TARGETS[seed % TARGETS.length];
    const setup = seed % 2 === 0 ? 'ground' : 'tee';
    const swing = ['half', 'three-quarter', 'full'][seed % 3];

    test(`seed=${seed} shots=${shotCount} club=${club} drill=${drill ?? 'none'} target=${target ?? 'none'}`, () => {
      const { shots } = generateSession({
        seed, shots: shotCount, club, setup, swing,
        drill: drill ?? 'Normal Swing',
        target,
        strikeMix: mixFor(seed, db.STRIKE),
        directionMix: mixFor(seed + 1, db.DIRECTION),
        heightMix: mixFor(seed + 2, db.HEIGHT),
      });
      totalShots += shots.length;

      // -- no crash --
      const s = stats.sessionSummary(shots);

      // -- no NaN / Infinity anywhere in the output --
      const bad = [];
      scanForNaNOrInfinity(s, 'summary', bad);
      assert.deepEqual(bad, []);

      // -- shot numbers unique and 1..N --
      const numbers = shots.map((sh) => sh.shot_number);
      assert.equal(new Set(numbers).size, shots.length);
      assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: shots.length }, (_, i) => i + 1));

      // -- strike counts sum to total shots --
      const strikeCounts = Object.values(s.strike).reduce((sum, v) => sum + v.count, 0);
      assert.equal(strikeCounts, shots.length);

      // -- direction counts sum to shots WITH a non-null direction (miss shots excluded, not silently bucketed) --
      const directionCounts = Object.values(s.direction).reduce((sum, v) => sum + v.count, 0);
      const shotsWithDirection = shots.filter((sh) => sh.direction !== null && sh.direction !== undefined).length;
      assert.equal(directionCounts, shotsWithDirection);

      // -- height counts sum to shots with a non-null height --
      const heightCounts = Object.values(s.height).reduce((sum, v) => sum + v.count, 0);
      const shotsWithHeight = shots.filter((sh) => sh.height !== null && sh.height !== undefined).length;
      assert.equal(heightCounts, shotsWithHeight);

      // -- every percentage in [0, 100], no negative counts --
      for (const group of [s.strike, s.direction, s.height]) {
        for (const key of Object.keys(group)) {
          assert.ok(group[key].pct >= 0 && group[key].pct <= 100, `${key} pct out of range: ${group[key].pct}`);
          assert.ok(group[key].count >= 0, `${key} count negative`);
        }
      }

      // -- median lies within [min, max] for all-shots distance --
      if (s.consistency.distance.all.median !== null) {
        assert.ok(s.consistency.distance.all.median >= s.consistency.distance.all.min);
        assert.ok(s.consistency.distance.all.median <= s.consistency.distance.all.max);
      }
      if (s.consistency.distance.solid.median !== null) {
        assert.ok(s.consistency.distance.solid.median >= s.consistency.distance.solid.min);
        assert.ok(s.consistency.distance.solid.median <= s.consistency.distance.solid.max);
      }

      // -- Best 10 window: present iff >=10 shots, and always exactly 10 shots wide --
      if (shots.length >= 10) {
        assert.ok(s.bestWindow);
        assert.equal(s.bestWindow.count, 10);
        assert.equal(s.bestWindow.endBall - s.bestWindow.startBall, 9);
      } else {
        assert.equal(s.bestWindow, null);
      }

      // -- every streak length is between 0 and the total shot count, inclusive --
      for (const key of Object.keys(s.streaks)) {
        assert.ok(s.streaks[key].length >= 0);
        assert.ok(s.streaks[key].length <= shots.length);
        if (s.streaks[key].length > 0) {
          assert.ok(s.streaks[key].startBall <= s.streaks[key].endBall);
          assert.equal(s.streaks[key].endBall - s.streaks[key].startBall + 1 >= s.streaks[key].length, true);
        }
      }

      // -- target accuracy groups: within5/within10 are valid percentages, and within5 <= within10 always (5yd is a subset of 10yd) --
      for (const g of s.targetAccuracy) {
        if (g.within5Pct !== null && g.within10Pct !== null) {
          assert.ok(g.within5Pct <= g.within10Pct, `within5 (${g.within5Pct}) > within10 (${g.within10Pct})`);
        }
        assert.ok(g.count > 0);
      }

      // -- drill breakdown counts sum to shots with a non-null drill --
      const drillTotal = s.drills.reduce((sum, d) => sum + d.count, 0);
      const shotsWithDrill = shots.filter((sh) => sh.drill).length;
      assert.equal(drillTotal, shotsWithDrill);
    });
  }

  test(`sanity: this run actually simulated a meaningful volume of shots`, () => {
    assert.ok(totalShots > 20000, `only simulated ${totalShots} shots — expected 20k+`);
  });
});
