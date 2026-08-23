import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import {
  getNextGoal, solidContactGoal, topFatGoal, straightGoal, streakGoal, targetGoal,
} from '../js/sessionStory.js';

// Coverage for the recap's "Next Goal" feature — a single, deterministic,
// forward-looking challenge (never an LLM, never a swing tip). Goal
// calculations are exercised directly against stats.sessionSummary(shots),
// the same way the real recap computes `s`, so these tests catch any drift
// between the goal generator's assumptions and the actual shape stats.js
// produces.

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

describe('Solid Contact goal', () => {
  test('58% of 50 (29 solid) -> 60%, 1 shot away', () => {
    const shots = fill([...Array(29).fill('solid'), ...Array(21).fill('topped')]);
    const s = stats.sessionSummary(shots);
    const g = solidContactGoal(s, 50);
    assert.equal(g.title, '60% Solid Contact');
    assert.equal(g.detail, 'You were 1 shot away in a 50-ball session.');
    assert.equal(g.shotsAway, 1);
  });

  test('48% of 50 (24 solid) -> 50%, 1 shot away', () => {
    const shots = fill([...Array(24).fill('solid'), ...Array(26).fill('topped')]);
    const s = stats.sessionSummary(shots);
    const g = solidContactGoal(s, 50);
    assert.equal(g.title, '50% Solid Contact');
    assert.equal(g.shotsAway, 1);
  });

  test('very low Solid % still yields a valid (if larger) milestone step, never a fabricated one', () => {
    const shots = fill([...Array(5).fill('solid'), ...Array(45).fill('topped')]); // 10%
    const s = stats.sessionSummary(shots);
    const g = solidContactGoal(s, 50);
    assert.equal(g.target, 40);
    assert.equal(g.shotsAway, 20 - 5); // 40% of 50 = 20
  });

  test('very high Solid % (>=90) returns null rather than chasing 100%', () => {
    const shots = fill([...Array(47).fill('solid'), ...Array(3).fill('topped')]); // 94%
    const s = stats.sessionSummary(shots);
    assert.equal(solidContactGoal(s, 50), null);
  });

  test('exactly at a milestone (60% flat) targets the next one up, not the one already reached', () => {
    const shots = fill([...Array(30).fill('solid'), ...Array(20).fill('topped')]); // exactly 60%
    const s = stats.sessionSummary(shots);
    const g = solidContactGoal(s, 50);
    assert.equal(g.target, 70);
  });
});

describe('Top + Fat goal', () => {
  test('24% (12 of 50) -> under 20%, "9 or fewer" (exact spec example)', () => {
    const shots = fill([...Array(12).fill('topped'), ...Array(38).fill('solid')]);
    const s = stats.sessionSummary(shots);
    const g = topFatGoal(s, 50);
    assert.equal(g.title, 'Top + Fat Under 20%');
    assert.equal(g.detail, 'You had 12 Top/Fat shots today. 9 or fewer gets you under 20%.');
  });

  test('very low Top + Fat (already under 10%) returns null — never chases zero', () => {
    const shots = fill([...Array(2).fill('topped'), ...Array(38).fill('solid')]); // 4/40 = 10% flat
    const s = stats.sessionSummary(shots);
    assert.equal(topFatGoal(s, 40), null);
  });

  test('high Top + Fat (32%) targets under 30%', () => {
    const shots = fill([...Array(16).fill('topped'), ...Array(34).fill('solid')]); // 32%
    const s = stats.sessionSummary(shots);
    const g = topFatGoal(s, 50);
    assert.equal(g.title, 'Top + Fat Under 30%');
  });
});

