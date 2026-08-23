import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { persistGenerated } from './generator.js';

async function freshModules() {
  const db = await (await import('./setup.js')).resetDB();
  // setupPersonalization.js has no module-scope state of its own (it reads
  // db.js fresh every call), so it doesn't need its own reset — importing
  // it after resetDB() is enough.
  const personalization = await import('../js/setupPersonalization.js');
  return { db, personalization };
}

function makeRealSession(db, { club, ballCount = 50, date = '2026-01-01' }) {
  return db.createSession({
    date, start_time: '09:00', target_ball_count: ballCount,
    default_club: club, default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
  });
}

describe('Scenario 37 — quick clubs favor frequency', () => {
  test('5x 7i, 4x PW, 3x 8i, 2x Driver, 1x 6i ranks 7i/PW/8i/Driver on top', async () => {
    const { db, personalization } = await freshModules();
    const counts = [['7i', 5], ['PW', 4], ['8i', 3], ['Driver', 2], ['6i', 1]];
    let day = 1;
    for (const [club, n] of counts) {
      for (let i = 0; i < n; i++) {
        const s = makeRealSession(db, { club, date: `2026-01-${String(day++).padStart(2, '0')}` });
        db.finishSession(s.session_id);
      }
    }
    const picks = personalization.getClubQuickPicks();
    assert.equal(picks.length, 4);
    assert.deepEqual([...picks].sort(), ['7i', '8i', 'Driver', 'PW'], 'the 4 most-practiced clubs should be favored over the single 6i session');
    assert.ok(!picks.includes('6i'), '6i (used only once) should not make the quick-pick row');
  });
});

describe('Scenario 38 — test sessions never influence real personalization', () => {
  test('50 simulated Driver sessions + 5 real 7i sessions: Driver is not a top real pick', async () => {
    const { db, personalization } = await freshModules();
    for (let i = 0; i < 50; i++) {
      await persistGenerated(db, (await import('./generator.js')).generateSession({
        seed: `driver-${i}`, club: 'Driver', shots: 5, date: `2026-02-${String((i % 27) + 1).padStart(2, '0')}`,
      }));
    }
    for (let i = 0; i < 5; i++) {
      const s = makeRealSession(db, { club: '7i', date: `2026-03-${String(i + 1).padStart(2, '0')}` });
      db.finishSession(s.session_id);
    }
    const picks = personalization.getClubQuickPicks();
    assert.ok(picks.includes('7i'), '7i (the only real club practiced) should be a quick pick');
    // Driver only appears via test sessions, which must be excluded entirely
    // from the ranking — it should not outrank 7i for the top slot.
    const ranked = personalization.rankByField(personalization.realFinishedSessions(), 'default_club');
    assert.deepEqual(ranked, [{ value: '7i', score: 7.5 }], 'ranking must be built from real sessions only (5 lifetime + all 5 within the recency window)');
  });
});

describe('Scenario 39 — recency has a sensible influence', () => {
  test('a historically frequent-but-stale club does not permanently outrank recent repeated use', async () => {
    const { db, personalization } = await freshModules();
    // 8 lifetime uses of 5i, all old (outside the recency window).
    for (let i = 0; i < 8; i++) {
      const s = makeRealSession(db, { club: '5i', date: `2025-01-${String(i + 1).padStart(2, '0')}` });
      db.finishSession(s.session_id);
    }
    // 6 more recent sessions, all GW (moderate lifetime total, but all within the recency window).
    for (let i = 0; i < 6; i++) {
      const s = makeRealSession(db, { club: 'GW', date: `2026-06-${String(i + 1).padStart(2, '0')}` });
      db.finishSession(s.session_id);
    }
    const ranked = personalization.rankByField(personalization.realFinishedSessions(), 'default_club');
    const scoreOf = (v) => ranked.find((r) => r.value === v)?.score ?? 0;
    // 5i: 8 lifetime, 0 recent = 8. GW: 6 lifetime + up to 6 recent (capped
    // at the 10-session recency window) = at least 6 + 4*0.5 = 8, and GW is
    // the more recently-practiced club — recency should be enough to close
    // most of the gap even though 5i has more lifetime uses.
    assert.ok(scoreOf('GW') >= scoreOf('5i') - 1, `recency should meaningfully narrow the gap (5i=${scoreOf('5i')}, GW=${scoreOf('GW')})`);
  });
});

