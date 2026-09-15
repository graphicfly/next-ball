import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// A session with an exact solid/thin split, straight direction throughout —
// deliberately shaped so ONLY solidContactGoal (of the three candidate
// goal types in sessionStory.js's getNextGoal) produces a result: thin
// shots never count toward topFatGoal, and 100% straight already exceeds
// straightGoal's top milestone, so both of those return null. This keeps
// the goal produced fully deterministic without depending on
// getNextGoal's internal "closest wins" tie-break logic.
async function makeSolidPctSession(db, { date, club = '7i', solidCount, total }) {
  const session = db.createSession({
    date, start_time: '10:00', target_ball_count: total,
    default_club: club, default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
  });
  for (let i = 0; i < total; i++) {
    const solid = i < solidCount;
    db.addShot(session.session_id, {
      club, setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: solid ? 'solid' : 'thin',
      direction: 'straight', height: 'medium',
      distance_yards: 140,
    });
  }
  return session;
}

// A session with too few shots for ANY goal type to produce a result
// (getNextGoal's every threshold — solid/top-fat/straight/streak/target —
// requires at least 10 shots, and none is set here).
async function makeShortSession(db, { date, club = '7i', total = 3 }) {
  const session = db.createSession({
    date, start_time: '10:00', target_ball_count: total,
    default_club: club, default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
  });
  for (let i = 0; i < total; i++) {
    db.addShot(session.session_id, {
      club, setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140,
    });
  }
  return session;
}

describe('finalizeSessionGoal — creation', () => {
  test('finishing a session that produces a goal creates it as the active goal', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(session.session_id);
    const created = finalizeSessionGoal(session.session_id);

    assert.ok(created);
    assert.equal(created.type, 'solid_contact');
    assert.equal(created.title, '80% Solid Contact');
    assert.equal(created.status, 'active');
    assert.equal(created.session_id, session.session_id);
    assert.equal(created.resolved_at, null);
    assert.equal(created.superseded_by, null);

    const active = db.getActiveGoal();
    assert.deepEqual(active, created);

    const bySession = db.getGoalForSession(session.session_id);
    assert.deepEqual(bySession, created);
  });

  test('a session with too few shots to produce a goal leaves no active goal, but does not error', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeShortSession(db, { date: '2026-01-01' });
    db.finishSession(session.session_id);
    const result = finalizeSessionGoal(session.session_id);

    assert.equal(result, null);
    assert.equal(db.getActiveGoal(), null);
    assert.equal(db.getGoalForSession(session.session_id), null);
  });

  test('calling finalizeSessionGoal twice for the same session is idempotent (no duplicate, no self-supersede)', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(session.session_id);
    const first = finalizeSessionGoal(session.session_id);
    const second = finalizeSessionGoal(session.session_id);

    assert.ok(first);
    assert.equal(second, null); // already finalized — no-op, not a second record
    assert.equal(db.getGoals().filter((g) => g.session_id === session.session_id).length, 1);
    assert.equal(db.getActiveGoal().status, 'active');
    assert.equal(db.getActiveGoal().goal_id, first.goal_id);
  });
});

describe('finalizeSessionGoal — lifecycle handoff', () => {
  test('a later session with enough comparable data EVALUATES the previous active goal instead of blindly replacing it', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 }); // 70% -> goal: 80%
    db.finishSession(sessionA.session_id);
    const goalA = finalizeSessionGoal(sessionA.session_id);

    const sessionB = await makeSolidPctSession(db, { date: '2026-01-02', solidCount: 16, total: 20 }); // 80% -> exactly hits goalA's target
    db.finishSession(sessionB.session_id);
    const result = finalizeSessionGoal(sessionB.session_id);

    // This session does NOT auto-create a replacement — evaluating an
    // existing goal and creating a new one are mutually exclusive per
    // session; the golfer decides what happens next (see
    // setNewGoalFromSession/continueGoal/dismissGoalForSession).
    assert.equal(result, null);
    assert.equal(db.getActiveGoal(), null);

    const resolvedA = db.getGoalForSession(sessionA.session_id);
    assert.equal(resolvedA.goal_id, goalA.goal_id);
    assert.equal(resolvedA.status, 'met');
    assert.ok(resolvedA.resolved_at);
    assert.equal(resolvedA.evaluation.outcome, 'met');
    assert.equal(resolvedA.evaluation.evaluated_by_session_id, sessionB.session_id);
    assert.equal(resolvedA.evaluation.actual, 80);
    assert.equal(resolvedA.evaluation.target, 80);
  });

  test('choosing "Set New Goal" after a conclusive evaluation creates a fresh goal from that same session', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal, setNewGoalFromSession } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(sessionA.session_id);
    finalizeSessionGoal(sessionA.session_id);

    const sessionB = await makeSolidPctSession(db, { date: '2026-01-02', solidCount: 16, total: 20 });
    db.finishSession(sessionB.session_id);
    finalizeSessionGoal(sessionB.session_id); // resolves goalA, creates nothing yet

    const goalB = setNewGoalFromSession(sessionB.session_id);
    assert.ok(goalB);
    assert.equal(goalB.status, 'active');
    assert.equal(db.getActiveGoal().goal_id, goalB.goal_id);
    assert.equal(db.getGoals().length, 2); // history has both, not just the current one

    // Calling it again for the same session is a safe no-op, not a duplicate.
    assert.equal(setNewGoalFromSession(sessionB.session_id), null);
    assert.equal(db.getGoals().length, 2);
  });

  test('"Continue This Goal" reactivates a resolved goal so the golfer gets another shot at the same target', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal, continueGoal } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(sessionA.session_id);
    const goalA = finalizeSessionGoal(sessionA.session_id);

    const sessionB = await makeSolidPctSession(db, { date: '2026-01-02', solidCount: 15, total: 20 }); // 75% -> almost (5 short... actually within margin)
    db.finishSession(sessionB.session_id);
    finalizeSessionGoal(sessionB.session_id);
    assert.equal(db.getGoalForSession(sessionA.session_id).status, 'partially_met');

    const reactivated = continueGoal(goalA.goal_id);
    assert.equal(reactivated.status, 'active');
    assert.equal(reactivated.resolved_at, null);
    assert.equal(db.getActiveGoal().goal_id, goalA.goal_id);
  });

  test('"Dismiss For Now" marks the evaluation acknowledged without changing the goal\'s resolved status', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal, dismissGoalForSession } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(sessionA.session_id);
    const goalA = finalizeSessionGoal(sessionA.session_id);

    const sessionB = await makeSolidPctSession(db, { date: '2026-01-02', solidCount: 16, total: 20 });
    db.finishSession(sessionB.session_id);
    finalizeSessionGoal(sessionB.session_id);

    const dismissed = dismissGoalForSession(goalA.goal_id);
    assert.equal(dismissed.status, 'met'); // unchanged
    assert.equal(dismissed.evaluation.dismissed, true);
    assert.equal(db.getActiveGoal(), null); // still nothing active — dismissing sets nothing new
  });

  test('a session that produces no goal leaves the existing active goal exactly as it was', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(sessionA.session_id);
    const goalA = finalizeSessionGoal(sessionA.session_id);

    const sessionB = await makeShortSession(db, { date: '2026-01-02' });
    db.finishSession(sessionB.session_id);
    const result = finalizeSessionGoal(sessionB.session_id);

    assert.equal(result, null);
    const active = db.getActiveGoal();
    assert.ok(active);
    assert.equal(active.goal_id, goalA.goal_id);
    assert.equal(active.status, 'active'); // untouched, not superseded by a non-goal
  });
});

