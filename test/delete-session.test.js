import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSession, persistGenerated } from './generator.js';

// Hand-constructs a finished session with an EXACT solid-contact percentage
// (unlike generateSession's weighted-random mix) — needed for the Personal
// Best scenarios below, where the test has to know precisely which session
// currently holds the record.
async function makeExactSession(db, { date, club = '7i', solidCount, total }) {
  const session = db.createSession({
    date, start_time: '10:00', target_ball_count: total,
    default_club: club, default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
  });
  for (let i = 0; i < total; i++) {
    const solid = i < solidCount;
    db.addShot(session.session_id, {
      club, setup: 'ground', surface: 'mat', swing_length: 'full',
      strike: solid ? 'solid' : 'topped',
      direction: 'straight', height: 'medium',
      distance_yards: 140,
    });
  }
  db.finishSession(session.session_id);
  return db.getSession(session.session_id);
}

// created_at is always the real wall-clock moment of creation — entirely
// independent of a session's (fictional, cosmetic) practice `date` — so
// scenarios that depend on chronological order (most-recent, prior-session
// comparison) must force it explicitly rather than relying on `date`.
function forceCreatedAt(db, sessionId, iso) {
  db.updateSession(sessionId, { created_at: iso });
}

// Three finished sessions, same club/setup/swing (so comparison scoring
// ties and falls back to recency — see SCENARIO E), with created_at forced
// into A < B < C order regardless of real test-execution timing.
async function makeABC(db) {
  const a = await persistGenerated(db, generateSession({ seed: 'A', shots: 20, date: '2026-03-01', startTimestamp: new Date('2026-03-01T09:00:00') }));
  const b = await persistGenerated(db, generateSession({ seed: 'B', shots: 20, date: '2026-03-02', startTimestamp: new Date('2026-03-02T09:00:00') }));
  const c = await persistGenerated(db, generateSession({ seed: 'C', shots: 20, date: '2026-03-03', startTimestamp: new Date('2026-03-03T09:00:00') }));
  forceCreatedAt(db, a, '2026-03-01T09:00:00.000-05:00');
  forceCreatedAt(db, b, '2026-03-02T09:00:00.000-05:00');
  forceCreatedAt(db, c, '2026-03-03T09:00:00.000-05:00');
  return { a, b, c };
}

describe('deleteSession — core behavior', () => {
  test('SCENARIO A: delete middle session — A and C survive untouched, only B and its shots are gone', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);

    const result = db.deleteSession(b);
    assert.ok(result);
    assert.equal(result.session.session_id, b);
    assert.equal(result.shots.length, 20);

    assert.ok(db.getSession(a));
    assert.equal(db.getSession(b), null);
    assert.ok(db.getSession(c));

    const ids = db.listSessions().map((s) => s.session_id);
    assert.ok(ids.includes(a));
    assert.ok(!ids.includes(b));
    assert.ok(ids.includes(c));

    assert.equal(db.getShotsForSession(a).length, 20);
    assert.equal(db.getShotsForSession(b).length, 0);
    assert.equal(db.getShotsForSession(c).length, 20);

    // No orphaned shots anywhere in the whole store, either.
    const allShots = db.getAllShots();
    assert.equal(allShots.filter((sh) => sh.session_id === b).length, 0);
    assert.equal(allShots.length, 40);
  });

  test('SCENARIO B: delete most recent session — next most recent becomes latest', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);

    // c is latest before deletion.
    assert.equal(db.listFinishedSessions()[0].session_id, c);

    db.deleteSession(c);

    assert.equal(db.getSession(c), null);
    assert.equal(db.listFinishedSessions()[0].session_id, b, 'b should now be treated as most recent everywhere (Home/History/comparisons)');
    assert.equal(db.listSessions()[0].session_id, b);
  });

  test('SCENARIO C: delete oldest session — remaining History order stays correct', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);

    db.deleteSession(a);

    const order = db.listSessions().map((s) => s.session_id);
    assert.deepEqual(order, [c, b], 'newest-first order preserved for the remaining sessions');
  });

  test('SCENARIO D: deleting session A leaves session B\'s shots completely intact', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const genA = generateSession({ seed: 'A', shots: 50, date: '2026-03-01', startTimestamp: new Date('2026-03-01T09:00:00') });
    const genB = generateSession({ seed: 'B', shots: 60, date: '2026-03-02', startTimestamp: new Date('2026-03-02T09:00:00') });
    const idA = await persistGenerated(db, genA);
    const idB = await persistGenerated(db, genB);

    assert.equal(db.getShotsForSession(idA).length, 50);
    assert.equal(db.getShotsForSession(idB).length, 60);

    db.deleteSession(idA);

    assert.equal(db.getShotsForSession(idA).length, 0);
    assert.equal(db.getShotsForSession(idB).length, 60, 'B keeps every one of its 60 shots');
  });

  test('not found: deleting a nonexistent session_id returns null, changes nothing', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a } = await makeABC(db);
    const before = db.listSessions().length;
    const result = db.deleteSession('does-not-exist');
    assert.equal(result, null);
    assert.equal(db.listSessions().length, before);
  });

  test('SCENARIO I equivalent: a delete that never happens changes absolutely nothing (Cancel path is just "don\'t call deleteSession")', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);
    const snapshotBefore = JSON.stringify(db.getDB());
    // Simulates tapping Cancel — the UI simply never calls deleteSession.
    const snapshotAfter = JSON.stringify(db.getDB());
    assert.equal(snapshotBefore, snapshotAfter);
  });
});

