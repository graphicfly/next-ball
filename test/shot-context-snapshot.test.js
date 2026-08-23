import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Regression coverage for the core architectural requirement this task
// fixed/verified: SESSION SETTINGS are defaults, SHOT CONTEXT is an
// immutable snapshot of what was actually active when that ball was hit.
// Changing the session's current_* fields must never retroactively alter
// an already-logged shot, and every export must read shot-level values —
// never session.default_club / session.current_training_aid etc.

let db, exportMod, stats;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
  exportMod = await import('../js/export.js');
  stats = await import('../js/stats.js');
});

function baseSession(overrides = {}) {
  return db.createSession({
    date: '2026-08-23', start_time: '09:00', target_ball_count: 30,
    default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    ...overrides,
  });
}

function logShot(session, extra = {}) {
  return db.addShot(session.session_id, {
    club: session.current_club, setup: session.current_setup, surface: session.current_surface,
    swing_length: session.current_swing, drill: session.current_drill,
    target_distance_yards: session.current_target_distance, training_aid: session.current_training_aid,
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    ...extra,
  });
}

describe('§18 — Training Aid regression: no leakage between blocks', () => {
  test('5 none, 8 connection_ball, 5 none, 8 strike_wedge: exact counts, no bleed', () => {
    const session = baseSession();
    for (let i = 0; i < 5; i++) logShot(session);
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    for (let i = 0; i < 8; i++) logShot(session);
    db.updateSession(session.session_id, { current_training_aid: 'none' });
    for (let i = 0; i < 5; i++) logShot(session);
    db.updateSession(session.session_id, { current_training_aid: 'strike_wedge' });
    for (let i = 0; i < 8; i++) logShot(session);

    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 26);
    const counts = { none: 0, connection_ball: 0, strike_wedge: 0 };
    for (const s of shots) counts[s.training_aid] = (counts[s.training_aid] || 0) + 1;
    assert.equal(counts.none, 10);
    assert.equal(counts.connection_ball, 8);
    assert.equal(counts.strike_wedge, 8);

    assert.deepEqual(shots.slice(0, 5).map((s) => s.training_aid), Array(5).fill('none'));
    assert.deepEqual(shots.slice(5, 13).map((s) => s.training_aid), Array(8).fill('connection_ball'));
    assert.deepEqual(shots.slice(13, 18).map((s) => s.training_aid), Array(5).fill('none'));
    assert.deepEqual(shots.slice(18, 26).map((s) => s.training_aid), Array(8).fill('strike_wedge'));
  });

  test('Strike Wedge is a real, distinct training aid option', () => {
    assert.ok(db.TRAINING_AIDS.includes('strike_wedge'));
    assert.equal(db.TRAINING_AID_LABELS.strike_wedge, 'Strike Wedge');
  });
});

describe('§19 — Club switching regression: every stored shot and CSV row', () => {
  test('10 PW, 10 7i, 10 PW: shots and CSV rows both correct', () => {
    const session = baseSession({ default_club: 'PW' });
    db.updateSession(session.session_id, { current_club: 'PW' });
    for (let i = 0; i < 10; i++) logShot(session);
    db.updateSession(session.session_id, { current_club: '7i' });
    for (let i = 0; i < 10; i++) logShot(session);
    db.updateSession(session.session_id, { current_club: 'PW' });
    for (let i = 0; i < 10; i++) logShot(session);

    const shots = db.getShotsForSession(session.session_id);
    assert.deepEqual(shots.slice(0, 10).map((s) => s.club), Array(10).fill('PW'));
    assert.deepEqual(shots.slice(10, 20).map((s) => s.club), Array(10).fill('7i'));
    assert.deepEqual(shots.slice(20, 30).map((s) => s.club), Array(10).fill('PW'));

    const csv = exportMod.sessionCSV(session.session_id);
    const rows = csv.trim().split('\n').slice(1); // drop header
    const clubCol = csv.split('\n')[0].split(',').indexOf('club');
    assert.equal(rows.length, 30);
    for (let i = 0; i < 10; i++) assert.equal(rows[i].split(',')[clubCol], 'PW');
    for (let i = 10; i < 20; i++) assert.equal(rows[i].split(',')[clubCol], '7i');
    for (let i = 20; i < 30; i++) assert.equal(rows[i].split(',')[clubCol], 'PW');
  });
});