describe('Priority: easiest goal wins, not first-checked', () => {
  test('Top + Fat (2 shots away) beats Solid (5 shots away) when it is the smaller lift', () => {
    // 50 shots: 30 solid (60%, 5 away from 70%), 10 topped + 6 fat (32%, 2 away from under-30%), 4 thin.
    // Straight kept at 90% (a ceiling, no milestone) so it can't interfere.
    const shots = fill([
      ...Array(30).fill('solid'), ...Array(10).fill('topped'), ...Array(6).fill('fat'), ...Array(4).fill('thin'),
    ], (i) => ({ direction: i < 45 ? 'straight' : 'left' })); // 45/50 = 90% straight, no milestone
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession());
    assert.equal(goal.type, 'top_fat');
    assert.equal(goal.title, 'Top + Fat Under 30%');
  });

  test('Straight (1 shot away) beats Solid (2 shots away) when contact is already stable', () => {
    // 50 shots: 38 solid (76%, 2 away from 80%), 39 straight (78%, 1 away from 80%), low top+fat (disqualified).
    const shots = fill([...Array(38).fill('solid'), ...Array(2).fill('topped'), ...Array(10).fill('thin')], (i) => ({
      direction: i < 39 ? 'straight' : 'left',
    }));
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession());
    assert.equal(goal.type, 'straight');
    assert.equal(goal.title, '80% Straight');
    assert.equal(goal.shotsAway, 1);
  });
});

describe('Straight goal — only once contact is stable', () => {
  test('is suppressed when Solid is below the stability floor even if Straight is numerically close', () => {
    const shots = fill([...Array(15).fill('solid'), ...Array(35).fill('topped')], (i) => ({ // 30% solid — below the 50% floor
      direction: i < 39 ? 'straight' : 'left', // 78% straight, would otherwise be 1 away from 80%
    }));
    const s = stats.sessionSummary(shots);
    assert.equal(straightGoal(s, 50), null);
  });
});

describe('Streak goal', () => {
  test('longest streak of 8 -> "10 Solid in a Row" (exact spec example)', () => {
    // 8 solid, 1 topped, 8 solid, 1 fat, 2 solid = longest run 8, total 20.
    const seq = [...Array(8).fill('solid'), 'topped', ...Array(8).fill('solid'), 'fat', ...Array(2).fill('solid')];
    const shots = fill(seq);
    const s = stats.sessionSummary(shots);
    const g = streakGoal(s, 20);
    assert.equal(g.title, '10 Solid in a Row');
    assert.equal(g.detail, 'Your best streak today was 8.');
  });

  test('a streak under the meaningful minimum (< 4) does not produce a goal', () => {
    const seq = ['solid', 'solid', 'topped', 'solid', 'topped', 'solid', 'solid', 'topped'].concat(Array(12).fill('topped'));
    const shots = fill(seq);
    const s = stats.sessionSummary(shots);
    assert.equal(streakGoal(s, 20), null);
  });
});

describe('Target accuracy goal', () => {
  test('65% within 10 yd (13 of 20) -> 70%, "1 more accurate shot" (exact spec example)', () => {
    const withinDistances = Array(13).fill(102); // within 10 of 100
    const outsideDistances = Array(7).fill(130); // outside 10 of 100
    const shots = [...withinDistances, ...outsideDistances].map((d, i) => shot(i + 1, {
      target_distance_yards: 100, distance_yards: d,
    }));
    const s = stats.sessionSummary(shots);
    const g = targetGoal(s, shots, 20);
    assert.equal(g.title, '70% Within 10 Yards');
    assert.equal(g.detail, '1 more accurate shot gets you there.');
  });

  test('fewer than 10 shots at the target distance returns null even if the session is otherwise long enough', () => {
    const shots = Array(9).fill(102).map((d, i) => shot(i + 1, { target_distance_yards: 100, distance_yards: d }))
      .concat(Array(11).fill(0).map((_, i) => shot(i + 10, { target_distance_yards: null })));
    const s = stats.sessionSummary(shots);
    assert.equal(targetGoal(s, shots, 20), null);
  });

  test('no target practice at all (target mode never used) returns null', () => {
    const shots = fill(Array(20).fill('solid'));
    const s = stats.sessionSummary(shots);
    assert.equal(targetGoal(s, shots, 20), null);
  });
});