describe('deleteSession — active session protection', () => {
  test('refuses to delete an active session (defensive — UI never offers this path)', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-03-01', start_time: '09:00', target_ball_count: 50, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.throws(() => db.deleteSession(session.session_id), (e) => e.code === 'active_session');
    assert.ok(db.getSession(session.session_id), 'session must still exist after the refused delete');
  });

  test('refuses to delete a paused session', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-03-01', start_time: '09:00', target_ball_count: 50, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.pauseSession(session.session_id);
    assert.throws(() => db.deleteSession(session.session_id), (e) => e.code === 'active_session');
  });
});

describe('deleteSession — SCENARIO K: failure handling', () => {
  test('a storage failure leaves the session and its shots fully intact, and throws rather than pretending success', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);

    const realSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    globalThis.localStorage.setItem = () => { throw new Error('simulated quota exceeded'); };
    try {
      assert.throws(() => db.deleteSession(b), (e) => e.code === 'storage_error');
    } finally {
      globalThis.localStorage.setItem = realSetItem;
    }

    // Nothing was actually removed — the failure happened before the shots
    // chunk was ever touched, and the in-memory index change was rolled back.
    assert.ok(db.getSession(b), 'session must still exist after a failed delete');
    assert.equal(db.getShotsForSession(b).length, 20, 'shots must still exist after a failed delete');
    assert.equal(db.listSessions().length, 3);
  });
});

describe('restoreSession — Undo', () => {
  test('restores a deleted session and its shots byte-for-byte', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);
    const before = db.getSession(b);
    const beforeShots = db.getShotsForSession(b);

    const removed = db.deleteSession(b);
    assert.equal(db.getSession(b), null);

    const restored = db.restoreSession(removed.session, removed.shots);
    assert.equal(restored, true);

    assert.deepEqual(db.getSession(b), before);
    assert.deepEqual(db.getShotsForSession(b), beforeShots);
    assert.equal(db.listSessions().length, 3);
  });

  test('restoring a session that already exists again is a safe no-op (returns false, no duplicate)', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const { a, b, c } = await makeABC(db);
    const session = db.getSession(b);
    const shots = db.getShotsForSession(b);
    const result = db.restoreSession(session, shots);
    assert.equal(result, false);
    assert.equal(db.listSessions().length, 3, 'no duplicate session was added');
  });
});

describe('SCENARIO E: previous-session comparison re-resolves after deleting the comparison session', () => {
  test('deleting B (the session C compared against) makes C compare against A instead', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const sessionAnalysis = await import('../js/sessionAnalysis.js');
    const { a, b, c } = await makeABC(db); // same club/setup/swing on all three -> tie-break picks most recent prior

    const cSession = db.getSession(c);
    const cShots = db.getShotsForSession(c);
    const stats = await import('../js/stats.js');
    const before = sessionAnalysis.getComparisonContext(cSession, cShots, stats.bestWindow(cShots));
    assert.equal(before.match.session.session_id, b, 'C should initially compare against the more recent prior session, B');

    db.deleteSession(b);

    const after = sessionAnalysis.getComparisonContext(cSession, cShots, stats.bestWindow(cShots));
    assert.equal(after.match.session.session_id, a, 'C should now fall back to A, the next valid comparable session');
  });
});

