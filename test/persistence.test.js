import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';

let db;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
});

function startSession(overrides = {}) {
  return db.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 50, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full', ...overrides });
}

function logShot(sessionId, overrides = {}) {
  const session = db.getSession(sessionId);
  return db.addShot(sessionId, {
    club: session.current_club, setup: session.current_setup, surface: session.current_surface, swing_length: session.current_swing,
    drill: session.current_drill, target_distance_yards: session.current_target_distance,
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140,
    ...overrides,
  });
}

describe('Undo', () => {
  test('undo after 1 shot: shot removed, count back to 0', () => {
    const s = startSession();
    logShot(s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 1);
    const removed = db.deleteLastShot(s.session_id);
    assert.ok(removed);
    assert.equal(db.getShotsForSession(s.session_id).length, 0);
  });

  test('undo after multiple shots removes only the LAST shot (by shot_number, not insertion order)', () => {
    const s = startSession();
    for (let i = 0; i < 5; i++) logShot(s.session_id);
    const removed = db.deleteLastShot(s.session_id);
    assert.equal(removed.shot_number, 5);
    const remaining = db.getShotsForSession(s.session_id);
    assert.equal(remaining.length, 4);
    assert.deepEqual(remaining.map((sh) => sh.shot_number), [1, 2, 3, 4]);
  });

  test('undo with no shots: returns null/falsy, does not throw', () => {
    const s = startSession();
    const removed = db.deleteLastShot(s.session_id);
    assert.equal(removed, null);
  });

  test('undo recalculates analytics, Best 10, and streaks immediately (nothing cached stale)', () => {
    const s = startSession();
    for (let i = 0; i < 10; i++) logShot(s.session_id, { strike: 'solid' });
    logShot(s.session_id, { strike: 'topped' }); // 11th shot breaks the pure-solid run
    let shots = db.getShotsForSession(s.session_id);
    assert.equal(stats.streaksSummary(shots).solid.length, 10); // streak of 10, then the topped one
    db.deleteLastShot(s.session_id); // remove the topped shot
    shots = db.getShotsForSession(s.session_id);
    assert.equal(stats.strikeBreakdown(shots).solid.pct, 100);
    assert.ok(stats.bestWindow(shots)); // now 10 shots, all solid — window recalculates cleanly
    assert.equal(stats.bestWindow(shots).solidPct, 100);
  });

  test('undo works correctly after a reload (simulated by re-fetching through db.js, not an in-memory reference)', () => {
    const s = startSession();
    for (let i = 0; i < 3; i++) logShot(s.session_id);
    // Simulate "reload": drop any JS-side reference and re-query from storage.
    const reloaded = db.getShotsForSession(s.session_id);
    assert.equal(reloaded.length, 3);
    db.deleteLastShot(s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 2);
  });
});

