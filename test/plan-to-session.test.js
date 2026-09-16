import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import { practiceFocus, isRangePracticable, planBallCount } from '../js/roundAnalysis.js';

// Saved plan -> Range Session — docs/course-mode-spec.md §7.1 (lifecycle),
// §7.7 (range entry), §7.8 (pre-fill), §7.11 (completion), §11.8 (putting).

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4];

function reload(db) {
  db.__resetForTests();
}

const SHAPES = {
  putting: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] },
  short_game: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], sg: [2, 1, 1, 2, 1, 1, 0, 1, 0] },
  full_swing: { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] },
  club: {
    strokes: [7, 7, 3, 4, 5, 4, 3, 4, 4],
    clubs: [['9i'], ['9i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
  },
};

async function savedPlan(db, shapeName, { courseName = 'Oakmont Golf Center' } = {}) {
  const shape = SHAPES[shapeName];
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
  const focus = practiceFocus(round, db.getHolesForRound(round.round_id));
  return { round, focus, plan: db.createPlan(round.round_id, focus) };
}

// What Session Setup does when a plan is started: create a normal session,
// then mark the plan started against it. Mirrors start.js.
function startSessionFromPlan(db, plan, { club, ballCount } = {}) {
  const session = db.createSession({
    date: '2026-09-16', start_time: '10:00',
    target_ball_count: ballCount ?? planBallCount(plan.steps) ?? 50,
    default_club: club ?? (plan.focus_type === 'club' ? plan.focus_club : '7i'),
    default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
  });
  db.resolvePlan(plan.plan_id, 'started', { startedSessionId: session.session_id });
  return session;
}

// Mirrors home.js's resolvePlanForFinishedSession.
function finishSessionResolvingPlan(db, sessionId) {
  const shots = db.getShotsForSession(sessionId);
  db.finishSession(sessionId);
  if (shots.length === 0) {
    try { db.deleteSession(sessionId); } catch (e) { /* already finished */ }
  }
  const plan = db.getPlanForSession(sessionId);
  if (!plan || plan.status !== 'started') return;
  if (shots.length > 0) db.resolvePlan(plan.plan_id, 'completed');
  else db.reopenPlan(plan.plan_id);
}

function logShot(db, sessionId) {
  db.addShot(sessionId, {
    club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
  });
}

describe('Range entry when plans exist or do not', () => {
  test('no saved plans: nothing is outstanding and nothing is offered', async () => {
    const db = await resetDB();
    assert.equal(db.getActivePlan(), null);
  });

  test('one saved plan is the outstanding one', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
  });

  test('multiple plans: the most recent is outstanding and older ones are kept, not deleted', async () => {
    const db = await resetDB();
    const first = await savedPlan(db, 'short_game', { courseName: 'Course A' });
    const second = await savedPlan(db, 'full_swing', { courseName: 'Course B' });
    const third = await savedPlan(db, 'club', { courseName: 'Course C' });

    assert.equal(db.getActivePlan().plan_id, third.plan.plan_id);
    // Superseded, never silently removed — each stays attached to its round.
    assert.equal(db.getPlans().length, 3);
    assert.equal(db.getPlanForRound(first.round.round_id).status, 'superseded');
    assert.equal(db.getPlanForRound(second.round.round_id).status, 'superseded');
  });

  test('a concluded plan is never outstanding, so nothing is offered', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    db.resolvePlan(plan.plan_id, 'dismissed');
    assert.equal(db.getActivePlan(), null);
  });
});

describe('Starting a normal session despite a saved plan', () => {
  test('a normal session leaves the plan completely untouched', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');

    // Choosing "Start Normal Range Session" creates a session with no plan.
    const session = db.createSession({
      date: '2026-09-16', start_time: '10:00', target_ball_count: 50,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    logShot(db, session.session_id);
    finishSessionResolvingPlan(db, session.session_id);

    reload(db);
    const after = db.getPlan(plan.plan_id);
    assert.equal(after.status, 'saved');          // still outstanding
    assert.equal(after.started_session_id, null); // never linked
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
    assert.equal(db.getPlanForSession(session.session_id), null);
  });
});

describe('Starting a saved plan', () => {
  test('creates an ordinary session and links the plan to it', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);

    // An ordinary range session in every respect — no separate engine.
    assert.equal(session.status, 'active');
    assert.equal(db.getActiveSession().session_id, session.session_id);
    assert.equal(db.getSession(session.session_id).target_ball_count, 35); // 20 + 15

    const after = db.getPlan(plan.plan_id);
    assert.equal(after.status, 'started');
    assert.equal(after.started_session_id, session.session_id);
    assert.equal(db.getPlanForSession(session.session_id).plan_id, plan.plan_id);
  });

  test('ball count is the sum of the steps that count balls', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    // 20 + 15, with the challenge-only step contributing nothing.
    assert.equal(planBallCount(plan.steps), 35);
  });

  test('a plan made only of challenges pre-fills no ball count rather than inventing one', async () => {
    assert.equal(planBallCount([{ order: 1, title: 'x', detail: 'y', challenge_count: 3 }]), null);
    assert.equal(planBallCount([]), null);
    assert.equal(planBallCount(undefined), null);
  });

  test('a club focus names its club, and every other focus leaves the club alone', async () => {
    const db = await resetDB();
    const clubPlan = await savedPlan(db, 'club', { courseName: 'Club Course' });
    assert.equal(clubPlan.plan.focus_type, 'club');
    assert.equal(clubPlan.plan.focus_club, '9i');

    const sgPlan = await savedPlan(db, 'short_game', { courseName: 'SG Course' });
    // The app does not guess a wedge from "short game" (§7.8).
    assert.equal(sgPlan.plan.focus_club, null);
  });

  test('the started session is a plain session — shot logging is unchanged', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'full_swing');
    const session = startSessionFromPlan(db, plan);
    for (let i = 0; i < 3; i++) logShot(db, session.session_id);

    assert.equal(db.getShotsForSession(session.session_id).length, 3);
    assert.equal(db.getAllShots().length, 3);
  });
});