describe('Goal persistence — survives a simulated reload', () => {
  test('the exact same active goal is returned after dropping the in-memory cache (reload) without touching storage', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(session.session_id);
    const created = finalizeSessionGoal(session.session_id);

    // Confirm it's actually in localStorage, not just an in-memory object.
    const raw = globalThis.localStorage.getItem('rangelog_index_v1');
    assert.ok(raw && raw.includes(created.goal_id));

    // Simulates a full page reload: drops db.js's module-scope cache
    // WITHOUT clearing the underlying storage (unlike resetDB(), which
    // clears both), forcing the next read to genuinely re-parse from
    // localStorage rather than returning an already-loaded in-memory object.
    db.__resetForTests();

    const reloaded = db.getActiveGoal();
    assert.deepEqual(reloaded, created);
    assert.deepEqual(db.getGoalForSession(session.session_id), created);
  });
});

describe('Goal persistence — session deletion cascades correctly', () => {
  test('deleting a session removes the goal it produced; restoreSession puts it back', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(session.session_id);
    const goal = finalizeSessionGoal(session.session_id);

    const removed = db.deleteSession(session.session_id);
    assert.ok(removed.goal);
    assert.equal(removed.goal.goal_id, goal.goal_id);
    assert.equal(db.getActiveGoal(), null);
    assert.equal(db.getGoalForSession(session.session_id), null);

    const restored = db.restoreSession(removed.session, removed.shots, removed.goal);
    assert.equal(restored, true);
    assert.deepEqual(db.getActiveGoal(), goal);
  });

  test('restoring an old "active" goal after a different goal became active in the meantime demotes it to superseded instead of creating two active goals', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const sessionA = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(sessionA.session_id);
    const goalA = finalizeSessionGoal(sessionA.session_id);

    const removed = db.deleteSession(sessionA.session_id); // goalA removed along with sessionA
    assert.equal(db.getActiveGoal(), null);

    const sessionB = await makeSolidPctSession(db, { date: '2026-01-02', solidCount: 16, total: 20 });
    db.finishSession(sessionB.session_id);
    const goalB = finalizeSessionGoal(sessionB.session_id); // becomes active with nothing to supersede

    db.restoreSession(removed.session, removed.shots, removed.goal); // undo the deletion of sessionA

    const activeGoals = db.getGoals().filter((g) => g.status === 'active');
    assert.equal(activeGoals.length, 1);
    assert.equal(activeGoals[0].goal_id, goalB.goal_id);

    const restoredGoalA = db.getGoalForSession(sessionA.session_id);
    assert.equal(restoredGoalA.status, 'superseded');
    assert.equal(restoredGoalA.superseded_by, goalB.goal_id);
  });
});

describe('Goal persistence — backup/restore round-trip', () => {
  test('exportFullDB/importFullDB carries goals through unchanged', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { finalizeSessionGoal } = await import('../js/sessionAnalysis.js');

    const session = await makeSolidPctSession(db, { date: '2026-01-01', solidCount: 14, total: 20 });
    db.finishSession(session.session_id);
    const goal = finalizeSessionGoal(session.session_id);

    const backup = db.exportFullDB();
    assert.ok(Array.isArray(backup.goals));
    assert.equal(backup.goals.length, 1);

    await (await import('./setup.js')).resetDB(); // full wipe, simulating a different device
    db.importFullDB(backup);

    assert.deepEqual(db.getActiveGoal(), goal);
  });

  test('importing an older backup with no goals field defaults to an empty array rather than crashing', async () => {
    const db = await (await import('./setup.js')).resetDB();
    db.importFullDB({ schemaVersion: 1, sessions: [], shots: [], settings: {} });
    assert.deepEqual(db.getGoals(), []);
    assert.equal(db.getActiveGoal(), null);
  });
});
