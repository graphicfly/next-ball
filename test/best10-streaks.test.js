import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';

function shot(ball, strike, direction = 'straight', distance_yards = 140) {
  return { shot_number: ball, strike, direction: strike === 'miss' ? null : direction, height: strike === 'miss' ? null : 'medium', distance_yards: strike === 'miss' ? null : distance_yards, target_distance_yards: null, drill: 'Normal Swing' };
}

function fill(n, strike = 'topped') {
  return Array.from({ length: n }, (_, i) => shot(i + 1, strike));
}

describe('Streak positioning — beginning / middle / end / single-shot / tied', () => {
  test('streak at the very beginning (balls 1-5 solid, rest topped)', () => {
    const shots = [1,2,3,4,5].map((b) => shot(b, 'solid')).concat(fill(45).map((s, i) => shot(i + 6, 'topped')));
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 5);
    assert.equal(streak.startBall, 1);
    assert.equal(streak.endBall, 5);
  });

  test('streak in the middle (balls 20-25 solid, rest topped)', () => {
    const shots = Array.from({ length: 50 }, (_, i) => {
      const ball = i + 1;
      return shot(ball, ball >= 20 && ball <= 25 ? 'solid' : 'topped');
    });
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 6);
    assert.equal(streak.startBall, 20);
    assert.equal(streak.endBall, 25);
  });

  test('streak at the very end (balls 46-50 solid, rest topped)', () => {
    const shots = Array.from({ length: 50 }, (_, i) => {
      const ball = i + 1;
      return shot(ball, ball >= 46 ? 'solid' : 'topped');
    });
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 5);
    assert.equal(streak.startBall, 46);
    assert.equal(streak.endBall, 50);
  });

  test('single-shot streak (exactly one solid shot amid topped)', () => {
    const shots = Array.from({ length: 10 }, (_, i) => shot(i + 1, i === 4 ? 'solid' : 'topped'));
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 1);
    assert.equal(streak.startBall, 5);
    assert.equal(streak.endBall, 5);
  });

  test('no streak at all (0 solid shots): length=0, startBall/endBall=null', () => {
    const shots = fill(20, 'topped');
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 0);
    assert.equal(streak.startBall, null);
    assert.equal(streak.endBall, null);
  });

  test('multiple equal-length streaks: deterministically reports the FIRST occurrence', () => {
    // Two separate 3-shot solid streaks: balls 1-3 and balls 10-12. Neither is longer than the other.
    const shots = Array.from({ length: 20 }, (_, i) => {
      const ball = i + 1;
      const isSolid = (ball >= 1 && ball <= 3) || (ball >= 10 && ball <= 12);
      return shot(ball, isSolid ? 'solid' : 'topped');
    });
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 3);
    assert.equal(streak.startBall, 1); // first occurrence wins the tie, not the later one
    assert.equal(streak.endBall, 3);
  });

  test('reported ball range exactly matches actual shot numbers, not array index (non-contiguous shot_number)', () => {
    // Simulates a session where shot_number 3 was deleted (undo), leaving a gap — shot_number values 1,2,4,5,6.
    const shots = [1, 2, 4, 5, 6].map((n) => shot(n, 'solid'));
    const streak = stats.streaksSummary(shots).solid;
    assert.equal(streak.length, 5); // longestStreak walks the sorted array positionally, gap in numbering doesn't break the run
    assert.equal(streak.startBall, 1);
    assert.equal(streak.endBall, 6);
  });
});