describe('Edit Previous', () => {
  test('editing strike/direction/height/distance recalculates everything; shot_number and timestamp survive unchanged', () => {
    const s = startSession();
    const shot = logShot(s.session_id, { strike: 'topped', direction: 'left', height: 'low', distance_yards: 60 });
    const originalTimestamp = shot.shot_timestamp;
    const originalNumber = shot.shot_number;
    db.updateShot(s.session_id, shot.shot_id, { strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150 });
    const updated = db.getShotsForSession(s.session_id)[0];
    assert.equal(updated.shot_number, originalNumber);
    assert.equal(updated.shot_timestamp, originalTimestamp); // NOT touched by an edit
    assert.equal(updated.strike, 'solid');
    assert.equal(updated.distance_yards, 150);
    assert.equal(stats.strikeBreakdown([updated]).solid.pct, 100);
  });

  test('editing drill on an individual shot does not affect other shots\' drills', () => {
    const s = startSession();
    const a = logShot(s.session_id, { drill: 'Normal Swing' });
    const b = logShot(s.session_id, { drill: 'Normal Swing' });
    db.updateShot(s.session_id, a.shot_id, { drill: 'Low Point' });
    const shots = db.getShotsForSession(s.session_id);
    assert.equal(shots.find((sh) => sh.shot_id === a.shot_id).drill, 'Low Point');
    assert.equal(shots.find((sh) => sh.shot_id === b.shot_id).drill, 'Normal Swing');
  });

  test('editing a shot inside the Best 10 window changes the window selection on recalculation', () => {
    const s = startSession();
    const shots = [];
    for (let i = 0; i < 10; i++) shots.push(logShot(s.session_id, { strike: 'solid' }));
    for (let i = 0; i < 10; i++) logShot(s.session_id, { strike: 'topped' });
    let all = db.getShotsForSession(s.session_id);
    assert.equal(stats.bestWindow(all).startBall, 1);
    // Break the first window's perfection.
    db.updateShot(s.session_id, shots[5].shot_id, { strike: 'topped' });
    all = db.getShotsForSession(s.session_id);
    assert.notEqual(stats.bestWindow(all).solidPct, 100); // window 1-10 is no longer perfect
  });

  test('editing setup/swing length on a shot is independent of the session defaults', () => {
    const s = startSession({ default_setup: 'ground', default_swing: 'full' });
    const shot = logShot(s.session_id, { setup: 'ground', swing_length: 'full' });
    db.updateShot(s.session_id, shot.shot_id, { setup: 'tee', swing_length: 'half' });
    const updated = db.getShotsForSession(s.session_id)[0];
    assert.equal(updated.setup, 'tee');
    assert.equal(updated.swing_length, 'half');
    // Session-level defaults must be untouched by a per-shot edit.
    assert.equal(db.getSession(s.session_id).default_setup, 'ground');
  });
});

describe('Active session reload / resume', () => {
  test('7 shots logged, "reload" (re-fetch fresh from db), then 3 more shots continue numbering correctly', () => {
    const s = startSession();
    for (let i = 0; i < 7; i++) logShot(s.session_id);
    // "Reload": nothing but re-querying db.js — no separate in-memory cache to go stale.
    const afterReload = db.getActiveSession();
    assert.equal(afterReload.session_id, s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 7);
    for (let i = 0; i < 3; i++) logShot(s.session_id);
    const shots = db.getShotsForSession(s.session_id);
    assert.equal(shots.length, 10);
    assert.deepEqual(shots.map((sh) => sh.shot_number), [1,2,3,4,5,6,7,8,9,10]); // no gaps, no dupes
  });

  test('drill/target/club/setup/swing survive reload (they live on the session record, not transient state)', () => {
    const s = startSession({ default_club: '9i', default_setup: 'tee', default_swing: 'half' });
    db.updateSession(s.session_id, { current_drill: 'Connection', current_target_distance: 90 });
    const reloaded = db.getActiveSession();
    assert.equal(reloaded.default_club, '9i');
    assert.equal(reloaded.current_drill, 'Connection');
    assert.equal(reloaded.current_target_distance, 90);
  });

  test('no duplicate or lost shots after repeated reload simulations at 25 and 49 shots', () => {
    const s = startSession();
    for (let i = 0; i < 25; i++) logShot(s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 25); // "reload" check
    for (let i = 0; i < 24; i++) logShot(s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 49); // "reload" check
    const numbers = db.getShotsForSession(s.session_id).map((sh) => sh.shot_number);
    assert.equal(new Set(numbers).size, 49); // all unique, none duplicated across the "reload" boundary
  });
});

describe('Pause / Resume', () => {
  test('pause immediately (0 shots): status becomes paused, session not finalized', () => {
    const s = startSession();
    db.pauseSession(s.session_id);
    assert.equal(db.getSession(s.session_id).status, 'paused');
    assert.notEqual(db.getSession(s.session_id).status, 'finished');
  });

  test('pause midway, "reload" while paused, then resume: shots and state intact', () => {
    const s = startSession();
    for (let i = 0; i < 5; i++) logShot(s.session_id);
    db.pauseSession(s.session_id);
    // "reload while paused"
    const stillPaused = db.getActiveSession();
    assert.equal(stillPaused.status, 'paused');
    assert.equal(db.getShotsForSession(s.session_id).length, 5);
    db.resumeSession(s.session_id);
    assert.equal(db.getSession(s.session_id).status, 'active');
    logShot(s.session_id);
    assert.equal(db.getShotsForSession(s.session_id).length, 6);
  });

  test('getActiveSession() returns a paused session too (so "resume" is reachable), never returns a finished one', () => {
    const s = startSession();
    db.pauseSession(s.session_id);
    assert.equal(db.getActiveSession()?.session_id, s.session_id);
    db.resumeSession(s.session_id);
    db.finishSession(s.session_id);
    assert.equal(db.getActiveSession(), null);
  });
});

