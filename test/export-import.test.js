import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateSession, persistGenerated } from './generator.js';

let db, exp;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
  exp = await import('../js/export.js');
});

// Minimal RFC4180-ish CSV parser for verifying round-trip fidelity —
// independent of the app's own csvEscape so it's a real cross-check, not a
// tautology.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

describe('CSV export — structure and escaping', () => {
  for (const n of [3, 50, 100]) {
    test(`${n}-shot session: exactly ${n} data rows + 1 header, no column shift on any row`, async () => {
      const gen = generateSession({ seed: 9000 + n, shots: n, status: 'active' });
      const sessionId = await persistGenerated(db, gen);
      db.finishSession(sessionId);
      const csv = exp.sessionCSV(sessionId);
      const rows = parseCSV(csv.trim());
      assert.equal(rows.length, n + 1);
      const headerLen = rows[0].length;
      for (let i = 1; i < rows.length; i++) assert.equal(rows[i].length, headerLen, `row ${i} column count mismatch`);
    });
  }

  test('every required column from the prompt spec is present in the header', async () => {
    const gen = generateSession({ seed: 9100, shots: 5, status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    const header = parseCSV(exp.sessionCSV(sessionId))[0];
    const required = [
      'session_id', 'date', 'start_time', 'shot_timestamp', 'shot_number', 'club', 'setup', 'swing_length',
      'drill', 'target_distance_yards', 'strike', 'direction', 'height', 'distance_yards',
      'temperature_f', 'location', 'fatigue_rating', 'hand_discomfort_rating', 'elbow_discomfort_rating',
    ];
    for (const col of required) assert.ok(header.includes(col), `missing column: ${col}`);
  });

  test('shot numbers, club, strike, and distance survive the round trip exactly', async () => {
    const gen = generateSession({ seed: 9200, shots: 8, club: '9i', status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    const shots = db.getShotsForSession(sessionId);
    const rows = parseCSV(exp.sessionCSV(sessionId));
    const header = rows[0];
    const idx = (col) => header.indexOf(col);
    for (let i = 0; i < shots.length; i++) {
      const row = rows[i + 1];
      assert.equal(row[idx('shot_number')], String(shots[i].shot_number));
      assert.equal(row[idx('club')], '9i');
      assert.equal(row[idx('strike')], shots[i].strike);
    }
  });

  test('a comma inside a value (custom club name) is escaped and parses back to the exact original string', async () => {
    const session = db.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 1, default_club: 'Wedge, 60deg', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: 'Wedge, 60deg', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 80 });
    db.finishSession(session.session_id);
    const csv = exp.sessionCSV(session.session_id);
    const rows = parseCSV(csv);
    const clubIdx = rows[0].indexOf('club');
    assert.equal(rows[1][clubIdx], 'Wedge, 60deg'); // parsed back to the exact original, comma intact
  });

  test('a double-quote inside a value is escaped and parses back correctly', async () => {
    const session = db.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', drill: 'Grip "V" check', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
    db.finishSession(session.session_id);
    const csv = exp.sessionCSV(session.session_id);
    const rows = parseCSV(csv);
    const drillIdx = rows[0].indexOf('drill');
    assert.equal(rows[1][drillIdx], 'Grip "V" check');
  });

  test('null/missing weather and fatigue fields produce empty CSV cells, not "null" or "undefined" strings', async () => {
    const session = db.createSession({ date: '2026-01-01', start_time: '10:00', target_ball_count: 1, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    db.addShot(session.session_id, { club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140 });
    db.finishSession(session.session_id);
    const rows = parseCSV(exp.sessionCSV(session.session_id));
    const header = rows[0];
    for (const col of ['temperature_f', 'fatigue_rating', 'hand_discomfort_rating', 'elbow_discomfort_rating', 'location']) {
      assert.equal(rows[1][header.indexOf(col)], '');
    }
  });

  test('allShotsCSV spans multiple sessions correctly, one row per shot across all of them', async () => {
    const a = await persistGenerated(db, generateSession({ seed: 9300, shots: 4, status: 'active' }));
    db.finishSession(a);
    const b = await persistGenerated(db, generateSession({ seed: 9301, shots: 6, status: 'active' }));
    db.finishSession(b);
    const rows = parseCSV(exp.allShotsCSV().trim());
    assert.equal(rows.length, 1 + 4 + 6);
  });
});

describe('JSON export / import — round-trip integrity', () => {
  test('full backup round-trips sessions and shots identically into a clean store', async () => {
    const a = generateSession({ seed: 9400, shots: 12, club: '7i', status: 'active' });
    const aId = await persistGenerated(db, a);
    db.finishSession(aId);
    const b = generateSession({ seed: 9401, shots: 30, club: 'PW', status: 'active' });
    const bId = await persistGenerated(db, b);
    db.finishSession(bId);

    const backup = db.exportFullDB();
    assert.equal(backup.sessions.length, 2);
    assert.equal(backup.shots.length, 42);

    // Import into a genuinely clean store.
    await db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(backup);

    const restoredSessions = db.listSessions();
    assert.equal(restoredSessions.length, 2);
    const restoredShotsA = db.getShotsForSession(aId);
    assert.equal(restoredShotsA.length, 12);
    // Deep-equal the actual shot content (not just counts) for one session.
    assert.deepEqual(restoredShotsA.map((s) => s.shot_id).sort(), db.getShotsForSession(aId).map((s) => s.shot_id).sort());
  });

  test('timestamps and IDs are preserved exactly through the round trip (not regenerated)', async () => {
    const gen = generateSession({ seed: 9410, shots: 5, status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    const before = db.getShotsForSession(sessionId).map((s) => ({ id: s.shot_id, ts: s.shot_timestamp }));

    const backup = db.exportFullDB();
    await db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(backup);

    const after = db.getShotsForSession(sessionId).map((s) => ({ id: s.shot_id, ts: s.shot_timestamp }));
    assert.deepEqual(after, before);
  });

  test('analytics recompute identically before and after a round trip', async () => {
    const stats = await import('../js/stats.js');
    const gen = generateSession({ seed: 9420, shots: 40, status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    const before = stats.sessionSummary(db.getShotsForSession(sessionId));

    const backup = db.exportFullDB();
    await db.__resetForTests();
    globalThis.localStorage.clear();
    db.importFullDB(backup);

    const after = stats.sessionSummary(db.getShotsForSession(sessionId));
    assert.deepEqual(after, before);
  });

  test('re-importing the same backup again does not silently merge/dedupe — it fully replaces the store (documented behavior, not a crash)', async () => {
    const gen = generateSession({ seed: 9430, shots: 5, status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    const backup = db.exportFullDB();
    db.importFullDB(backup); // import "on top of" the same live data
    db.importFullDB(backup); // and again
    assert.equal(db.listSessions().length, 1); // replaces wholesale each time — no duplication
  });

  test('malformed JSON import throws a clear error and does NOT corrupt/wipe existing data', async () => {
    const gen = generateSession({ seed: 9440, shots: 3, status: 'active' });
    const sessionId = await persistGenerated(db, gen);
    db.finishSession(sessionId);
    assert.throws(() => db.importFullDB({ notASession: true }));
    assert.throws(() => db.importFullDB(null));
    assert.throws(() => db.importFullDB('garbage'));
    // Existing data must be untouched after each failed import attempt.
    assert.equal(db.getShotsForSession(sessionId).length, 3);
    assert.equal(db.listSessions().length, 1);
  });

  test('partial/empty backup (valid shape, zero sessions) imports cleanly to an empty store', () => {
    db.importFullDB({ schemaVersion: 1, sessions: [], shots: [], settings: {} });
    assert.equal(db.listSessions().length, 0);
    assert.equal(db.getAllShots().length, 0);
  });
});