describe('§20 — Combined context regression: club + aid + drill together', () => {
  function buildCombinedSession() {
    const session = baseSession({ default_club: 'PW' });
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'strike_wedge', current_drill: 'Low Point' });
    for (let i = 0; i < 5; i++) logShot(session); // 1-5
    db.updateSession(session.session_id, { current_training_aid: 'none' });
    for (let i = 0; i < 5; i++) logShot(session); // 6-10: PW + None + Low Point
    db.updateSession(session.session_id, { current_club: '7i', current_training_aid: 'connection_ball' });
    for (let i = 0; i < 5; i++) logShot(session); // 11-15: 7i + Connection Ball + Low Point
    db.updateSession(session.session_id, { current_training_aid: 'none', current_drill: 'Normal Swing' });
    for (let i = 0; i < 5; i++) logShot(session); // 16-20: 7i + None + Normal Swing
    return session;
  }

  const EXPECTED = [
    ...Array(5).fill({ club: 'PW', training_aid: 'strike_wedge', drill: 'Low Point' }),
    ...Array(5).fill({ club: 'PW', training_aid: 'none', drill: 'Low Point' }),
    ...Array(5).fill({ club: '7i', training_aid: 'connection_ball', drill: 'Low Point' }),
    ...Array(5).fill({ club: '7i', training_aid: 'none', drill: 'Normal Swing' }),
  ];

  test('persistence: every shot carries the exact combination active when it was hit', () => {
    const session = buildCombinedSession();
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 20);
    shots.forEach((s, i) => {
      assert.equal(s.club, EXPECTED[i].club, `shot ${i + 1} club`);
      assert.equal(s.training_aid, EXPECTED[i].training_aid, `shot ${i + 1} training_aid`);
      assert.equal(s.drill, EXPECTED[i].drill, `shot ${i + 1} drill`);
    });
  });

  test('reload: __resetForTests (simulating a fresh app load) reads the same combinations back', () => {
    const session = buildCombinedSession();
    const sessionId = session.session_id;
    db.__resetForTests();
    const shots = db.getShotsForSession(sessionId);
    assert.equal(shots.length, 20);
    shots.forEach((s, i) => {
      assert.equal(s.club, EXPECTED[i].club);
      assert.equal(s.training_aid, EXPECTED[i].training_aid);
    });
  });

  test('summary/detail: analytics group by shot-level values, distinguishing every PW/7i x aid combination', () => {
    const session = buildCombinedSession();
    const shots = db.getShotsForSession(session.session_id);
    const pwShots = shots.filter((s) => s.club === 'PW');
    const iiShots = shots.filter((s) => s.club === '7i');
    assert.equal(pwShots.length, 10);
    assert.equal(iiShots.length, 10);
    assert.equal(pwShots.filter((s) => s.training_aid === 'strike_wedge').length, 5);
    assert.equal(pwShots.filter((s) => s.training_aid === 'none').length, 5);
    assert.equal(iiShots.filter((s) => s.training_aid === 'connection_ball').length, 5);
    assert.equal(iiShots.filter((s) => s.training_aid === 'none').length, 5);

    const trainingAids = stats.trainingAidBreakdown(shots);
    const aidOrder = trainingAids.map((a) => a.training_aid);
    assert.deepEqual(aidOrder, ['strike_wedge', 'none', 'connection_ball']); // first-appearance order, not deduped across the whole session

    const drills = stats.drillBreakdown(shots);
    assert.equal(drills.find((d) => d.drill === 'Low Point').count, 15);
    assert.equal(drills.find((d) => d.drill === 'Normal Swing').count, 5);
  });

  test('CSV: every row reflects that row\'s own combination, never the session default/current', () => {
    const session = buildCombinedSession();
    const csv = exportMod.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const [clubCol, aidCol, drillCol] = ['club', 'training_aid', 'drill'].map((h) => header.indexOf(h));
    const rows = csv.trim().split('\n').slice(1).map((r) => r.split(','));
    assert.equal(rows.length, 20);
    rows.forEach((row, i) => {
      assert.equal(row[clubCol], EXPECTED[i].club, `row ${i + 1} club`);
      assert.equal(row[aidCol], EXPECTED[i].training_aid, `row ${i + 1} training_aid`);
      assert.equal(row[drillCol], EXPECTED[i].drill, `row ${i + 1} drill`);
    });
    // The session's FINAL current_* state (7i / none / Normal Swing) must
    // never appear on the earlier rows — this is exactly today's reported
    // bug shape (every row showing the last-selected value).
    assert.ok(!rows.slice(0, 5).some((row) => row[clubCol] === '7i'), 'early PW rows must not show the later club');
    assert.ok(!rows.slice(0, 10).some((row) => row[aidCol] === 'connection_ball'), 'PW-block rows must not show the later aid');
  });

  test('JSON: full backup/restore round-trips every shot\'s own context independently', () => {
    const session = buildCombinedSession();
    const backup = db.exportFullDB();
    db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(backup);

    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 20);
    shots.forEach((s, i) => {
      assert.equal(s.club, EXPECTED[i].club);
      assert.equal(s.training_aid, EXPECTED[i].training_aid);
      assert.equal(s.drill, EXPECTED[i].drill);
    });
  });
});

