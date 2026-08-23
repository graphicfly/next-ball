import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSession, persistGenerated } from './generator.js';

async function seedSessions(db, count, shotsPer) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const gen = generateSession({ seed: 50000 + i, shots: shotsPer, club: ['7i', '9i', 'PW', 'Driver'][i % 4], status: 'active', date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` });
    const id = await persistGenerated(db, gen);
    db.finishSession(id);
    ids.push(id);
  }
  return ids;
}

// One shared, self-contained test (not split across beforeEach-reset
// subtests) so the 100-session dataset seeded once is actually still there
// for every measurement that follows.
test('High-volume stress: 100 sessions x 50 shots = 5,000 shots', async () => {
  const db = await (await import('./setup.js')).resetDB();
  const stats = await import('../js/stats.js');
  const exp = await import('../js/export.js');
  const sessionAnalysis = await import('../js/sessionAnalysis.js');

  const t0seed = performance.now();
  const ids = await seedSessions(db, 100, 50);
  const seedElapsed = performance.now() - t0seed;
  assert.equal(ids.length, 100);
  assert.equal(db.getAllShots().length, 5000);
  console.log(`    [timing] seed 100x50 (5000 shots): ${seedElapsed.toFixed(0)}ms`);

  // "History load" — sessionSummary() for every session, exactly as history.js does on every render.
  const sessions = db.listSessions();
  assert.equal(sessions.length, 100);
  let t0 = performance.now();
  for (const session of sessions) stats.sessionSummary(db.getShotsForSession(session.session_id));
  let elapsed = performance.now() - t0;
  console.log(`    [timing] History load (100 sessions): ${elapsed.toFixed(1)}ms (${(elapsed / 100).toFixed(2)}ms/session)`);
  assert.ok(elapsed < 5000, `History load took ${elapsed.toFixed(0)}ms — investigate before shipping`);

  // "Trends load"
  const sorted = [...sessions].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  t0 = performance.now();
  for (const session of sorted) stats.sessionTrendPoint(session, db.getShotsForSession(session.session_id), {});
  elapsed = performance.now() - t0;
  console.log(`    [timing] Trends load (100 sessions): ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 3000);

  // Single Session Summary + previous-session comparison scan.
  const target = sessions[50];
  const targetShots = db.getShotsForSession(target.session_id);
  t0 = performance.now();
  const s = stats.sessionSummary(targetShots);
  sessionAnalysis.getComparisonContext(target, targetShots, s.bestWindow);
  elapsed = performance.now() - t0;
  console.log(`    [timing] single Session Summary + comparison scan: ${elapsed.toFixed(2)}ms`);
  assert.ok(elapsed < 500);

  // CSV export of all 5,000 shots.
  t0 = performance.now();
  const csv = exp.allShotsCSV();
  elapsed = performance.now() - t0;
  const rowCount = csv.trim().split('\n').length - 1;
  console.log(`    [timing] allShotsCSV (5000 shots): ${elapsed.toFixed(1)}ms`);
  assert.equal(rowCount, 5000);
  assert.ok(elapsed < 2000);

  // JSON export + full round-trip.
  t0 = performance.now();
  const backup = db.exportFullDB();
  const serialized = JSON.stringify(backup);
  await db.__resetForTests();
  globalThis.localStorage.clear();
  db.importFullDB(JSON.parse(serialized));
  elapsed = performance.now() - t0;
  console.log(`    [timing] JSON export+reimport (5000 shots, ${(serialized.length / 1024).toFixed(0)}KB): ${elapsed.toFixed(1)}ms`);
  assert.equal(db.getAllShots().length, 5000);
  assert.ok(elapsed < 3000);

  // Editing a shot after the reimport above (fresh _db instance/index).
  const editTarget = db.getShotsForSession(ids[10])[25];
  t0 = performance.now();
  db.updateShot(editTarget.session_id, editTarget.shot_id, { strike: 'topped' });
  elapsed = performance.now() - t0;
  console.log(`    [timing] single shot edit (shot lookup now O(1) via index, not a 5000-row scan): ${elapsed.toFixed(2)}ms`);
  assert.ok(elapsed < 50);
});

// This is the headline finding from this stress pass: run once, at a scale
// deliberately chosen to demonstrate the scaling curve without making the
// suite itself impractically slow to run repeatedly (the full 500-session /
// 25,000-shot volume the prompt asks about was run manually once — see the
// final report for those numbers and the root-cause analysis).
describe('Scaling curve — demonstrates cost grows with TOTAL lifetime shots, not per-session', () => {
  test('per-session seeding cost at increasing total shot counts', async () => {
    const db = await (await import('./setup.js')).resetDB();
    const checkpoints = [20, 60, 120, 200]; // cumulative session count
    let lastCount = 0;
    let lastT = performance.now();
    for (const target of checkpoints) {
      await seedSessions(db, target - lastCount, 50);
      const now = performance.now();
      const batchMs = now - lastT;
      const perSessionMs = batchMs / (target - lastCount);
      console.log(`    [timing] sessions ${lastCount + 1}-${target} (total shots so far: ${target * 50}): ${batchMs.toFixed(0)}ms for this batch, ${perSessionMs.toFixed(2)}ms/session`);
      lastT = now;
      lastCount = target;
    }
    assert.equal(db.getAllShots().length, 200 * 50);
  });
});