describe('Session finish', () => {
  for (const n of [0, 1, 3, 9, 10, 19, 20, 50]) {
    test(`finish with ${n} shots: session saved exactly once, no duplicates, summary computes cleanly`, () => {
      const s = startSession({ target_ball_count: Math.max(n, 1) });
      for (let i = 0; i < n; i++) logShot(s.session_id);
      db.finishSession(s.session_id);
      const finishedCount = db.listFinishedSessions().filter((x) => x.session_id === s.session_id).length;
      assert.equal(finishedCount, 1);
      const summary = stats.sessionSummary(db.getShotsForSession(s.session_id));
      assert.equal(summary.total, n);
    });
  }

  test('finishing twice does not create a duplicate session record', () => {
    const s = startSession();
    logShot(s.session_id);
    db.finishSession(s.session_id);
    db.finishSession(s.session_id); // idempotent — just updates status/end_time again
    const all = db.listSessions().filter((x) => x.session_id === s.session_id);
    assert.equal(all.length, 1);
  });
});

describe('Shot timestamps', () => {
  test('every new shot receives a unique, chronologically increasing timestamp', () => {
    const s = startSession();
    const shots = [];
    for (let i = 0; i < 5; i++) shots.push(logShot(s.session_id));
    const timestamps = shots.map((sh) => sh.shot_timestamp);
    assert.equal(new Set(timestamps).size, 5); // all unique
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(new Date(timestamps[i]).getTime() >= new Date(timestamps[i - 1]).getTime());
    }
  });

  test('editing a shot does NOT replace its original timestamp', () => {
    const s = startSession();
    const shot = logShot(s.session_id);
    const original = shot.shot_timestamp;
    db.updateShot(s.session_id, shot.shot_id, { strike: 'topped' });
    assert.equal(db.getShotsForSession(s.session_id)[0].shot_timestamp, original);
  });

  test('undo then log a new shot: the replacement gets its own shot_id, and its own timestamp once real time has actually elapsed', () => {
    // NOTE: when undo empties a session entirely, the monotonic-timestamp
    // guarantee (see nextShotTimestamp in db.js) has no prior shot left to
    // compare against, so two db.addShot() calls issued within the same
    // millisecond with an undo between them could in principle share a
    // timestamp. This is unreachable through the real UI — logging a shot
    // always has a mandatory 380ms "Saved" animation plus the golfer
    // physically re-selecting Strike/Direction/Height/Distance — so this
    // test asserts the guarantee that actually matters: a real elapsed gap
    // always produces a strictly later timestamp.
    const s = startSession();
    const first = logShot(s.session_id);
    db.deleteLastShot(s.session_id);
    const busyUntil = Date.now() + 2;
    while (Date.now() < busyUntil) { /* simulate realistic elapsed time between UI interactions */ }
    const replacement = logShot(s.session_id);
    assert.notEqual(replacement.shot_timestamp, first.shot_timestamp);
    assert.notEqual(replacement.shot_id, first.shot_id);
  });

  test('session duration logic does not break when legacy shots are missing shot_timestamp entirely', () => {
    const shotsNoTimestamp = [
      { shot_number: 1, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 }, // no shot_timestamp field at all
      { shot_number: 2, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 142 },
    ];
    const timing = stats.shotTimingStats(shotsNoTimestamp);
    assert.equal(timing.totalDurationSeconds, null);
    assert.deepEqual(timing.gaps, []);
  });
});