describe('Scenario 42 — last real setup is remembered', () => {
  test('7i / 60 balls / Mat / Ground / Half restores as the new-session default', async () => {
    const { db, personalization } = await freshModules();
    const s = db.createSession({
      date: '2026-04-01', start_time: '09:00', target_ball_count: 60,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'half',
    });
    db.updateSession(s.session_id, { current_drill: 'Low Point' });
    db.finishSession(s.session_id);

    const defaults = personalization.getLastRealSetupDefaults();
    assert.equal(defaults.club, '7i');
    assert.equal(defaults.ballCount, 60);
    assert.equal(defaults.surface, 'mat');
    assert.equal(defaults.setup, 'ground');
    assert.equal(defaults.swing, 'half');
    assert.equal(defaults.drill, 'Low Point');
  });
});

describe('Scenario 43 — deleting the remembered session falls back correctly', () => {
  test('deleting the most recent real session restores defaults from the next one', async () => {
    const { db, personalization } = await freshModules();
    const older = db.createSession({
      date: '2026-04-01', start_time: '09:00', target_ball_count: 30,
      default_club: 'PW', default_setup: 'tee', default_surface: 'grass', default_swing: 'full',
    });
    db.finishSession(older.session_id);
    const newer = db.createSession({
      date: '2026-04-05', start_time: '09:00', target_ball_count: 60,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'half',
    });
    db.finishSession(newer.session_id);

    assert.equal(personalization.getLastRealSetupDefaults().club, '7i');
    db.deleteSession(newer.session_id);
    const defaults = personalization.getLastRealSetupDefaults();
    assert.equal(defaults.club, 'PW');
    assert.equal(defaults.ballCount, 30);
    assert.equal(defaults.surface, 'grass');
    assert.equal(defaults.setup, 'tee');
  });
});

describe('Scenario 44 — Target is never part of remembered setup defaults', () => {
  test('a session finished with a target does not leak into getLastRealSetupDefaults()', async () => {
    const { db, personalization } = await freshModules();
    const s = db.createSession({
      date: '2026-05-01', start_time: '09:00', target_ball_count: 30,
      default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
    });
    db.updateSession(s.session_id, { current_target_distance: 75 });
    db.finishSession(s.session_id);

    const defaults = personalization.getLastRealSetupDefaults();
    assert.equal('target' in defaults, false, 'target must not be part of the remembered-defaults shape at all');
  });
});

describe('Quick-pick stability', () => {
  test('a challenger within the replace margin does not bump an incumbent', async () => {
    const { db, personalization } = await freshModules();
    for (let i = 0; i < 5; i++) { const s = makeRealSession(db, { club: '7i', date: `2026-06-${String(i + 1).padStart(2, '0')}` }); db.finishSession(s.session_id); }
    for (let i = 0; i < 5; i++) { const s = makeRealSession(db, { club: 'PW', date: `2026-06-1${i}` }); db.finishSession(s.session_id); }
    for (let i = 0; i < 4; i++) { const s = makeRealSession(db, { club: '8i', date: `2026-06-2${i}` }); db.finishSession(s.session_id); }
    for (let i = 0; i < 3; i++) { const s = makeRealSession(db, { club: 'Driver', date: `2026-06-2${i + 5}` }); db.finishSession(s.session_id); }

    const first = personalization.getClubQuickPicks();
    personalization.recordClubQuickPicks(first);

    // One more 6i session — not enough to clear the replace margin against
    // the weakest incumbent (Driver, score 3).
    const extra = makeRealSession(db, { club: '6i', date: '2026-07-01' });
    db.finishSession(extra.session_id);

    const second = personalization.getClubQuickPicks();
    assert.deepEqual(second, first, 'a single marginal use should not reshuffle the quick-pick row');
  });
});
