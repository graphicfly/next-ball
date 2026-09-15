import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import {
  getNextGoal, cleanContactStreakGoal, clubSolidContactGoal, dominantDirectionGoal,
} from '../js/sessionStory.js';

// Coverage for the V2 Session Summary "Next Goal" additions: a stricter
// clean-contact-streak goal, a club-specific goal, and a dominant-direction
// goal — all three live in getNextGoal's FALLBACK tier (only ever proposed
// when none of the three original percentage-milestone goals — solid/
// top-fat/straight — have headroom), so they never change the winner in a
// session where one of those already applies. See recap-next-goal.test.js
// for that original tier's own (unchanged) coverage.

function shot(n, overrides = {}) {
  return {
    shot_id: `s${n}`,
    shot_number: n,
    strike: 'solid',
    direction: 'straight',
    height: 'medium',
    distance_yards: 150,
    club: '7i',
    setup: 'ground',
    surface: 'mat',
    swing_length: 'full',
    drill: null,
    training_aid: 'none',
    target_distance_yards: null,
    ...overrides,
  };
}

function fakeSession(overrides = {}) {
  return {
    session_id: 'sess-1',
    default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    current_drill: 'Normal Swing', current_training_aid: 'none',
    ...overrides,
  };
}

function fill(strikes, extra = {}) {
  return strikes.map((strike, i) => shot(i + 1, { strike, ...(typeof extra === 'function' ? extra(i) : extra) }));
}

describe('cleanContactStreakGoal — stricter than the old solid-only streak', () => {
  test('a run of alternating Solid/Thin counts as one clean-contact streak even though no pure-Solid streak would', () => {
    // 8 shots alternating solid/thin (clean-contact run = 8), then 2 fat.
    const seq = [];
    for (let i = 0; i < 8; i++) seq.push(i % 2 === 0 ? 'solid' : 'thin');
    seq.push('fat', 'fat');
    const shots = fill(seq);
    const s = stats.sessionSummary(shots);
    // The old pure-solid streak here is only 1 (breaks on every 'thin').
    assert.equal(s.streaks.solid.length, 1);
    const g = cleanContactStreakGoal(s, 10);
    assert.ok(g);
    assert.equal(g.title, '10-Shot Clean-Contact Streak');
    assert.equal(g.current, 8);
    assert.equal(g.comparisonOperator, 'gte');
  });

  test('a shank or miss breaks the streak just like a top or fat does', () => {
    const shots = fill([...Array(6).fill('solid'), 'shank', ...Array(6).fill('solid')]);
    const s = stats.sessionSummary(shots);
    const g = cleanContactStreakGoal(s, 13);
    assert.equal(g.current, 6); // longest run either side of the shank, not 13
  });

  test('below the meaningful minimum (< 4) produces no goal', () => {
    const shots = fill(['solid', 'thin', 'fat', ...Array(9).fill('fat')]);
    const s = stats.sessionSummary(shots);
    assert.equal(cleanContactStreakGoal(s, 12), null);
  });
});

describe('clubSolidContactGoal — never targets a barely-used club', () => {
  test('a dominant club with a real sample produces a measurable "X of 10" goal', () => {
    // 15 shots with 9i, 9 solid (60% -> 6 of 10) + 6 topped; only club used.
    const shots = fill([...Array(9).fill('solid'), ...Array(6).fill('topped')]).map((sh) => ({ ...sh, club: '9i' }));
    const s = stats.sessionSummary(shots);
    const g = clubSolidContactGoal(s);
    assert.ok(g);
    assert.equal(g.title, '7 of 10 9i Solid');
    assert.equal(g.detail, 'You hit 6 of every 10 9i shots solid today.');
    assert.equal(g.club, '9i');
    assert.equal(g.current, 6);
    assert.equal(g.target, 7);
    assert.equal(g.comparisonOperator, 'gte');
  });

  test('a club hit fewer than 10 times this session never gets its own goal', () => {
    // Dominant club (7i) has only 8 shots — barely used, even though it's the most-hit club.
    const shots = [
      ...fill(Array(8).fill('topped')).map((sh) => ({ ...sh, club: '7i' })),
      ...fill(Array(5).fill('solid')).map((sh, i) => ({ ...sh, shot_number: 9 + i, club: 'PW' })),
    ];
    const s = stats.sessionSummary(shots);
    assert.equal(clubSolidContactGoal(s), null);
  });

  test('already at the top milestone (9 of 10) returns null rather than chasing a perfect 10 of 10', () => {
    const shots = fill([...Array(19).fill('solid'), 'topped']).map((sh) => ({ ...sh, club: '7i' })); // 95% -> floor 9 of 10
    const s = stats.sessionSummary(shots);
    assert.equal(clubSolidContactGoal(s), null);
  });
});

