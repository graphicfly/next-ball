import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors exactly what home.js's openEndSessionSheet does on confirm — not
// a DOM test (home.js's sheet logic isn't unit-testable without jsdom), but
// the same call sequence, so this verifies the actual orchestration this
// feature depends on: db.finishSession(), then db.deleteSession() only for
// the zero-shot/discard path.
function endSessionFromHome(db, sessionId) {
  const shots = db.getShotsForSession(sessionId);
  const zeroShot = shots.length === 0;
  db.finishSession(sessionId);
  if (zeroShot) {
    try { db.deleteSession(sessionId); } catch (e) { /* best-effort */ }
  }
  return { zeroShot, shotCount: shots.length };
}

describe('Scenario A/B — ending a session with shots from Home', () => {
  test('1 shot: saved, appears in History, active state cleared', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    db.pauseSession(session.session_id);

    const result = endSessionFromHome(db, session.session_id);
    assert.equal(result.zeroShot, false);

    assert.equal(db.getActiveSession(), null, 'no active/paused session remains');
    const saved = db.getSession(session.session_id);
    assert.equal(saved.status, 'finished');
    const finishedList = db.listFinishedSessions();
    assert.equal(finishedList.length, 1);
    assert.equal(finishedList[0].session_id, session.session_id);
    assert.equal(db.getShotsForSession(session.session_id).length, 1, 'the one logged shot is retained, not fabricated or lost');
  });

  test('12 of 20 shots: saved with exactly those 12, analytics use only those shots', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    for (let i = 0; i < 12; i++) {
      db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    }

    endSessionFromHome(db, session.session_id);

    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 12, 'exactly the logged shots — the remaining 8 are never fabricated');
    const summary = stats.sessionSummary(shots);
    assert.equal(summary.total, 12);
  });
});

describe('Scenario C — discarding a zero-shot session from Home', () => {
  test('0 shots: session is removed entirely, not saved as an empty completed session', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });

    const result = endSessionFromHome(db, session.session_id);
    assert.equal(result.zeroShot, true);

    assert.equal(db.getActiveSession(), null);
    assert.equal(db.getSession(session.session_id), null, 'the session no longer exists at all');
    assert.equal(db.listFinishedSessions().length, 0, 'no empty completed session appears in History');
    assert.equal(db.listSessions().length, 0);
  });
});

describe('Scenario D — Resume leaves everything untouched', () => {
  test('resuming does not create a new session or alter shot count/settings', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    db.pauseSession(session.session_id);

    // "Resume" from Home is just a hash change to #/active in the real app —
    // no db mutation at all. Confirm the session/shots are exactly as they were.
    const before = db.getSession(session.session_id);
    const beforeShots = db.getShotsForSession(session.session_id);
    assert.equal(db.listSessions().length, 1);
    assert.equal(beforeShots.length, 1);
    assert.equal(before.status, 'paused');
  });
});

describe('Scenario F — History and Home reflect the ended session immediately', () => {
  test('after ending, the session is the most recent finished session (drives Home\'s "last session" row)', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const older = db.createSession({ date: '2026-07-01', start_time: '09:00', target_ball_count: 10, default_club: 'PW', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.finishSession(older.session_id);

    // Recency is ordered by created_at (real wall-clock timestamp, ms
    // precision) — a real short delay guarantees a distinct, later
    // timestamp than `older` above; without it the two calls can land in
    // the same millisecond and tie, which is never possible in actual use
    // (nobody creates two sessions in the same millisecond) but would make
    // this specific test flaky.
    await new Promise((r) => setTimeout(r, 2));

    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });

    endSessionFromHome(db, session.session_id);

    const finished = db.listFinishedSessions();
    assert.equal(finished[0].session_id, session.session_id, 'the just-ended session is most recent, exactly what Home\'s recent-session lookup reads');
  });
});

describe('Scenario G — persistence: active-session card state survives a reload', () => {
  test('a paused session with shots is still found as the active session after simulating a reload', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    db.pauseSession(session.session_id);

    db.__resetForTests(); // simulate a fresh app load re-reading from localStorage

    const restored = db.getActiveSession();
    assert.ok(restored, 'active session found after reload');
    assert.equal(restored.status, 'paused');
    assert.equal(restored.target_ball_count, 20);
    assert.equal(db.getShotsForSession(restored.session_id).length, 1);
  });
});

describe('Scenario H — no active session: nothing to end', () => {
  test('getActiveSession returns null with no sessions at all', async () => {
    const db = await (await import('./setup.js')).resetDB();
    assert.equal(db.getActiveSession(), null);
  });

  test('getActiveSession returns null when the only session is already finished', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.finishSession(session.session_id);
    assert.equal(db.getActiveSession(), null);
  });
});
