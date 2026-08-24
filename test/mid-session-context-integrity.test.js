import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Dedicated regression coverage for the exact test sequences specified in
// the mid-session Club/Training Aid integrity audit — literal block sizes
// from that spec, not just a generic pattern. Complements (does not
// replace) shot-context-snapshot.test.js's broader coverage. Every
// assertion checks the actual persisted shot array, never just a count.

let db, exportMod, stats;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
  exportMod = await import('../js/export.js');
  stats = await import('../js/stats.js');
});

function newSession(overrides = {}) {
  return db.createSession({
    date: '2026-08-24', start_time: '09:00', target_ball_count: 20,
    default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'half',
    ...overrides,
  });
}

// Mirrors exactly what shotEntry.js's finishShot does: every field comes
// from the session's CURRENT context at the moment of the call, never a
// fixed/default value baked in ahead of time.
function logShot(session) {
  return db.addShot(session.session_id, {
    club: session.current_club, setup: session.current_setup, surface: session.current_surface,
    swing_length: session.current_swing, drill: session.current_drill,
    target_distance_yards: session.current_target_distance, training_aid: session.current_training_aid,
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 20,
  });
}

describe('Spec §3 — exact Training Aid sequence: None(1-3) -> Connection Ball(4-6) -> None(7-9) -> Strike Wedge(10-12)', () => {
  test('all 12 persisted shot records match exactly, no bleed across blocks', () => {
    const session = newSession();
    db.updateSession(session.session_id, { current_drill: 'Low Point' });

    for (let i = 0; i < 3; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    for (let i = 0; i < 3; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_training_aid: 'none' });
    for (let i = 0; i < 3; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_training_aid: 'strike_wedge' });
    for (let i = 0; i < 3; i++) logShot(db.getSession(session.session_id));

    const shots = db.getShotsForSession(session.session_id);
    const expected = [
      ...Array(3).fill('none'), ...Array(3).fill('connection_ball'),
      ...Array(3).fill('none'), ...Array(3).fill('strike_wedge'),
    ];
    assert.deepEqual(shots.map((s) => s.training_aid), expected);
    // club/drill/swing were never touched — must be identical across every shot
    assert.ok(shots.every((s) => s.club === '7i' && s.drill === 'Low Point' && s.swing_length === 'half'));
  });
});

describe('Spec §5 — exact Club sequence: 7i(1-4) -> PW(5-8) -> 7i(9-12)', () => {
  test('all 12 persisted shot records match exactly; switching club never resets the session', () => {
    const session = newSession();
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_club: 'PW' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_club: '7i' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));

    const shots = db.getShotsForSession(session.session_id);
    assert.deepEqual(shots.map((s) => s.club), [
      ...Array(4).fill('7i'), ...Array(4).fill('PW'), ...Array(4).fill('7i'),
    ]);
    // shot_number is strictly sequential 1-12 — proves no second session was created and no reset happened
    assert.deepEqual(shots.map((s) => s.shot_number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(new Set(shots.map((s) => s.session_id)).size, 1, 'every shot belongs to the same single session');
  });
});

