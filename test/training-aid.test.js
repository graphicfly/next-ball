import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSession, persistGenerated } from './generator.js';

// Mirrors exactly what active.js/shotEntry.js do in the real app: read
// session.current_training_aid fresh and stamp it onto the new shot. Not a
// db.js API of its own — this is the actual call shape finishShot() uses.
function logShot(db, session, fields) {
  return db.addShot(session.session_id, {
    club: session.current_club, setup: session.current_setup, surface: session.current_surface,
    swing_length: session.current_swing, drill: session.current_drill,
    target_distance_yards: session.current_target_distance, training_aid: session.current_training_aid,
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140,
    ...fields,
  });
}

describe('Scenario A — default Training Aid is None for every shot', () => {
  test('5 shots logged with no Training Aid change all record none', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.equal(session.current_training_aid, 'none', 'a brand-new session starts with no training aid, no user action needed');
    for (let i = 0; i < 5; i++) logShot(db, session, {});
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 5);
    for (const s of shots) assert.equal(s.training_aid, 'none');
  });
});

describe('Scenario B/C — Training Aid persists across shots until changed, past shots never retroactively altered', () => {
  test('shots 1-5 none, 6-10 connection_ball, 11-15 none again — only 6-10 carry the aid', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 15, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });

    for (let i = 0; i < 5; i++) logShot(db, session, {});

    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    const withAid = db.getSession(session.session_id);
    for (let i = 0; i < 5; i++) logShot(db, withAid, {});

    db.updateSession(session.session_id, { current_training_aid: 'none' });
    const backToNone = db.getSession(session.session_id);
    for (let i = 0; i < 5; i++) logShot(db, backToNone, {});

    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 15);
    assert.ok(shots.slice(0, 5).every((s) => s.training_aid === 'none'), 'shots 1-5');
    assert.ok(shots.slice(5, 10).every((s) => s.training_aid === 'connection_ball'), 'shots 6-10');
    assert.ok(shots.slice(10, 15).every((s) => s.training_aid === 'none'), 'shots 11-15');

    // Changing current_training_aid again must never rewrite shots already logged.
    db.updateSession(session.session_id, { current_training_aid: 'divot_board' });
    const shotsAfter = db.getShotsForSession(session.session_id);
    assert.deepEqual(shotsAfter.map((s) => s.training_aid), shots.map((s) => s.training_aid), 'no past shot changed just because current_training_aid changed again');
  });
});

describe('Scenario D — Drill and Training Aid are simultaneously and independently stored', () => {
  test('a shot can carry drill=Low Point and training_aid=connection_ball at once', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.updateSession(session.session_id, { current_drill: 'Low Point', current_training_aid: 'connection_ball' });
    const s = db.getSession(session.session_id);
    const shot = logShot(db, s, {});
    assert.equal(shot.drill, 'Low Point');
    assert.equal(shot.training_aid, 'connection_ball');
  });

  test('selecting the "Connection" drill does not select the Connection Ball aid, and vice versa', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.ok(db.DRILLS.includes('Connection'), 'sanity check: the pre-existing "Connection" drill name really does exist');

    db.updateSession(session.session_id, { current_drill: 'Connection' });
    const afterDrill = db.getSession(session.session_id);
    assert.equal(afterDrill.current_training_aid, 'none', 'selecting the Connection drill left training aid untouched');
    const shot1 = logShot(db, afterDrill, {});
    assert.equal(shot1.drill, 'Connection');
    assert.equal(shot1.training_aid, 'none');

    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    const afterAid = db.getSession(session.session_id);
    assert.equal(afterAid.current_drill, 'Connection', 'selecting Connection Ball left the drill untouched');
    const shot2 = logShot(db, afterAid, {});
    assert.equal(shot2.drill, 'Connection');
    assert.equal(shot2.training_aid, 'connection_ball');
  });
});

describe('Scenario E — changing drill mid-session does not affect an active Training Aid', () => {
  test('Training Aid survives a drill change', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    db.updateSession(session.session_id, { current_drill: 'Rotation' });
    const s = db.getSession(session.session_id);
    assert.equal(s.current_training_aid, 'connection_ball', 'still active after an unrelated drill change');
    const shot = logShot(db, s, {});
    assert.equal(shot.drill, 'Rotation');
    assert.equal(shot.training_aid, 'connection_ball');
  });
});

