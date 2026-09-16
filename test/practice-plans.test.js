import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import { practiceFocus } from '../js/roundAnalysis.js';

// Saved practice plans — docs/course-mode-spec.md §7. A plan is generated
// from a completed round, keeps its source round permanently, survives
// everything, and only one is ever outstanding.

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4]; // par 35

function reload(db) {
  db.__resetForTests();
}

// Rounds shaped to trigger each rule in roundAnalysis.js, so plans are
// tested across every focus type rather than just short game.
const ROUND_SHAPES = {
  putting: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] },
  short_game: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], sg: [2, 1, 1, 2, 1, 1, 0, 1, 0] },
  full_swing: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] },
  club: {
    strokes: [7, 7, 3, 4, 5, 4, 3, 4, 4],
    clubs: [['9i'], ['9i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
  },
  maintenance: { strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4] },
};

async function playRound(db, shape, { courseName = 'Oakmont Golf Center' } = {}) {
  const course = db.upsertCourse({ name: courseName, source: 'manual', hole_count: 9 });
  const holeDefs = db.defaultHoleDefs(9);
  const round = db.createRound({
    course_id: course.course_id, course_name: course.name,
    course_source: 'manual', hole_count: 9, hole_defs: holeDefs,
  });
  shape.strokes.forEach((s, i) => db.upsertHole(round.round_id, i + 1, {
    strokes: s,
    putts: shape.putts?.[i] ?? 2,
    short_game_strokes: shape.sg?.[i] ?? 0,
    clubs_used: shape.clubs?.[i] ?? [],
  }));
  db.finishRound(round.round_id);
  return round;
}

function focusFor(db, round) {
  return practiceFocus(round, db.getHolesForRound(round.round_id));
}

describe('Creating plans from every round-focus type', () => {
  for (const [name, shape] of Object.entries(ROUND_SHAPES)) {
    test(`a ${name} round saves a plan carrying that focus`, async () => {
      const db = await resetDB();
      const round = await playRound(db, shape);
      const focus = focusFor(db, round);

      const plan = db.createPlan(round.round_id, focus);

      assert.ok(plan.plan_id);
      assert.equal(plan.round_id, round.round_id);
      assert.equal(plan.status, 'saved');
      assert.equal(plan.focus_type, focus.signal);
      assert.equal(plan.focus_title, focus.focus_title);
      assert.equal(plan.focus_rationale, focus.focus_rationale);
      assert.equal(plan.goal_text, focus.goal_text);
      assert.ok(plan.created_at);
      assert.equal(plan.resolved_at, null);
      assert.equal(plan.started_session_id, null);
      assert.ok(plan.steps.length >= 2);
    });
  }

  test('the plan model carries every field needed to explain itself later', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game);
    const plan = db.createPlan(round.round_id, focusFor(db, round));

    for (const field of [
      'plan_id', 'round_id', 'created_at', 'status',
      'focus_type', 'focus_title', 'focus_rationale', 'goal_text', 'steps',
    ]) {
      assert.ok(plan[field] !== undefined, `missing ${field}`);
    }
  });

  test('steps are copied, not shared with the generator output', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const focus = focusFor(db, round);
    const plan = db.createPlan(round.round_id, focus);

    focus.steps[0].title = 'MUTATED';
    assert.notEqual(db.getPlanForRound(round.round_id).steps[0].title, 'MUTATED');
  });

  test('a plan cannot be created without a round or a focus', async () => {
    const db = await resetDB();
    assert.equal(db.createPlan(null, { focus_title: 'x' }), null);
    assert.equal(db.createPlan('r1', null), null);
    assert.equal(db.getPlans().length, 0);
  });
});

describe('Saving, reloading and retrieving', () => {
  test('a saved plan survives a reload with its content intact', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game);
    const focus = focusFor(db, round);
    const created = db.createPlan(round.round_id, focus);

    // Refresh, browser close, PWA relaunch — all the same to storage.
    reload(db);

    const loaded = db.getPlanForRound(round.round_id);
    assert.equal(loaded.plan_id, created.plan_id);
    assert.equal(loaded.focus_title, 'Sharpen short game');
    assert.equal(loaded.focus_rationale, 'Extra shots around the green added strokes today.');
    assert.equal(loaded.goal_text, 'save 2–3 strokes');
    assert.equal(loaded.steps.length, 3);
    assert.equal(loaded.steps[0].title, 'Chipping contact');
    assert.equal(loaded.steps[0].ball_count, 20);
  });

  test('it is still retrievable after many reloads, as it would be days later', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const created = db.createPlan(round.round_id, focusFor(db, round));

    for (let i = 0; i < 5; i++) reload(db);

    assert.equal(db.getActivePlan().plan_id, created.plan_id);
    assert.equal(db.getPlanForRound(round.round_id).plan_id, created.plan_id);
  });

  test('getActivePlan finds the outstanding plan; a concluded one is not outstanding', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.full_swing);
    const plan = db.createPlan(round.round_id, focusFor(db, round));
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);

    db.resolvePlan(plan.plan_id, 'completed');
    reload(db);
    assert.equal(db.getActivePlan(), null);
    // ...but it is still retrievable by its round, so the round can always
    // explain what it produced.
    assert.equal(db.getPlanForRound(round.round_id).status, 'completed');
  });

  test('a dismissed plan is no longer outstanding', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.club);
    const plan = db.createPlan(round.round_id, focusFor(db, round));
    db.resolvePlan(plan.plan_id, 'dismissed');
    assert.equal(db.getActivePlan(), null);
  });

  test('resolvePlan records the range session that ran the plan', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game);
    const plan = db.createPlan(round.round_id, focusFor(db, round));

    db.resolvePlan(plan.plan_id, 'started', { startedSessionId: 'session-123' });
    reload(db);

    const loaded = db.getPlanForRound(round.round_id);
    assert.equal(loaded.status, 'started');
    assert.equal(loaded.started_session_id, 'session-123');
    // A started plan is still outstanding — it has not concluded.
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
  });

  test('an unknown status is refused rather than written', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const plan = db.createPlan(round.round_id, focusFor(db, round));
    assert.equal(db.resolvePlan(plan.plan_id, 'nonsense'), null);
    assert.equal(db.getPlanForRound(round.round_id).status, 'saved');
  });
});