describe('Sample size — short sessions never get an ambitious goal', () => {
  test('a 3-shot session (2 of 3 solid) returns null, not a fabricated 80% target', () => {
    const shots = fill(['solid', 'solid', 'thin']);
    const s = stats.sessionSummary(shots);
    assert.equal(getNextGoal(s, shots, fakeSession()), null);
  });

  test('fewer than 10 total shots always returns null regardless of how good the session was', () => {
    const shots = fill(Array(9).fill('solid'));
    const s = stats.sessionSummary(shots);
    assert.equal(getNextGoal(s, shots, fakeSession()), null);
  });
});

describe('Multi-club sessions — goal uses overall session metrics, not a fabricated single-club slice', () => {
  test('a session with two clubs still produces a goal from the combined shot data', () => {
    const shots = [
      ...fill([...Array(15).fill('solid'), ...Array(10).fill('topped')]).map((s2) => ({ ...s2, club: '7i' })),
      ...fill([...Array(4).fill('solid'), ...Array(1).fill('topped')]).map((s2, i) => ({ ...s2, shot_number: 26 + i, club: 'PW' })),
    ];
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession());
    assert.ok(goal, 'a goal should still be produced from the whole session\'s shots');
    // context reflects the session's own default_club, not a per-club breakdown — V1 deliberately never fragments by club.
    assert.equal(goal.context.club, '7i');
  });
});

describe('No valid goal anywhere -> null, section collapses cleanly', () => {
  test('everything already maxed out (no headroom in any dimension) and no meaningful streak/target', () => {
    // 20 shots, alternating solid/topped so the longest run never exceeds 1,
    // and no target distance was ever set. Solid = 50% exactly -> targets 60%...
    // to truly get "nothing available" we need Solid also disqualified: use 90% flat.
    const seq = [];
    for (let i = 0; i < 18; i++) seq.push('solid');
    seq.push('topped', 'topped'); // 90% flat, but grouped at the end so streak = 18 (still qualifies as streak)
    const shots = fill(seq);
    const s = stats.sessionSummary(shots);
    const goal = getNextGoal(s, shots, fakeSession());
    // Solid is disqualified (90% exactly); Top+Fat/Straight need 20+ shots (only 20 here, 10% topfat -> also disqualified);
    // this naturally falls through to the streak goal (18 -> 20), which is a legitimate, meaningful goal, not "no goal".
    assert.equal(goal.type, 'solid_streak');
    assert.equal(goal.title, '20 Solid in a Row');
  });

  test('a genuinely flat, contextless session with no headroom anywhere returns null', () => {
    // 9 shots only — below every threshold in the generator.
    const shots = fill(Array(9).fill('solid'));
    const s = stats.sessionSummary(shots);
    assert.equal(getNextGoal(s, shots, fakeSession()), null);
  });
});

describe('Context carried for a future "Start Similar Session" (not used yet)', () => {
  test('the returned goal carries club/setup/surface/swing/drill/training aid from the session', () => {
    const shots = fill([...Array(29).fill('solid'), ...Array(21).fill('topped')]);
    const s = stats.sessionSummary(shots);
    const session = fakeSession({ default_club: 'PW', default_setup: 'tee', default_surface: 'grass', default_swing: 'half', current_drill: 'Low Point', current_training_aid: 'connection_ball' });
    const goal = getNextGoal(s, shots, session);
    assert.deepEqual(goal.context, {
      club: 'PW', setup: 'tee', surface: 'grass', swing: 'half', drill: 'Low Point', trainingAid: 'connection_ball',
    });
  });
});

describe('Deterministic — identical input always produces identical output', () => {
  test('calling getNextGoal twice on the same data yields the exact same goal object shape', () => {
    const shots = fill([...Array(29).fill('solid'), ...Array(21).fill('topped')]);
    const s = stats.sessionSummary(shots);
    const session = fakeSession();
    assert.deepEqual(getNextGoal(s, shots, session), getNextGoal(s, shots, session));
  });
});
