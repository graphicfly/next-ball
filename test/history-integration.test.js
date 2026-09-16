import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import { roundTotals } from '../js/roundAnalysis.js';

// History with rounds merged in — docs/course-mode-spec.md §11.9, §7.9.
//
// History is a VIEW over the two existing stores. Nothing is duplicated
// into a History-specific record: sessions and rounds keep their own ids,
// their own storage and their own lifecycles, and this only merges them for
// display.

function reload(db) {
  db.__resetForTests();
}

// The merge renderHistory performs, isolated so the ordering and inclusion
// rules can be asserted without a DOM.
function historyEntries(db) {
  return [
    ...db.listSessions().map((s) => ({ kind: 'session', at: s.created_at || '', id: s.session_id, status: s.status })),
    ...db.listRounds().map((r) => ({ kind: 'round', at: r.created_at || '', id: r.round_id, status: r.status })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

async function makeSession(db, { date = '2026-09-16', finished = true, shots = 3, dataSource } = {}) {
  const session = db.createSession({
    date, start_time: '10:00', target_ball_count: 20,
    default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    ...(dataSource ? { data_source: dataSource } : {}),
  });
  for (let i = 0; i < shots; i++) {
    db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    });
  }
  if (finished) db.finishSession(session.session_id);
  return session;
}

async function makeRound(db, { date = '2026-09-16', holeCount = 9, played = null, finished = true, courseName = 'Oakmont Golf Center', city = 'Vienna', state = 'VA' } = {}) {
  const course = db.upsertCourse({ name: courseName, city, state, source: 'manual', hole_count: holeCount });
  const round = db.createRound({
    course_id: course.course_id, course_name: course.name,
    course_city: course.city, course_state: course.state,
    course_source: 'manual', date, hole_count: holeCount, hole_defs: db.defaultHoleDefs(holeCount),
  });
  const holes = played ?? holeCount;
  for (let n = 1; n <= holes; n++) db.upsertHole(round.round_id, n, { strokes: 5, putts: 2 });
  if (finished) db.finishRound(round.round_id);
  return { course, round };
}

describe('One combined, date-ordered list', () => {
  test('range sessions and course rounds appear together, newest first', async () => {
    const db = await resetDB();
    const older = await makeSession(db, { date: '2026-09-10' });
    await new Promise((r) => setTimeout(r, 2));
    const { round } = await makeRound(db, { date: '2026-09-12' });
    await new Promise((r) => setTimeout(r, 2));
    const newer = await makeSession(db, { date: '2026-09-14' });

    const entries = historyEntries(db);
    assert.deepEqual(entries.map((e) => e.kind), ['session', 'round', 'session']);
    assert.deepEqual(entries.map((e) => e.id), [newer.session_id, round.round_id, older.session_id]);
  });

  test('History stores nothing of its own — it is a view over both stores', async () => {
    const db = await resetDB();
    await makeSession(db);
    await makeRound(db);

    // The only keys are the index and the per-session/per-round chunks that
    // already existed. No history-specific record is written.
    const store = globalThis.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    assert.ok(keys.includes('rangelog_index_v1'));
    assert.equal(keys.filter((k) => k.includes('history')).length, 0);
    // Exactly one shots chunk and one holes chunk — nothing extra.
    assert.equal(keys.filter((k) => k.startsWith('rangelog_shots_v1_')).length, 1);
    assert.equal(keys.filter((k) => k.startsWith('rangelog_holes_v1_')).length, 1);
    const backup = db.exportFullDB();
    assert.equal(backup.sessions.length, 1);
    assert.equal(backup.rounds.length, 1);
  });
});

describe('Range sessions are unchanged', () => {
  test('an old range session still lists exactly as it did', async () => {
    const db = await resetDB();
    const session = await makeSession(db, { shots: 5 });

    const entries = historyEntries(db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'session');
    assert.equal(entries[0].id, session.session_id);
    assert.equal(db.getShotsForSession(session.session_id).length, 5);
  });

  test('a session saved before Course Mode existed still appears', async () => {
    const db = await resetDB();
    // An index exactly as schemaVersion 2 wrote it: no rounds key at all.
    globalThis.localStorage.setItem('rangelog_index_v1', JSON.stringify({
      schemaVersion: 2,
      sessions: [{
        session_id: 'legacy-1', date: '2025-06-01', start_time: '09:00', status: 'finished',
        created_at: '2025-06-01T09:00:00.000Z', target_ball_count: 20, default_club: '7i',
      }],
      goals: [],
      settings: {},
    }));
    reload(db);

    const entries = historyEntries(db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'legacy-1');
    assert.deepEqual(db.listRounds(), []);
  });

  test('an in-progress session is still listed as in progress, not finished', async () => {
    const db = await resetDB();
    await makeSession(db, { finished: false });
    const [entry] = historyEntries(db);
    assert.equal(entry.status, 'active');
    assert.notEqual(entry.status, 'finished');
  });
});

describe('Course rounds in History', () => {
  test('a completed 9-hole round carries everything the card needs', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { holeCount: 9 });

    const stored = db.getRound(round.round_id);
    const totals = roundTotals(db.getHolesForRound(round.round_id));
    assert.equal(stored.status, 'finished');
    assert.equal(stored.course_name, 'Oakmont Golf Center');
    assert.equal(stored.hole_count, 9);
    assert.equal(totals.strokes, 45);
    assert.equal(totals.hasPar, true);
    assert.equal(totals.toPar, 10); // 45 vs par 35
  });

  test('a completed 18-hole round reports 18 holes', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { holeCount: 18 });
    const totals = roundTotals(db.getHolesForRound(round.round_id));
    assert.equal(db.getRound(round.round_id).hole_count, 18);
    assert.equal(totals.holesPlayed, 18);
    assert.equal(totals.strokes, 90);
    assert.equal(totals.toPar, 20); // 90 vs par 70
  });

  test('a manual course round lists with its course name and city', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { courseName: 'Pine Ridge Muni', city: 'Vienna', state: 'VA' });
    const stored = db.getRound(round.round_id);
    assert.equal(stored.course_source, 'manual');
    assert.equal(stored.course_name, 'Pine Ridge Muni');
    assert.equal(stored.course_city, 'Vienna');
  });

  test('an in-progress round is never presented as completed', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { holeCount: 18, played: 7, finished: false });

    const [entry] = historyEntries(db);
    assert.equal(entry.kind, 'round');
    assert.equal(entry.status, 'active');
    assert.notEqual(entry.status, 'finished');
    // It genuinely has only the holes played so far, so no final score
    // could be implied from it.
    assert.equal(roundTotals(db.getHolesForRound(round.round_id)).holesPlayed, 7);
    assert.equal(db.listFinishedRounds().length, 0);
  });

  test('a paused round still appears, marked paused', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { played: 4, finished: false });
    db.pauseRound(round.round_id);
    reload(db);
    assert.equal(historyEntries(db)[0].status, 'paused');
  });

  test('a round with holes missing par shows no score to par rather than a wrong one', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'No Par Course', source: 'manual', hole_count: 9 });
    const round = db.createRound({
      course_id: course.course_id, course_name: course.name, course_source: 'manual',
      hole_count: 9, hole_defs: db.defaultHoleDefs(9),
    });
    db.upsertHole(round.round_id, 1, { strokes: 5, par: null });
    db.upsertHole(round.round_id, 2, { strokes: 4 });
    db.finishRound(round.round_id);

    assert.equal(roundTotals(db.getHolesForRound(round.round_id)).hasPar, false);
  });
});