describe('§21 — Historical compatibility: old shots missing shot-level fields', () => {
  test('a shot with no training_aid key at all (pre-feature data) falls back to "none" everywhere, without crashing', async () => {
    const session = baseSession();
    const shot = db.addShot(session.session_id, {
      club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150,
    });
    delete shot.training_aid; // simulate a shot saved before this field existed
    // db.js caches shots in memory; re-save the mutated record to disk too
    db.updateShot(session.session_id, shot.shot_id, {});

    assert.equal(db.shotTrainingAid(shot), 'none');
    const csv = exportMod.sessionCSV(session.session_id);
    assert.ok(csv.includes(',none,') || csv.trim().endsWith('none') || /,none,\d/.test(csv));
    assert.doesNotThrow(() => stats.trainingAidBreakdown(db.getShotsForSession(session.session_id)));
  });

  test('an old session with only session-level defaults (no current_* ever changed) still works for every logged shot', () => {
    const session = baseSession();
    for (let i = 0; i < 5; i++) logShot(session);
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 5);
    for (const s of shots) {
      assert.equal(s.club, session.default_club);
      assert.equal(s.training_aid, 'none');
    }
  });
});

describe('§16 — Resume: active context restores correctly, history is untouched', () => {
  test('pause with a non-default club/aid, simulate reload, resume: current_* restored, earlier shots unchanged', () => {
    const session = baseSession({ default_club: '7i' });
    for (let i = 0; i < 3; i++) logShot(session); // 3 shots at 7i/none
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'strike_wedge' });
    db.pauseSession(session.session_id);

    const sessionId = session.session_id;
    db.__resetForTests(); // simulate a fresh app load re-reading from localStorage

    const restored = db.getActiveSession();
    assert.ok(restored);
    assert.equal(restored.status, 'paused');
    assert.equal(restored.current_club, 'PW');
    assert.equal(restored.current_training_aid, 'strike_wedge');

    const shots = db.getShotsForSession(sessionId);
    assert.equal(shots.length, 3);
    for (const s of shots) { assert.equal(s.club, '7i'); assert.equal(s.training_aid, 'none'); }

    db.resumeSession(sessionId);
    logShot(db.getSession(sessionId));
    const after = db.getShotsForSession(sessionId);
    assert.equal(after[3].club, 'PW');
    assert.equal(after[3].training_aid, 'strike_wedge');
  });
});