describe('Source round linkage', () => {
  test('the link survives reloads and status changes', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game);
    const plan = db.createPlan(round.round_id, focusFor(db, round));

    db.resolvePlan(plan.plan_id, 'started', { startedSessionId: 's1' });
    reload(db);
    db.resolvePlan(plan.plan_id, 'completed');
    reload(db);

    const loaded = db.getPlanForRound(round.round_id);
    assert.equal(loaded.round_id, round.round_id);
    // And the round it points at is still really there.
    assert.equal(db.getRound(loaded.round_id).round_id, round.round_id);
  });

  test('a plan explains itself from its own round, even after later rounds', async () => {
    const db = await resetDB();
    const first = await playRound(db, ROUND_SHAPES.putting, { courseName: 'Course A' });
    const plan = db.createPlan(first.round_id, focusFor(db, first));
    await playRound(db, ROUND_SHAPES.short_game, { courseName: 'Course B' });

    reload(db);
    const loaded = db.getPlanForRound(first.round_id);
    assert.equal(loaded.round_id, first.round_id);
    assert.equal(loaded.focus_type, 'putting');
  });

  test('deleting a round takes its plan with it rather than orphaning it', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game);
    db.createPlan(round.round_id, focusFor(db, round));

    const removed = db.deleteRound(round.round_id);
    assert.ok(removed.plan);

    reload(db);
    assert.equal(db.getPlanForRound(round.round_id), null);
    assert.equal(db.getActivePlan(), null);
    assert.equal(db.getPlans().length, 0);
  });
});

describe('Only one plan is outstanding at a time', () => {
  test('saving a new plan supersedes the previous one', async () => {
    const db = await resetDB();
    const first = await playRound(db, ROUND_SHAPES.putting, { courseName: 'Course A' });
    const firstPlan = db.createPlan(first.round_id, focusFor(db, first));

    const second = await playRound(db, ROUND_SHAPES.short_game, { courseName: 'Course B' });
    const secondPlan = db.createPlan(second.round_id, focusFor(db, second));

    reload(db);
    const old = db.getPlanForRound(first.round_id);
    assert.equal(old.status, 'superseded');
    assert.equal(old.superseded_by, secondPlan.plan_id);
    assert.ok(old.resolved_at);
    assert.equal(db.getActivePlan().plan_id, secondPlan.plan_id);
    // Superseded, not deleted — the older round can still explain itself.
    assert.equal(db.getPlans().length, 2);
    assert.notEqual(firstPlan.plan_id, secondPlan.plan_id);
  });

  test('a concluded plan is not superseded again by a later one', async () => {
    const db = await resetDB();
    const first = await playRound(db, ROUND_SHAPES.putting, { courseName: 'Course A' });
    const firstPlan = db.createPlan(first.round_id, focusFor(db, first));
    db.resolvePlan(firstPlan.plan_id, 'completed');

    const second = await playRound(db, ROUND_SHAPES.short_game, { courseName: 'Course B' });
    db.createPlan(second.round_id, focusFor(db, second));

    assert.equal(db.getPlanForRound(first.round_id).status, 'completed');
  });
});