describe('Scenario F — Training Aid survives reload/resume', () => {
  test('current_training_aid is read back correctly after simulating a reload', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 5, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    for (let i = 0; i < 3; i++) logShot(db, db.getSession(session.session_id), {});

    // Simulate an app reload: drop db.js's in-memory cache and re-read
    // straight from localStorage, exactly like a fresh page load would.
    db.__resetForTests();
    const resumed = db.getActiveSession();
    assert.ok(resumed, 'active session found after reload');
    assert.equal(resumed.current_training_aid, 'connection_ball', 'training aid restored correctly, not lost or reset');
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 3);
    assert.ok(shots.every((s) => s.training_aid === 'connection_ball'));

    // And a shot logged after resuming continues to use the restored aid.
    const nextShot = logShot(db, resumed, {});
    assert.equal(nextShot.training_aid, 'connection_ball');
  });
});

describe('Scenario G/H — editing a past shot\'s Training Aid', () => {
  test('adding Connection Ball afterward preserves shot number and timestamp', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const shot = logShot(db, session, {});
    assert.equal(shot.training_aid, 'none');
    const originalTimestamp = shot.shot_timestamp;
    const originalNumber = shot.shot_number;

    const edited = db.updateShot(session.session_id, shot.shot_id, { training_aid: 'connection_ball' });
    assert.equal(edited.training_aid, 'connection_ball');
    assert.equal(edited.shot_number, originalNumber);
    assert.equal(edited.shot_timestamp, originalTimestamp, 'editing training_aid never touches the original timestamp');
  });

  test('removing Connection Ball afterward updates the derived Training Aid analytics', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const shotA = logShot(db, session, { distance_yards: 150 });
    db.updateSession(session.session_id, { current_training_aid: 'connection_ball' });
    const shotB = logShot(db, db.getSession(session.session_id), { distance_yards: 140 });

    let breakdown = stats.trainingAidBreakdown(db.getShotsForSession(session.session_id));
    assert.equal(breakdown.length, 2, 'two distinct groups while shots differ');
    const withAidGroup = breakdown.find((g) => g.training_aid === 'connection_ball');
    assert.equal(withAidGroup.count, 1);

    // Golfer realizes shot B never actually used the aid — corrects it.
    db.updateShot(session.session_id, shotB.shot_id, { training_aid: 'none' });
    breakdown = stats.trainingAidBreakdown(db.getShotsForSession(session.session_id));
    assert.equal(breakdown.length, 1, 'both shots are now "none" — nothing left to compare, recalculated fresh');
    assert.equal(breakdown[0].training_aid, 'none');
    assert.equal(breakdown[0].count, 2);
  });
});

describe('Scenario I — CSV export includes training_aid', () => {
  test('column present with correct per-shot values', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const exp = await import('../js/export.js');
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    logShot(db, session, {});
    db.updateSession(session.session_id, { current_training_aid: 'alignment_stick' });
    logShot(db, db.getSession(session.session_id), {});

    const csv = exp.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const rows = csv.split('\n').slice(1).map((r) => r.split(','));
    const idx = header.indexOf('training_aid');
    assert.ok(idx !== -1, 'training_aid column present');
    assert.equal(header[idx + 1], 'target_distance_yards', 'sits directly after drill, before target_distance_yards');
    assert.equal(rows[0][idx], 'none');
    assert.equal(rows[1][idx], 'alignment_stick');
  });
});

describe('Scenario J — JSON export/import round-trips training_aid', () => {
  test('full backup/restore preserves every shot\'s training_aid and the session\'s current_training_aid', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-08-01', start_time: '09:00', target_ball_count: 2, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    logShot(db, session, {});
    db.updateSession(session.session_id, { current_training_aid: 'divot_board' });
    logShot(db, db.getSession(session.session_id), {});

    const backup = db.exportFullDB();
    const serialized = JSON.parse(JSON.stringify(backup));
    db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(serialized);

    const restoredSession = db.listSessions()[0];
    assert.equal(restoredSession.current_training_aid, 'divot_board');
    const shots = db.getShotsForSession(restoredSession.session_id).sort((a, b) => a.shot_number - b.shot_number);
    assert.equal(shots[0].training_aid, 'none');
    assert.equal(shots[1].training_aid, 'divot_board');
  });
});