describe('§17 — Undo: does not revert active context', () => {
  test('undoing the most recent shot leaves current_club/current_training_aid exactly as they were', () => {
    const session = baseSession();
    logShot(session); // shot 1, 7i/none
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'connection_ball' });
    logShot(session); // shot 2, PW/connection_ball

    const beforeUndo = db.getSession(session.session_id);
    assert.equal(beforeUndo.current_club, 'PW');
    assert.equal(beforeUndo.current_training_aid, 'connection_ball');

    const removed = db.deleteLastShot(session.session_id);
    assert.equal(removed.club, 'PW');

    const afterUndo = db.getSession(session.session_id);
    assert.equal(afterUndo.current_club, 'PW', 'undo must not revert the active club');
    assert.equal(afterUndo.current_training_aid, 'connection_ball', 'undo must not revert the active training aid');
    assert.equal(db.getShotsForSession(session.session_id).length, 1);
  });
});

describe('§22 — Data-integrity audit: exports never fall back to session-level values', () => {
  test('CSV never substitutes session.default_club/current_training_aid for a shot missing its own (both are always stamped by addShot)', () => {
    const session = baseSession({ default_club: 'Driver' });
    db.updateSession(session.session_id, { current_club: 'PW', current_training_aid: 'connection_ball' });
    logShot(session);
    const csv = exportMod.sessionCSV(session.session_id);
    assert.ok(!csv.includes('Driver'), 'CSV must never show the session default_club when a shot logged a different club');
  });

  test('clubSummaryLabel never silently picks a majority club — exposes every distinct club actually used', async () => {
    const { clubSummaryLabel } = stats;
    const session = baseSession({ default_club: 'PW' });
    db.updateSession(session.session_id, { current_club: 'PW' });
    for (let i = 0; i < 8; i++) logShot(session);
    db.updateSession(session.session_id, { current_club: '7i' });
    for (let i = 0; i < 2; i++) logShot(session);
    const shots = db.getShotsForSession(session.session_id);
    const label = clubSummaryLabel(shots, session.default_club);
    assert.equal(label, 'PW + 7i', 'must show both clubs, not silently collapse to the 8-shot majority (PW)');
  });

  test('clubSummaryLabel: single club shows plainly, 3+ distinct clubs collapse to "Mixed Clubs"', async () => {
    const { clubSummaryLabel } = stats;
    const oneClub = [{ shot_number: 1, club: '7i' }, { shot_number: 2, club: '7i' }];
    assert.equal(clubSummaryLabel(oneClub, '7i'), '7i');

    const threeClubs = [
      { shot_number: 1, club: 'Driver' }, { shot_number: 2, club: '7i' }, { shot_number: 3, club: 'PW' },
    ];
    assert.equal(clubSummaryLabel(threeClubs, 'Driver'), 'Mixed Clubs');

    assert.equal(clubSummaryLabel([], 'PW'), 'PW');
  });
});

describe('§9/§10 — Editing a shot updates only that shot, preserves shot number and timestamp', () => {
  test('correcting club/training_aid on one shot via updateShot leaves shot_number, shot_timestamp, and every other shot untouched', () => {
    const session = baseSession();
    logShot(session);
    logShot(session);
    logShot(session);
    const shots = db.getShotsForSession(session.session_id);
    const target = shots[1]; // shot 2
    const originalTimestamp = target.shot_timestamp;
    const originalShotNumber = target.shot_number;

    db.updateShot(session.session_id, target.shot_id, { club: 'PW', training_aid: 'strike_wedge' });

    const after = db.getShotsForSession(session.session_id);
    assert.equal(after.length, 3);
    assert.equal(after[1].club, 'PW');
    assert.equal(after[1].training_aid, 'strike_wedge');
    assert.equal(after[1].shot_number, originalShotNumber);
    assert.equal(after[1].shot_timestamp, originalTimestamp);
    // shots 1 and 3 are completely unaffected
    assert.equal(after[0].club, session.default_club);
    assert.equal(after[2].club, session.default_club);
  });
});