describe('Backups and backward compatibility', () => {
  test('plans round-trip through a JSON backup', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.club);
    const plan = db.createPlan(round.round_id, focusFor(db, round));

    const backup = db.exportFullDB();
    assert.equal(backup.practice_plans.length, 1);

    db.importFullDB({ schemaVersion: 3, sessions: [], shots: [], settings: {} });
    assert.equal(db.getPlans().length, 0);

    db.importFullDB(backup);
    reload(db);

    const loaded = db.getPlanForRound(round.round_id);
    assert.equal(loaded.plan_id, plan.plan_id);
    assert.equal(loaded.focus_type, 'club');
    assert.equal(loaded.round_id, round.round_id);
  });

  test('an index written before plans existed gains the collection on read', async () => {
    const db = await resetDB();
    globalThis.localStorage.setItem('rangelog_index_v1', JSON.stringify({
      schemaVersion: 3, sessions: [], goals: [], rounds: [], courses: [], settings: {},
    }));
    reload(db);

    assert.deepEqual(db.getPlans(), []);
    assert.equal(db.getActivePlan(), null);
  });

  test('range sessions and goals are untouched by plans', async () => {
    const db = await resetDB();
    const session = db.createSession({
      date: '2026-09-16', start_time: '10:00', target_ball_count: 20,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    });
    db.finishSession(session.session_id);
    db.createGoal(session.session_id, { title: 'A goal', metric: 'solid_percentage', target: 50 });

    const round = await playRound(db, ROUND_SHAPES.putting);
    db.createPlan(round.round_id, focusFor(db, round));

    reload(db);
    assert.equal(db.getGoals().length, 1);
    assert.equal(db.getActiveGoal().title, 'A goal');
    assert.equal(db.listFinishedSessions().length, 1);
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
  });
});

// Regressions from the V3 QA pass. Each of these was reachable from the UI
// with a double tap, and none was covered before.
describe('Repeated taps and stale reads', () => {
  test('a round with several plans reports its outstanding one, not the first stored', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.short_game ?? ROUND_SHAPES.putting);
    const focus = focusFor(db, round);

    // Saving three times — one double tap on Save Practice Plan — supersedes
    // the earlier records rather than editing them.
    const first = db.createPlan(round.round_id, focus);
    const second = db.createPlan(round.round_id, focus);
    const third = db.createPlan(round.round_id, focus);

    const all = db.getDB().practice_plans.filter((p) => p.round_id === round.round_id);
    assert.equal(all.length, 3);
    assert.equal(all.filter((p) => p.status === 'saved').length, 1, 'exactly one stays outstanding');

    const shown = db.getPlanForRound(round.round_id);
    assert.equal(shown.plan_id, third.plan_id, 'Round Summary must show the live plan');
    assert.equal(shown.status, 'saved');
    assert.notEqual(shown.plan_id, first.plan_id);
    assert.notEqual(shown.plan_id, second.plan_id);
  });

  test('once every plan is concluded, the most recent one is still the round story', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const focus = focusFor(db, round);
    db.createPlan(round.round_id, focus);
    const latest = db.createPlan(round.round_id, focus);
    db.resolvePlan(latest.plan_id, 'dismissed');

    const shown = db.getPlanForRound(round.round_id);
    assert.equal(shown.plan_id, latest.plan_id);
    assert.equal(shown.status, 'dismissed');
  });

  test('deleting a round takes every plan it owns, and Undo brings them all back', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const focus = focusFor(db, round);
    db.createPlan(round.round_id, focus);
    db.createPlan(round.round_id, focus);

    const result = db.deleteRound(round.round_id);
    assert.equal(result.plans.length, 2);
    assert.equal(db.getDB().practice_plans.length, 0, 'no plan is stranded by the delete');

    assert.equal(db.restoreRound(result.round, result.holes, result.plans), true);
    assert.equal(db.getDB().practice_plans.length, 2);
    assert.equal(db.getPlanForRound(round.round_id).status, 'saved');
  });

  test('finishing an already-finished round leaves its completion time alone', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const first = db.getRound(round.round_id).completed_at;
    assert.ok(first);

    const again = db.finishRound(round.round_id);
    assert.equal(again.completed_at, first, 'a second finish must not restamp the round');
    assert.equal(db.getRound(round.round_id).completed_at, first);
  });

  test('a finished round refuses further hole writes', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const before = db.getHole(round.round_id, 1).strokes;

    const { hole, saved } = db.upsertHole(round.round_id, 1, { strokes: before + 4 });
    assert.equal(saved, false);
    assert.equal(hole, null);
    assert.equal(db.getHole(round.round_id, 1).strokes, before, 'a closed card stays closed');
  });

  test('deleting the session a plan was running unlinks it rather than stranding it', async () => {
    const db = await resetDB();
    const round = await playRound(db, ROUND_SHAPES.putting);
    const plan = db.createPlan(round.round_id, focusFor(db, round));

    const session = db.createSession({
      date: '2026-03-01', start_time: '10:00', target_ball_count: 10,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140,
    });
    db.resolvePlan(plan.plan_id, 'started', { startedSessionId: session.session_id });
    db.finishSession(session.session_id);
    assert.equal(db.getPlan(plan.plan_id).started_session_id, session.session_id);

    const result = db.deleteSession(session.session_id);
    const after = db.getPlan(plan.plan_id);
    assert.equal(after.started_session_id, null, 'no pointer to a session that no longer exists');
    assert.equal(after.status, 'saved', 'and it is waiting to be practiced again, not stuck started');

    db.restoreSession(result.session, result.shots, result.goal, result.plans);
    assert.equal(db.getPlan(plan.plan_id).started_session_id, session.session_id, 'Undo relinks it');
  });
});