describe('Pausing, resuming and reloading', () => {
  test('a plan session survives a reload mid-practice', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);
    logShot(db, session.session_id);

    reload(db);

    assert.equal(db.getActiveSession().session_id, session.session_id);
    assert.equal(db.getPlan(plan.plan_id).status, 'started');
    assert.equal(db.getPlanForSession(session.session_id).plan_id, plan.plan_id);
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
  });

  test('pause and resume keep the plan started and linked', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);
    logShot(db, session.session_id);

    db.pauseSession(session.session_id);
    reload(db);
    assert.equal(db.getActiveSession().status, 'paused');
    assert.equal(db.getPlan(plan.plan_id).status, 'started');

    db.resumeSession(session.session_id);
    assert.equal(db.getSession(session.session_id).status, 'active');
    assert.equal(db.getPlan(plan.plan_id).started_session_id, session.session_id);
  });

  test('a started plan stays outstanding while its session runs', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    startSessionFromPlan(db, plan);
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
  });
});

describe('Finishing and abandoning', () => {
  test('finishing a plan session completes the plan automatically', async () => {
    const db = await resetDB();
    const { plan, round } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);
    for (let i = 0; i < 5; i++) logShot(db, session.session_id);

    finishSessionResolvingPlan(db, session.session_id);
    reload(db);

    const after = db.getPlan(plan.plan_id);
    assert.equal(after.status, 'completed');
    assert.ok(after.resolved_at);
    assert.equal(after.started_session_id, session.session_id);
    assert.equal(after.round_id, round.round_id);
    // Concluded, so no longer offered anywhere.
    assert.equal(db.getActivePlan(), null);
  });

  test('abandoning with nothing logged does NOT complete the plan', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);

    // Ended with zero shots — the session is discarded and nothing was
    // practiced, so the plan must not claim to be done.
    finishSessionResolvingPlan(db, session.session_id);
    reload(db);

    const after = db.getPlan(plan.plan_id);
    assert.notEqual(after.status, 'completed');
    assert.equal(after.status, 'saved');
    assert.equal(after.started_session_id, null);
    // And it is waiting to be started again.
    assert.equal(db.getActivePlan().plan_id, plan.plan_id);
  });

  test('a plan can be started again after being abandoned', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');

    const first = startSessionFromPlan(db, plan);
    finishSessionResolvingPlan(db, first.session_id); // abandoned, zero shots

    const second = startSessionFromPlan(db, db.getPlan(plan.plan_id));
    logShot(db, second.session_id);
    finishSessionResolvingPlan(db, second.session_id);

    reload(db);
    const after = db.getPlan(plan.plan_id);
    assert.equal(after.status, 'completed');
    assert.equal(after.started_session_id, second.session_id);
  });

  test('finishing an unrelated session never touches a started plan', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'short_game');
    startSessionFromPlan(db, plan);

    // A different, unrelated session finishing must not resolve this plan.
    const other = db.createSession({
      date: '2026-09-17', start_time: '11:00', target_ball_count: 20,
      default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    logShot(db, other.session_id);
    finishSessionResolvingPlan(db, other.session_id);

    assert.equal(db.getPlan(plan.plan_id).status, 'started');
  });
});

describe('Source round relationship', () => {
  test('the plan still points at its round after a full practice cycle', async () => {
    const db = await resetDB();
    const { plan, round } = await savedPlan(db, 'club');
    const session = startSessionFromPlan(db, plan);
    logShot(db, session.session_id);
    finishSessionResolvingPlan(db, session.session_id);

    reload(db);
    const after = db.getPlan(plan.plan_id);
    assert.equal(after.round_id, round.round_id);
    assert.equal(db.getRound(after.round_id).round_id, round.round_id);
    assert.equal(db.getPlanForRound(round.round_id).plan_id, plan.plan_id);
    // The rationale that justified this practice is still readable.
    assert.match(after.focus_rationale, /appeared on several/);
  });

  test('a completed plan survives a backup round-trip with its links intact', async () => {
    const db = await resetDB();
    const { plan, round } = await savedPlan(db, 'short_game');
    const session = startSessionFromPlan(db, plan);
    logShot(db, session.session_id);
    finishSessionResolvingPlan(db, session.session_id);

    const backup = db.exportFullDB();
    db.importFullDB(backup);
    reload(db);

    const after = db.getPlan(plan.plan_id);
    assert.equal(after.status, 'completed');
    assert.equal(after.round_id, round.round_id);
    assert.equal(after.started_session_id, session.session_id);
    assert.equal(db.getPlanForSession(session.session_id).plan_id, plan.plan_id);
  });
});

describe('Plans that cannot be practiced on a range (§11.8)', () => {
  test('a putting plan is saved and outstanding but is not range-practicable', async () => {
    const db = await resetDB();
    const { plan } = await savedPlan(db, 'putting');

    assert.equal(plan.focus_type, 'putting');
    assert.equal(db.getActivePlan().plan_id, plan.plan_id); // still a real saved plan
    // ...but there is no range session that corresponds to it, so no start
    // action is offered.
    assert.equal(isRangePracticable(plan.focus_type), false);
  });

  test('every other focus type can be practiced on a range', async () => {
    for (const type of ['short_game', 'full_swing', 'club', 'maintenance']) {
      assert.equal(isRangePracticable(type), true, type);
    }
  });
});