describe('SCENARIO F: Personal Bests recalculate after deleting the record-holding session', () => {
  test('deleting the PB session lets a qualifying remaining session become the new PB', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const sessionAnalysis = await import('../js/sessionAnalysis.js');
    const stats = await import('../js/stats.js');

    // getPersonalBests requires >= 2 OTHER same-club sessions before it will
    // evaluate anything at all (MIN_PRIOR_SESSIONS_FOR_BEST) — a bare 3-session
    // A/B/C setup drops to only 1 other session once B is deleted, which
    // makes it correctly return [] regardless of percentages. A 4th same-club
    // filler session (D) keeps the count above threshold after B is gone.
    const idA = (await makeExactSession(db, { date: '2026-04-01', solidCount: 10, total: 20 })).session_id; // 50%
    const idD = (await makeExactSession(db, { date: '2026-04-02', solidCount: 11, total: 20 })).session_id; // 55%
    const idB = (await makeExactSession(db, { date: '2026-04-03', solidCount: 14, total: 20 })).session_id; // 70% — current PB
    const idC = (await makeExactSession(db, { date: '2026-04-04', solidCount: 13, total: 20 })).session_id; // 65%

    const cShots = db.getShotsForSession(idC);
    const cSummary = stats.sessionSummary(cShots);
    const bestsBefore = sessionAnalysis.getPersonalBests(db.getSession(idC), cShots, cSummary);
    assert.ok(!bestsBefore.some((x) => x.type === 'solidPct'), 'C (65%) should not be a PB while B (70%) still stands');

    db.deleteSession(idB);

    const bestsAfter = sessionAnalysis.getPersonalBests(db.getSession(idC), db.getShotsForSession(idC), stats.sessionSummary(db.getShotsForSession(idC)));
    const solidBest = bestsAfter.find((x) => x.type === 'solidPct');
    assert.ok(solidBest, 'C (65%) should become the new Best Solid % once B (70%) is gone, leaving A (50%) and D (55%) as the remaining competition');
    assert.equal(solidBest.value, 65);
  });
});

