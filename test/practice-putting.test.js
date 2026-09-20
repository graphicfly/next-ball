import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import * as P from '../js/practice.js';
import { puttingSummary } from '../js/practiceSummary.js';

async function puttingSession(db, { kind = 'short', practice_type = 'short', setup = { distance_ft: 5, surface: 'green' } } = {}) {
  return db.createPracticeSession({ mode: 'putting', kind, practice_type, setup });
}

describe('The distance threshold picks the model, and there is no third', () => {
  test('ten feet is short, eleven is distance control', () => {
    // practice-spec.md §14.1. A 12 ft putt uses Distance Control; there is
    // deliberately no medium-distance result model.
    assert.equal(P.puttModelFor(3), 'short');
    assert.equal(P.puttModelFor(10), 'short');
    assert.equal(P.puttModelFor(11), 'distance');
    assert.equal(P.puttModelFor(12), 'distance');
    assert.equal(P.puttModelFor(40), 'distance');
  });

  test('only two models exist', () => {
    const models = new Set([3, 5, 8, 10, 11, 12, 15, 20, 30, 40, 60].map(P.puttModelFor));
    assert.deepEqual([...models].sort(), ['distance', 'short']);
  });
});

describe('Short putts are one tap, with an optional direction', () => {
  test('a made putt stores nothing but the make', async () => {
    const db = await resetDB();
    const s = await puttingSession(db);
    const p = db.addPutt(s.session_id, { result: 'made' });
    assert.equal(p.result, 'made');
    assert.equal(p.miss_lateral, null);
    assert.equal(p.miss_depth, null);
    assert.equal(p.distance_ft, 5);
    assert.equal(p.surface, 'green');
  });

  test('a miss may carry a direction, or none at all', async () => {
    const db = await resetDB();
    const s = await puttingSession(db);
    const withDir = db.addPutt(s.session_id, { result: 'missed', miss_lateral: 'right' });
    const without = db.addPutt(s.session_id, { result: 'missed' });
    assert.equal(withDir.miss_lateral, 'right');
    assert.equal(without.miss_lateral, null);
  });

  test('both surfaces round-trip', async () => {
    const db = await resetDB();
    for (const surface of P.PUTT_SURFACES) {
      const s = await puttingSession(db, { setup: { distance_ft: 6, surface } });
      assert.equal(db.addPutt(s.session_id, { result: 'made' }).surface, surface);
    }
  });
});

describe('Distance control captures proximity and pace in one record', () => {
  test('a matrix tap stores both', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    const p = db.addPutt(s.session_id, { result: 'missed', leave_bucket: '3_6', leave_dir: 'past' });
    // §16: one selection, never two mandatory questions.
    assert.equal(p.leave_bucket, '3_6');
    assert.equal(p.leave_dir, 'past');
  });

  test('a holed lag is a make with no leave fields', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    const p = db.addPutt(s.session_id, { result: 'made' });
    assert.equal(p.result, 'made');
    assert.equal(p.leave_bucket, null);
    assert.equal(p.leave_dir, null);
  });

  test('pace patterns have full coverage by construction', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    db.addPutt(s.session_id, { result: 'made' });
    for (let i = 0; i < 7; i++) db.addPutt(s.session_id, { result: 'missed', leave_bucket: 'in_3', leave_dir: 'short' });
    for (let i = 0; i < 2; i++) db.addPutt(s.session_id, { result: 'missed', leave_bucket: '3_6', leave_dir: 'past' });
    const sum = puttingSummary(db.getPracticeSession(s.session_id), db.listPutts(s.session_id));
    assert.match(sum.pattern.text, /short/);
    assert.match(sum.pattern.basis, /7 of the 9/);
  });

  test('no fabricated leave distance', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    const p = db.addPutt(s.session_id, { result: 'missed', leave_bucket: '6_plus', leave_dir: 'short' });
    assert.equal('leave_ft' in p, false);
    assert.equal('proximity_ft' in p, false);
  });
});

describe('Mixed practice varies distance and switches model with it', () => {
  test('each putt carries its own distance', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { kind: 'mixed', practice_type: 'mixed', setup: { distance_ft: null, surface: 'green' } });
    const short = db.addPutt(s.session_id, { result: 'made', distance_ft: 5 });
    const lag = db.addPutt(s.session_id, { result: 'missed', distance_ft: 30, leave_bucket: 'in_3', leave_dir: 'short' });
    assert.equal(short.distance_ft, 5);
    assert.equal(lag.distance_ft, 30);
    assert.equal(P.puttModelFor(short.distance_ft), 'short');
    assert.equal(P.puttModelFor(lag.distance_ft), 'distance');
  });
});

describe('Pressure Finish resets, and keeps its tone', () => {
  test('a miss resets the current streak', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { practice_type: 'pressure_finish', setup: { distance_ft: 6, surface: 'green', streak_target: 3 } });
    const results = ['made', 'made', 'missed', 'made', 'made'];
    for (const r of results) db.addPutt(s.session_id, { result: r });
    const putts = db.listPutts(s.session_id);
    let run = 0;
    for (let i = putts.length - 1; i >= 0; i--) { if (putts[i].result === 'made') run += 1; else break; }
    assert.equal(run, 2, 'the run restarts after the miss');
  });

  test('the summary reports a best run and nothing gamified', async () => {
    const db = await resetDB();
    const s = await puttingSession(db, { practice_type: 'pressure_finish', setup: { distance_ft: 6, surface: 'green', streak_target: 3 } });
    for (const r of ['made', 'made', 'made', 'missed', 'made']) db.addPutt(s.session_id, { result: r });
    const sum = puttingSummary(db.getPracticeSession(s.session_id), db.listPutts(s.session_id));
    assert.ok(sum.supporting.some((x) => x.label === 'best run' && x.value === '3'));
    // §18: no XP, badges, points or achievements, ever.
    const text = JSON.stringify(sum).toLowerCase();
    for (const word of ['xp', 'badge', 'points', 'achievement', 'streak bonus', 'level up']) {
      assert.ok(!text.includes(word), `${word} has no place in this app`);
    }
  });
});

describe('Putting summaries', () => {
  test('short putts lead with the make count', async () => {
    const db = await resetDB();
    const s = await puttingSession(db);
    for (let i = 0; i < 10; i++) db.addPutt(s.session_id, { result: i < 8 ? 'made' : 'missed', miss_lateral: i < 8 ? null : 'right' });
    const sum = puttingSummary(db.getPracticeSession(s.session_id), db.listPutts(s.session_id));
    assert.equal(sum.headline.value, '8 / 10');
    assert.equal(sum.headline.label, 'made');
    assert.match(sum.pattern.text, /right/);
  });

  test('no miss direction means no pattern', async () => {
    const db = await resetDB();
    const s = await puttingSession(db);
    for (let i = 0; i < 10; i++) db.addPutt(s.session_id, { result: i < 6 ? 'made' : 'missed' });
    const sum = puttingSummary(db.getPracticeSession(s.session_id), db.listPutts(s.session_id));
    assert.equal(sum.pattern, null);
  });

  test('a practice make rate is never phrased as a course probability', async () => {
    const db = await resetDB();
    const s = await puttingSession(db);
    for (let i = 0; i < 10; i++) db.addPutt(s.session_id, { result: 'made' });
    const sum = puttingSummary(db.getPracticeSession(s.session_id), db.listPutts(s.session_id));
    const text = JSON.stringify(sum).toLowerCase();
    assert.ok(!/likely|probability|expect|on the course/.test(text));
  });
});