describe('Discarded and deleted rounds', () => {
  test('a round discarded with no holes never reaches History', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { played: 0, finished: false });
    db.finishRound(round.round_id);
    db.deleteRound(round.round_id); // the zero-hole discard path

    reload(db);
    assert.deepEqual(historyEntries(db), []);
    assert.equal(db.getRound(round.round_id), null);
  });

  test('deleting a round removes it, its holes and its plan together', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db);
    db.createPlan(round.round_id, {
      signal: 'short_game', focus_title: 'Sharpen short game',
      focus_rationale: 'Extra shots around the green added strokes today.',
      goal_text: 'save 2–3 strokes', steps: [{ order: 1, title: 'Chipping', detail: '20 balls', ball_count: 20 }],
    });

    const removed = db.deleteRound(round.round_id);
    assert.ok(removed.plan);
    assert.equal(removed.holes.length, 9);

    reload(db);
    assert.deepEqual(historyEntries(db), []);
    assert.equal(db.getPlanForRound(round.round_id), null);
    assert.equal(db.getActivePlan(), null);
  });

  test('Undo puts the round, its holes and its plan back', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db);
    const plan = db.createPlan(round.round_id, {
      signal: 'putting', focus_title: 'Sharpen your putting',
      focus_rationale: 'You had 3 three-putt holes today.',
      goal_text: 'save 2–3 strokes', steps: [{ order: 1, title: 'Lag', detail: '20 putts', ball_count: 20 }],
    });

    const removed = db.deleteRound(round.round_id);
    assert.equal(db.restoreRound(removed.round, removed.holes, removed.plan), true);

    reload(db);
    assert.equal(db.getRound(round.round_id).round_id, round.round_id);
    assert.equal(db.getHolesForRound(round.round_id).length, 9);
    assert.equal(db.getPlanForRound(round.round_id).plan_id, plan.plan_id);
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
  });

  test('restoring will not create a second outstanding plan', async () => {
    const db = await resetDB();
    const first = await makeRound(db, { courseName: 'Course A' });
    const firstPlan = db.createPlan(first.round.round_id, {
      signal: 'short_game', focus_title: 'A', focus_rationale: 'a', goal_text: 'g', steps: [],
    });
    const removed = db.deleteRound(first.round.round_id);

    // A newer plan becomes outstanding during the undo window.
    const second = await makeRound(db, { courseName: 'Course B' });
    db.createPlan(second.round.round_id, {
      signal: 'putting', focus_title: 'B', focus_rationale: 'b', goal_text: 'g', steps: [],
    });

    db.restoreRound(removed.round, removed.holes, removed.plan);
    reload(db);

    assert.equal(db.getPlanForRound(first.round.round_id).status, 'superseded');
    assert.equal(db.getPlans().filter((p) => p.status === 'saved' || p.status === 'started').length, 1);
    assert.notEqual(db.getActivePlan().plan_id, firstPlan.plan_id);
  });

  test('an in-progress round cannot be deleted from History', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db, { played: 3, finished: false });
    assert.throws(() => db.deleteRound(round.round_id), (err) => err.code === 'active_round');
  });

  test('deleting a session still leaves rounds untouched, and the reverse', async () => {
    const db = await resetDB();
    const session = await makeSession(db);
    const { round } = await makeRound(db);

    db.deleteSession(session.session_id);
    reload(db);
    assert.equal(db.listRounds().length, 1);
    assert.equal(db.getHolesForRound(round.round_id).length, 9);

    db.deleteRound(round.round_id);
    reload(db);
    assert.equal(db.listSessions().length, 0);
    assert.equal(db.listRounds().length, 0);
  });
});