describe('Best 10-Shot Window — fixed positions', () => {
  test('best window at the very start: balls 1-10', () => {
    const shots = Array.from({ length: 50 }, (_, i) => shot(i + 1, i < 10 ? 'solid' : 'topped'));
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 1);
    assert.equal(w.endBall, 10);
  });
  test('best window shifted by one: balls 2-11', () => {
    // balls 2-11 are solid (10 shots); ball 1 and everything from 12 on is topped, so no other 10-window can beat 10/10 solid.
    const shots = Array.from({ length: 50 }, (_, i) => {
      const ball = i + 1;
      return shot(ball, ball >= 2 && ball <= 11 ? 'solid' : 'topped');
    });
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 2);
    assert.equal(w.endBall, 11);
  });
  test('best window at the very end: balls 41-50', () => {
    const shots = Array.from({ length: 50 }, (_, i) => shot(i + 1, i >= 40 ? 'solid' : 'topped'));
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 41);
    assert.equal(w.endBall, 50);
  });
  test('best window exactly balls 21-30 (fixed-block-aligned case)', () => {
    const shots = Array.from({ length: 50 }, (_, i) => {
      const ball = i + 1;
      return shot(ball, ball >= 21 && ball <= 30 ? 'solid' : 'topped');
    });
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 21);
    assert.equal(w.endBall, 30);
  });

  test('tie case: two windows with IDENTICAL metrics — deterministic (first-found) tie-break', () => {
    // balls 1-10 and balls 21-30 both 100% solid/straight, identical distances; everything else topped.
    // Windows 1-10 and 21-30 tie exactly on every ranking key; the earliest-indexed window must win deterministically.
    const shots = Array.from({ length: 50 }, (_, i) => {
      const ball = i + 1;
      const isSolidBlock = (ball >= 1 && ball <= 10) || (ball >= 21 && ball <= 30);
      return shot(ball, isSolidBlock ? 'solid' : 'topped', 'straight', isSolidBlock ? 140 : 60);
    });
    const w1 = stats.bestWindow(shots);
    const w2 = stats.bestWindow(shots); // re-run to confirm it's stable/repeatable, not order-dependent per call
    assert.equal(w1.startBall, 1);
    assert.equal(w1.endBall, 10);
    assert.deepEqual(w1, w2);
  });

  test('ranking priority: higher Solid% always wins even with worse Straight% (Solid outranks Straight)', () => {
    // Block A (1-10) and Block B (20-29) are separated by a 9-shot topped
    // buffer (11-19) so no rolling window can span from one into the other
    // and form a hybrid that isn't really either candidate.
    const shots = [];
    for (let ball = 1; ball <= 10; ball++) shots.push(shot(ball, 'solid', ball % 2 === 0 ? 'straight' : 'left')); // 100% solid, 50% straight
    for (let ball = 11; ball <= 19; ball++) shots.push(shot(ball, 'topped'));
    for (let ball = 20; ball <= 29; ball++) shots.push(shot(ball, ball === 29 ? 'topped' : 'solid', 'straight')); // 90% solid, 100% straight
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 1); // A wins on Solid% (100 > 90) despite worse Straight%
    assert.equal(w.endBall, 10);
  });

  test('ranking priority: combined Topped+Fat outranks Straight% as the second tiebreaker', () => {
    // Both blocks 80% solid; buffered apart so no hybrid window is possible.
    const shots = [];
    for (let ball = 1; ball <= 10; ball++) shots.push(shot(ball, ball > 8 ? 'thin' : 'solid', 'straight')); // 80% solid, non-topped/fat misses
    for (let ball = 11; ball <= 19; ball++) shots.push(shot(ball, 'shank'));
    for (let ball = 20; ball <= 29; ball++) shots.push(shot(ball, ball > 27 ? (ball === 28 ? 'topped' : 'fat') : 'solid', 'straight')); // 80% solid, but the misses ARE topped/fat
    const w = stats.bestWindow(shots);
    assert.equal(w.startBall, 1); // same solid%, but lower topped+fat% wins
    assert.equal(w.endBall, 10);
  });
});

describe('Target-aware Best 10 ranking uses accuracy, not raw distance', () => {
  test('a less-accurate-but-farther window loses to a more-accurate-but-shorter window at equal contact quality', () => {
    const shots = [];
    for (let i = 1; i <= 10; i++) shots.push({ shot_number: i, strike: 'solid', direction: 'straight', height: 'medium', target_distance_yards: 100, distance_yards: 100 + (i % 2 === 0 ? 20 : -18) }); // sloppy: ~19yd median error
    for (let i = 11; i <= 20; i++) shots.push({ shot_number: i, strike: 'solid', direction: 'straight', height: 'medium', target_distance_yards: 100, distance_yards: 100 + (i % 2 === 0 ? 2 : -1) }); // accurate: ~1.5yd median error
    const targeted = stats.bestTargetedWindow(shots);
    assert.equal(targeted.startBall, 11); // accuracy wins between two equally-solid windows
  });
});