describe('Spec §6 — exact combined 20-shot fixture', () => {
  const EXPECTED = [
    ...Array(4).fill({ club: '7i', training_aid: 'none', drill: 'Low Point' }),
    ...Array(4).fill({ club: '7i', training_aid: 'connection_ball', drill: 'Low Point' }),
    ...Array(4).fill({ club: 'PW', training_aid: 'none', drill: 'Low Point' }),
    ...Array(4).fill({ club: 'PW', training_aid: 'strike_wedge', drill: 'Low Point' }),
    ...Array(4).fill({ club: '7i', training_aid: 'none', drill: 'Normal Swing' }),
  ];

  function buildFixture() {
    const session = newSession();
    db.updateSession(session.session_id, { current_drill: 'Low Point' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 1-4
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 5-8
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'none' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 9-12
    db.updateSession(session.session_id, { current_training_aid: 'strike_wedge' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 13-16
    db.updateSession(session.session_id, { current_club: '7i', current_training_aid: 'none', current_drill: 'Normal Swing' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 17-20
    return session;
  }

  test('persisted shots match the exact fixture, every combination correct', () => {
    const session = buildFixture();
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 20);
    shots.forEach((s, i) => {
      assert.equal(s.club, EXPECTED[i].club, `shot ${i + 1} club`);
      assert.equal(s.training_aid, EXPECTED[i].training_aid, `shot ${i + 1} training_aid`);
      assert.equal(s.drill, EXPECTED[i].drill, `shot ${i + 1} drill`);
    });
  });

  test('CSV export matches the exact fixture row by row', () => {
    const session = buildFixture();
    const csv = exportMod.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const [clubCol, aidCol, drillCol] = ['club', 'training_aid', 'drill'].map((h) => header.indexOf(h));
    const rows = csv.trim().split('\n').slice(1).map((r) => r.split(','));
    assert.equal(rows.length, 20);
    rows.forEach((row, i) => {
      assert.equal(row[clubCol], EXPECTED[i].club, `CSV row ${i + 1} club`);
      assert.equal(row[aidCol], EXPECTED[i].training_aid, `CSV row ${i + 1} training_aid`);
      assert.equal(row[drillCol], EXPECTED[i].drill, `CSV row ${i + 1} drill`);
    });
  });

  test('Session Recap / History label reflects both clubs actually used, never just one', async () => {
    const session = buildFixture();
    const shots = db.getShotsForSession(session.session_id);
    const label = stats.clubSummaryLabel(shots, session.default_club);
    assert.equal(label, '7i + PW');
  });

  test('Practice analytics (club/drill/training-aid breakdowns) group by shot-level data only', () => {
    const session = buildFixture();
    const shots = db.getShotsForSession(session.session_id);
    // 7i appears in blocks 1-2 (8 shots) and block 5 (4 shots) = 12; PW in blocks 3-4 (8 shots).
    const clubs = stats.clubBreakdown(shots);
    assert.equal(clubs.find((c) => c.club === '7i').count, 12);
    assert.equal(clubs.find((c) => c.club === 'PW').count, 8);
    const aids = stats.trainingAidBreakdown(shots);
    assert.equal(aids.find((a) => a.training_aid === 'connection_ball').count, 4);
    assert.equal(aids.find((a) => a.training_aid === 'strike_wedge').count, 4);
    const drills = stats.drillBreakdown(shots);
    assert.equal(drills.find((d) => d.drill === 'Low Point').count, 16);
    assert.equal(drills.find((d) => d.drill === 'Normal Swing').count, 4);
  });

  test('reload mid-session (after shot 8) preserves both active context and every already-saved shot', () => {
    const session = newSession();
    db.updateSession(session.session_id, { current_drill: 'Low Point' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id)); // 8 shots logged
    db.updateSession(session.session_id, { current_club: 'PW' });
    db.pauseSession(session.session_id);

    const sessionId = session.session_id;
    db.__resetForTests(); // simulates an app reload re-reading from localStorage

    const restored = db.getActiveSession();
    assert.equal(restored.session_id, sessionId);
    assert.equal(restored.current_club, 'PW');
    assert.equal(restored.current_training_aid, 'connection_ball');
    const shotsAfterReload = db.getShotsForSession(sessionId);
    assert.equal(shotsAfterReload.length, 8);
    assert.deepEqual(shotsAfterReload.slice(0, 4).map((s) => s.training_aid), Array(4).fill('none'));
    assert.deepEqual(shotsAfterReload.slice(4, 8).map((s) => s.training_aid), Array(4).fill('connection_ball'));

    db.resumeSession(sessionId);
    logShot(db.getSession(sessionId)); // shot 9, after reload
    const afterContinue = db.getShotsForSession(sessionId);
    assert.equal(afterContinue.length, 9);
    assert.equal(afterContinue[8].club, 'PW');
    assert.equal(afterContinue[8].training_aid, 'connection_ball');
  });
});

describe('Spec §9 — Undo does not revert PW + Strike Wedge active context', () => {
  test('logging a PW/Strike Wedge shot then undoing it leaves the active context exactly as it was', () => {
    const session = newSession();
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'strike_wedge' });
    logShot(db.getSession(session.session_id));

    const removed = db.deleteLastShot(session.session_id);
    assert.equal(removed.club, 'PW');
    assert.equal(removed.training_aid, 'strike_wedge');

    const after = db.getSession(session.session_id);
    assert.equal(after.current_club, 'PW');
    assert.equal(after.current_training_aid, 'strike_wedge');
    assert.equal(db.getShotsForSession(session.session_id).length, 0);
  });
});

describe('Spec §8 — Edit Previous: editing Club on one shot and Training Aid on another', () => {
  test('each edit touches only its own shot; shot_number and shot_timestamp are preserved; neighbors untouched', () => {
    const session = newSession();
    logShot(db.getSession(session.session_id)); // shot 1
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'connection_ball' });
    logShot(db.getSession(session.session_id)); // shot 2
    logShot(db.getSession(session.session_id)); // shot 3

    const before = db.getShotsForSession(session.session_id);
    const shot1Before = { ...before[0] };
    const shot3Before = { ...before[2] };

    db.updateShot(session.session_id, before[0].shot_id, { club: 'Driver' }); // edit shot 1's club
    db.updateShot(session.session_id, before[1].shot_id, { training_aid: 'strike_wedge' }); // edit shot 2's aid

    const after = db.getShotsForSession(session.session_id);
    assert.equal(after[0].club, 'Driver');
    assert.equal(after[0].shot_number, shot1Before.shot_number);
    assert.equal(after[0].shot_timestamp, shot1Before.shot_timestamp);
    assert.equal(after[1].training_aid, 'strike_wedge');
    assert.equal(after[1].club, 'PW', 'editing training_aid must not touch club');
    // shot 3 is completely untouched
    assert.deepEqual(after[2], shot3Before);
  });
});

describe('Spec §11 — JSON round trip into fresh, isolated storage', () => {
  test('full backup/restore into cleared storage preserves every club/aid combination exactly', () => {
    const session = newSession();
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'strike_wedge' });
    for (let i = 0; i < 4; i++) logShot(db.getSession(session.session_id));

    const before = db.getShotsForSession(session.session_id).map((s) => ({ club: s.club, training_aid: s.training_aid }));
    const backup = db.exportFullDB();

    db.__resetForTests();
    globalThis.localStorage.clear(); // truly fresh, isolated storage — not just the in-memory cache
    db.importFullDB(backup);

    const after = db.getShotsForSession(session.session_id).map((s) => ({ club: s.club, training_aid: s.training_aid }));
    assert.deepEqual(after, before);
  });
});

describe('Spec §15 — historical sessions without shot-level club/training_aid still work', () => {
  test('a shot missing training_aid (pre-feature data) falls back to "none" in exports/analytics without crashing', () => {
    const session = newSession();
    const shot = logShot(db.getSession(session.session_id));
    delete shot.training_aid;
    db.updateShot(session.session_id, shot.shot_id, {}); // re-persist the mutated in-memory record

    assert.equal(db.shotTrainingAid(shot), 'none');
    assert.doesNotThrow(() => exportMod.sessionCSV(session.session_id));
    assert.doesNotThrow(() => stats.trainingAidBreakdown(db.getShotsForSession(session.session_id)));
  });
});

describe('Spec §17 — session-level leakage audit (documented, not auto-fixed)', () => {
  test('CSV never substitutes the session\'s current/default club or aid for a row missing its own (both are always stamped)', () => {
    const session = newSession({ default_club: 'Driver' });
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'connection_ball' });
    logShot(db.getSession(session.session_id));
    const csv = exportMod.sessionCSV(session.session_id);
    assert.ok(!csv.includes('Driver'), 'CSV must never show session.default_club when the shot itself used a different club');
  });
});