describe('Saved plans are reached through their round (§7.9)', () => {
  test('a round keeps its plan whatever the plan status', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db);
    const plan = db.createPlan(round.round_id, {
      signal: 'short_game', focus_title: 'Sharpen short game',
      focus_rationale: 'Extra shots around the green added strokes today.',
      goal_text: 'save 2–3 strokes', steps: [],
    });

    for (const status of ['started', 'completed', 'dismissed']) {
      db.resolvePlan(plan.plan_id, status);
      reload(db);
      // Concluded or not, the plan is still reachable from its round — that
      // is what keeps "why am I practicing this?" answerable.
      assert.equal(db.getPlanForRound(round.round_id).status, status);
    }
  });

  test('a concluded plan is no longer outstanding but is still attached', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db);
    const plan = db.createPlan(round.round_id, {
      signal: 'putting', focus_title: 'Sharpen your putting', focus_rationale: 'x', goal_text: 'g', steps: [],
    });
    db.resolvePlan(plan.plan_id, 'completed');

    assert.equal(db.getActivePlan(), null);
    assert.equal(db.getPlanForRound(round.round_id).plan_id, plan.plan_id);
  });

  test('no separate plan store exists — plans live with rounds', async () => {
    const db = await resetDB();
    const { round } = await makeRound(db);
    db.createPlan(round.round_id, { signal: 'short_game', focus_title: 'x', focus_rationale: 'y', goal_text: 'g', steps: [] });

    const backup = db.exportFullDB();
    assert.equal(backup.practice_plans.length, 1);
    assert.equal(backup.practice_plans[0].round_id, round.round_id);
  });
});

describe('Backward compatibility', () => {
  test('a pre-Course-Mode backup restores with sessions intact and no rounds', async () => {
    const db = await resetDB();
    await makeSession(db);
    await makeRound(db);

    db.importFullDB({
      schemaVersion: 2,
      sessions: [{ session_id: 'old-1', date: '2025-01-01', status: 'finished', created_at: '2025-01-01T10:00:00.000Z' }],
      shots: [],
      goals: [],
      settings: {},
    });
    reload(db);

    const entries = historyEntries(db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'old-1');
    assert.deepEqual(db.listRounds(), []);
    assert.deepEqual(db.getPlans(), []);
  });

  test('a full backup round-trips sessions, rounds and plans together', async () => {
    const db = await resetDB();
    const session = await makeSession(db);
    const { round } = await makeRound(db);
    db.createPlan(round.round_id, { signal: 'short_game', focus_title: 'x', focus_rationale: 'y', goal_text: 'g', steps: [] });

    const backup = db.exportFullDB();
    db.importFullDB(backup);
    reload(db);

    const entries = historyEntries(db);
    assert.equal(entries.length, 2);
    assert.equal(db.getShotsForSession(session.session_id).length, 3);
    assert.equal(db.getHolesForRound(round.round_id).length, 9);
    assert.equal(db.getPlanForRound(round.round_id).round_id, round.round_id);
  });
});