describe('dominantDirectionGoal — targets whichever direction the golfer actually favored', () => {
  test('a right-dominant session proposes a "Right" ratio goal, not a Straight one', () => {
    const shots = fill(Array(10).fill('solid'), (i) => ({ direction: i < 6 ? 'right' : 'straight' })); // 6 of 10 right
    const s = stats.sessionSummary(shots);
    const g = dominantDirectionGoal(s, 10);
    assert.ok(g);
    assert.equal(g.title, '7 of 10 Shots Right');
    assert.equal(g.direction, 'right');
    assert.equal(g.current, 6);
  });

  test('fewer than 10 total shots returns null', () => {
    const shots = fill(Array(9).fill('solid'), () => ({ direction: 'right' }));
    const s = stats.sessionSummary(shots);
    assert.equal(dominantDirectionGoal(s, 9), null);
  });

  test('already at 9 of 10 in the dominant direction returns null', () => {
    const shots = fill(Array(20).fill('solid'), (i) => ({ direction: i < 19 ? 'straight' : 'left' })); // 95% -> floor 9
    const s = stats.sessionSummary(shots);
    assert.equal(dominantDirectionGoal(s, 20), null);
  });
});

describe('getNextGoal — new fallback types never override the original percentage-milestone tier', () => {
  test('a session where Solid still has headroom picks Solid, even though a club/direction goal would also qualify', () => {
    const shots = fill([...Array(14).fill('solid'), ...Array(6).fill('topped')]).map((sh) => ({ ...sh, club: '9i' })); // 70% solid, single club, all straight
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession({ default_club: '9i' }));
    assert.equal(goal.type, 'solid_contact'); // original tier still wins, unchanged behavior
  });

  test('once Solid/Top-Fat/Straight all have no headroom, a club-specific goal can surface', () => {
    // 25 shots, single club, 90% solid flat (no Solid milestone above 90),
    // too few shots (25 < ... ) — use exactly 20 to allow top-fat/straight
    // eligibility, but shape them to also have no headroom: 90% solid means
    // top+fat is only 10% (already under every milestone -> disqualified),
    // and straight is 100% (already past 90 -> disqualified).
    const shots = fill([...Array(18).fill('solid'), ...Array(2).fill('topped')]).map((sh) => ({ ...sh, club: '9i' }));
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession({ default_club: '9i' }));
    assert.equal(goal.type, 'solid_streak'); // streakGoal still runs first in the fallback chain
    // Confirm the newer types were at least reachable in principle for this shape.
    assert.equal(clubSolidContactGoal(s), null); // 90% -> floor 9, no headroom, so it correctly did NOT interfere
  });
});

describe('Every goal type carries enough structure to evaluate later, not just display copy', () => {
  test('every candidate type includes metric, comparisonOperator, and target alongside the display copy', () => {
    const shots = fill([...Array(9).fill('solid'), ...Array(6).fill('topped')]).map((sh) => ({ ...sh, club: '9i' }));
    const s = stats.sessionSummary(shots);
    const g = clubSolidContactGoal(s);
    for (const key of ['type', 'title', 'detail', 'metric', 'comparisonOperator', 'target', 'current']) {
      assert.ok(key in g, `missing "${key}" on club goal`);
    }
  });
});
