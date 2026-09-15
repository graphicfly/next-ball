import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import { getNextGoal, evaluateGoal, clubSolidContactGoal, topFatGoal } from '../js/sessionStory.js';

// Coverage for evaluateGoal — checking a previously-persisted goal against
// a LATER session's shots. Every test builds a real goal via the actual
// generator (not a hand-typed fixture) so drift between what getNextGoal
// produces and what evaluateGoal expects would show up immediately.

function shot(n, overrides = {}) {
  return {
    shot_id: `s${n}`, shot_number: n, strike: 'solid', direction: 'straight', height: 'medium',
    distance_yards: 150, club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
    drill: null, training_aid: 'none', target_distance_yards: null,
    ...overrides,
  };
}

function fakeSession(overrides = {}) {
  return {
    session_id: 'sess-1', default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    current_drill: 'Normal Swing', current_training_aid: 'none',
    ...overrides,
  };
}

function shotsWithClub(strikes, club) {
  return strikes.map((strike, i) => shot(i + 1, { strike, club }));
}

describe('evaluateGoal — the exact product examples', () => {
  test('"Get at least 6 of 10 9i shots solid": 10+ relevant 9i shots evaluates the rule (met)', () => {
    // Found the goal on an 8/15 9i session (53% -> floor 5, target 6).
    const foundingShots = shotsWithClub([...Array(8).fill('solid'), ...Array(7).fill('topped')], '9i');
    const s0 = stats.sessionSummary(foundingShots);
    const goal = { ...clubSolidContactGoal(s0), context: { club: '9i' } };
    assert.equal(goal.title, '6 of 10 9i Solid');

    // A later session with 10 relevant 9i shots, 7 solid (70% -> 7 of 10).
    const laterShots = shotsWithClub([...Array(7).fill('solid'), ...Array(3).fill('topped')], '9i');
    const laterSummary = stats.sessionSummary(laterShots);
    const result = evaluateGoal(goal, fakeSession(), laterShots, laterSummary);

    assert.equal(result.outcome, 'met');
    assert.equal(result.actual, 7);
    assert.equal(result.target, 6);
    assert.equal(result.relevantShotCount, 10);
    assert.match(result.detail, /7 of 10/);
  });

  test('"Get at least 6 of 10 9i shots solid": only 4 comparable 9i shots -> NOT ENOUGH DATA, goal untouched', () => {
    const foundingShots = shotsWithClub([...Array(8).fill('solid'), ...Array(7).fill('topped')], '9i');
    const goal = { ...clubSolidContactGoal(stats.sessionSummary(foundingShots)), context: { club: '9i' } };

    // Later session: only 4 shots with 9i, plus a bunch of other clubs.
    const laterShots = [
      ...shotsWithClub(['solid', 'solid', 'topped', 'solid'], '9i'),
      ...shotsWithClub(Array(10).fill('solid'), '7i'),
    ];
    const laterSummary = stats.sessionSummary(laterShots);
    const result = evaluateGoal(goal, fakeSession(), laterShots, laterSummary);

    assert.equal(result.outcome, 'not_enough_data');
    assert.equal(result.actual, null);
    assert.equal(result.relevantShotCount, 4);
    assert.equal(result.requiredShotCount, 10);
    assert.match(result.detail, /4 9i shots/);
  });

  test('one short of the ratio target reads as "almost", not a fail', () => {
    const foundingShots = shotsWithClub([...Array(8).fill('solid'), ...Array(7).fill('topped')], '9i');
    const goal = { ...clubSolidContactGoal(stats.sessionSummary(foundingShots)), context: { club: '9i' } }; // target 6

    const laterShots = shotsWithClub([...Array(5).fill('solid'), ...Array(5).fill('topped')], '9i'); // 50% -> 5 of 10
    const result = evaluateGoal(goal, fakeSession(), laterShots, stats.sessionSummary(laterShots));

    assert.equal(result.outcome, 'almost');
    assert.equal(result.actual, 5);
    assert.match(result.detail, /5 of 10/);
  });

  test('"Reduce topped shots below 20%": evaluates against the whole comparable session, not a slice', () => {
    // Founding session: 32% topped (whole-session metric; context.club records
    // what club the founding session was about, but the metric itself is
    // never club-filtered — same as when it was first generated).
    const founding = Array.from({ length: 50 }, (_, i) => shot(i + 1, { strike: i < 16 ? 'topped' : 'solid' }));
    const goal = { ...topFatGoal(stats.sessionSummary(founding), 50), context: { club: '7i' } };
    assert.equal(goal.title, 'Top + Fat Under 30%');

    // Later session, same dominant club (7i), 15% topped -> comfortably under 30%.
    const later = Array.from({ length: 20 }, (_, i) => shot(i + 1, { strike: i < 3 ? 'topped' : 'solid' }));
    const result = evaluateGoal(goal, fakeSession(), later, stats.sessionSummary(later));
    assert.equal(result.outcome, 'met');
    assert.equal(result.actual, 15);
  });
});

describe('evaluateGoal — comparability gates (never an unrelated club)', () => {
  test('a whole-session goal is NOT evaluated against a session whose dominant club differs from the goal\'s founding club', () => {
    const founding = Array.from({ length: 20 }, (_, i) => shot(i + 1, { strike: i < 6 ? 'topped' : 'solid', club: '7i' }));
    const goal = getNextGoal(stats.sessionSummary(founding), founding, fakeSession({ default_club: '7i' }));
    assert.equal(goal.context.club, '7i');

    // A later session that's actually mostly Driver, even though contact is great.
    const later = shotsWithClub(Array(20).fill('solid'), 'Driver');
    const result = evaluateGoal(goal, fakeSession(), later, stats.sessionSummary(later));
    assert.equal(result.outcome, 'not_enough_data');
    assert.equal(result.relevantShotCount, 0);
  });

  test('a streak goal needs at least as many shots as the target length, even if that exceeds the usual minimum', () => {
    // Force a streak goal with a 20-shot target.
    const goal = {
      type: 'solid_streak', title: '20 Solid in a Row', detail: '', metric: 'solid_streak',
      comparisonOperator: 'gte', target: 20, current: 18, context: { club: '7i' },
    };
    const later = Array.from({ length: 15 }, (_, i) => shot(i + 1, { strike: 'solid', club: '7i' })); // can never reach 20
    const result = evaluateGoal(goal, fakeSession(), later, stats.sessionSummary(later));
    assert.equal(result.outcome, 'not_enough_data');
    assert.equal(result.requiredShotCount, 20);
  });
});

describe('evaluateGoal — result shape carries enough to persist and explain later', () => {
  test('every conclusive result includes session linkage fields the caller adds, plus target/actual/metric', () => {
    const foundingShots = shotsWithClub([...Array(8).fill('solid'), ...Array(7).fill('topped')], '9i');
    const goal = { ...clubSolidContactGoal(stats.sessionSummary(foundingShots)), context: { club: '9i' } };
    const laterShots = shotsWithClub(Array(10).fill('solid'), '9i');
    const result = evaluateGoal(goal, fakeSession(), laterShots, stats.sessionSummary(laterShots));
    for (const key of ['outcome', 'actual', 'target', 'comparisonOperator', 'relevantShotCount', 'requiredShotCount', 'metric', 'headline', 'detail']) {
      assert.ok(key in result, `missing "${key}" on evaluation result`);
    }
  });
});