describe('SCENARIO G / data_source: Delete All Test Sessions never touches real data', () => {
  test('3 real + 5 test sessions -> only the 5 test sessions and their shots are removed', async () => {
    const db = await (await import('./setup.js')).resetDB();

    const realIds = [];
    for (let i = 0; i < 3; i++) {
      const s = db.createSession({ date: `2026-05-0${i + 1}`, start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
      for (let j = 0; j < 10; j++) db.addShot(s.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
      db.finishSession(s.session_id);
      realIds.push(s.session_id);
    }

    const testIds = [];
    for (let i = 0; i < 5; i++) {
      const id = await persistGenerated(db, generateSession({ seed: `test-${i}`, shots: 15, date: `2026-05-1${i}`, startTimestamp: new Date(`2026-05-1${i}T09:00:00`) }));
      testIds.push(id);
    }

    assert.equal(db.listSessions().length, 8);
    for (const id of realIds) assert.equal(db.sessionDataSource(db.getSession(id)), 'real');
    for (const id of testIds) assert.equal(db.sessionDataSource(db.getSession(id)), 'test');

    const result = db.deleteAllTestSessions();
    assert.equal(result.deleted, 5);
    assert.equal(result.total, 5);
    assert.equal(result.failed.length, 0);

    assert.equal(db.listSessions().length, 3);
    for (const id of realIds) {
      assert.ok(db.getSession(id), 'real session must survive');
      assert.equal(db.getShotsForSession(id).length, 10, 'real session shots must survive');
    }
    for (const id of testIds) assert.equal(db.getSession(id), null);
  });
});

describe('SCENARIO H: historical session with no data_source field', () => {
  test('is treated as real, appears normally, survives Delete All Test Sessions, and can still be individually deleted', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const session = db.createSession({ date: '2026-05-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
    db.finishSession(session.session_id);

    // Simulate genuinely old data saved before data_source existed, by
    // stripping the field directly out of raw storage and forcing db.js to
    // re-read it fresh — exactly the kind of legacy-shape test this
    // project's suite already uses for backward-compat coverage.
    const raw = JSON.parse(globalThis.localStorage.getItem('rangelog_index_v1'));
    delete raw.sessions.find((s) => s.session_id === session.session_id).data_source;
    globalThis.localStorage.setItem('rangelog_index_v1', JSON.stringify(raw));
    db.__resetForTests();

    const reloaded = db.getSession(session.session_id);
    assert.ok(!('data_source' in reloaded) || reloaded.data_source === undefined);
    assert.equal(db.sessionDataSource(reloaded), 'real');
    assert.ok(db.listFinishedSessions().some((s) => s.session_id === session.session_id));

    const result = db.deleteAllTestSessions();
    assert.equal(result.total, 0, 'a fieldless legacy session must never be swept up as test data');
    assert.ok(db.getSession(session.session_id), 'still present after Delete All Test Sessions');

    const deleted = db.deleteSession(session.session_id);
    assert.ok(deleted);
    assert.equal(db.getSession(session.session_id), null);
  });
});

describe('data_source auto-tagging', () => {
  test('createSession() with no data_source defaults to real, automatically', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const s = db.createSession({ date: '2026-05-01', start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    assert.equal(s.data_source, 'real');
  });

  test('persistGenerated() (the simulated-session fixture path) always tags test', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const id = await persistGenerated(db, generateSession({ seed: 1, shots: 5 }));
    assert.equal(db.getSession(id).data_source, 'test');
  });
});

describe('SCENARIO L: exports stay valid after deletion', () => {
  test('a deleted session never reappears in CSV or JSON exports', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const exp = await import('../js/export.js');
    const { a, b, c } = await makeABC(db);

    db.deleteSession(b);

    const csv = exp.allShotsCSV();
    assert.ok(!csv.includes(b), 'deleted session_id must not appear anywhere in the CSV');
    const rowCount = csv.trim().split('\n').length - 1;
    assert.equal(rowCount, 40, 'only A and C\'s 20 shots each remain');

    const backup = db.exportFullDB();
    assert.ok(!backup.sessions.some((s) => s.session_id === b));
    assert.ok(!backup.shots.some((sh) => sh.session_id === b));
    assert.equal(backup.sessions.length, 2);
    assert.equal(backup.shots.length, 40);
  });
});

describe('High-volume: bulk delete correctness and performance', () => {
  test('100 sessions x 50 shots — delete one middle, the latest, the oldest, and several test sessions', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const id = await persistGenerated(db, generateSession({
        seed: 60000 + i, shots: 50, club: ['7i', '9i', 'PW', 'Driver'][i % 4],
        date: `2026-06-${String(1 + (i % 28)).padStart(2, '0')}`,
        startTimestamp: new Date(2026, 5, 1 + (i % 28), 9, 0, 0, i), // distinct ms so created_at strictly increases with i
      }));
      db.finishSession(id);
      ids.push(id);
    }
    // A handful of real sessions mixed in too, so the test-vs-real filter is exercised at volume.
    const realIds = [];
    for (let i = 0; i < 5; i++) {
      const s = db.createSession({ date: `2026-07-0${i + 1}`, start_time: '09:00', target_ball_count: 10, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
      for (let j = 0; j < 10; j++) db.addShot(s.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
      db.finishSession(s.session_id);
      realIds.push(s.session_id);
    }

    assert.equal(db.getAllShots().length, 100 * 50 + 5 * 10);

    const t0 = performance.now();
    // Picked by position within the 100 known-test-session `ids` array, not
    // via a live "latest"/"oldest" query — the 5 real sessions were created
    // afterward in real wall-clock time, so a live query for "latest" would
    // actually resolve to a REAL session here, not the intended test one.
    const middle = ids[50];
    const latestTest = ids[ids.length - 1];
    const oldestTest = ids[0];

    db.deleteSession(middle);
    db.deleteSession(latestTest);
    db.deleteSession(oldestTest);
    const testResult = db.deleteAllTestSessions();
    const elapsed = performance.now() - t0;
    console.log(`    [timing] delete middle+latest+oldest+${testResult.deleted} test sessions from a 105-session store: ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 2000, `bulk deletion took ${elapsed.toFixed(0)}ms — investigate before shipping`);

    // No orphans: every remaining session's shots are exactly what's expected, and nothing points at a deleted id.
    const remaining = db.listSessions();
    assert.equal(remaining.length, 5, 'only the 5 real sessions should survive');
    for (const s of remaining) {
      assert.equal(db.sessionDataSource(s), 'real');
      assert.equal(db.getShotsForSession(s.session_id).length, 10);
    }
    const allShots = db.getAllShots();
    assert.equal(allShots.length, 5 * 10);
    for (const sh of allShots) assert.ok(remaining.some((s) => s.session_id === sh.session_id));
  });
});