describe('Scenario K — historical sessions without training_aid load without error', () => {
  test('a shot/session shaped exactly like pre-feature data still works everywhere training_aid is read', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const exp = await import('../js/export.js');

    const session = db.createSession({ date: '2020-01-01', start_time: '09:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    // Simulates a legacy session record with no current_training_aid key at
    // all (predates this feature) — deleting it rather than setting to
    // undefined, since JSON/localStorage round-trips would drop an
    // undefined key the same way anyway.
    const raw = db.getSession(session.session_id);
    delete raw.current_training_aid;
    db.importFullDB({ schemaVersion: 1, sessions: [raw], shots: [{ shot_id: 'legacy-1', session_id: session.session_id, shot_number: 1, shot_timestamp: '2020-01-01T09:00:00.000-05:00', club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', drill: null, target_distance_yards: null, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 150, shot_note: '', created_at: '2020-01-01T09:00:00.000Z', updated_at: '2020-01-01T09:00:00.000Z' }], settings: {} });

    assert.equal(db.getSession(session.session_id).current_training_aid, undefined, 'confirms the fixture really has no field, not that it was silently backfilled');
    const shots = db.getShotsForSession(session.session_id);
    assert.equal(shots.length, 1);
    assert.equal(db.shotTrainingAid(shots[0]), 'none', 'missing field normalizes to none, no throw');

    // Every downstream consumer must also handle this without erroring.
    assert.doesNotThrow(() => stats.sessionSummary(shots));
    const summary = stats.sessionSummary(shots);
    assert.equal(summary.trainingAids.length, 1);
    assert.equal(summary.trainingAids[0].training_aid, 'none');
    assert.doesNotThrow(() => exp.sessionCSV(session.session_id));
    const csv = exp.sessionCSV(session.session_id);
    const header = csv.split('\n')[0].split(',');
    const row = csv.split('\n')[1].split(',');
    assert.equal(row[header.indexOf('training_aid')], 'none', 'legacy shot exports with training_aid=none, not blank/undefined');
  });
});

describe('Development fixture — trainingAidBlocks generator support', () => {
  test('50 shots: 1-10 none, 11-15 connection_ball, 16-25 none, 26-30 connection_ball, 31-50 none', async () => {
    const { shots, session } = generateSession({
      seed: 777,
      shots: 50,
      trainingAidBlocks: [
        { count: 10, trainingAid: 'none' },
        { count: 5, trainingAid: 'connection_ball' },
        { count: 10, trainingAid: 'none' },
        { count: 5, trainingAid: 'connection_ball' },
        { count: 20, trainingAid: 'none' },
      ],
    });
    assert.equal(shots.length, 50);
    assert.ok(shots.slice(0, 10).every((s) => s.training_aid === 'none'));
    assert.ok(shots.slice(10, 15).every((s) => s.training_aid === 'connection_ball'));
    assert.ok(shots.slice(15, 25).every((s) => s.training_aid === 'none'));
    assert.ok(shots.slice(25, 30).every((s) => s.training_aid === 'connection_ball'));
    assert.ok(shots.slice(30, 50).every((s) => s.training_aid === 'none'));
    assert.equal(session.current_training_aid, 'none', 'ends on the last block\'s value');
  });

  test('persisted through db.js, isolated from real data, and groups correctly in Explore Session analytics', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const stats = await import('../js/stats.js');
    const gen = generateSession({
      seed: 778,
      shots: 50,
      trainingAidBlocks: [
        { count: 10, trainingAid: 'none' },
        { count: 5, trainingAid: 'connection_ball' },
        { count: 10, trainingAid: 'none' },
        { count: 5, trainingAid: 'connection_ball' },
        { count: 20, trainingAid: 'none' },
      ],
    });
    const sessionId = await persistGenerated(db, gen);
    assert.equal(db.sessionDataSource(db.getSession(sessionId)), 'test', 'fixture data stays clearly tagged as test, never mistaken for real history');

    const shots = db.getShotsForSession(sessionId);
    const breakdown = stats.trainingAidBreakdown(shots);
    assert.equal(breakdown.length, 2);
    const none = breakdown.find((g) => g.training_aid === 'none');
    const aid = breakdown.find((g) => g.training_aid === 'connection_ball');
    assert.equal(none.count, 40);
    assert.equal(aid.count, 10);
  });
});
