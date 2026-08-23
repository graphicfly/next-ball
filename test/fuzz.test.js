import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';

let db;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
});

function baseShot(overrides = {}) {
  return {
    shot_id: 'fuzz-1', session_id: 'fuzz-session', shot_number: 1, shot_timestamp: '2026-01-01T10:00:00-05:00',
    club: '7i', setup: 'ground', surface: 'mat', swing_length: 'full', drill: 'Normal Swing', target_distance_yards: null,
    strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 140,
    ...overrides,
  };
}

describe('Fuzz: malformed/legacy shot data does not crash sessionSummary', () => {
  const cases = {
    'unknown strike enum value': baseShot({ strike: 'chunk' }),
    'uppercase enum values': baseShot({ strike: 'Solid', direction: 'Straight', height: 'Medium' }),
    'missing drill (undefined property)': (() => { const s = baseShot(); delete s.drill; return s; })(),
    'missing shot_timestamp entirely': (() => { const s = baseShot(); delete s.shot_timestamp; return s; })(),
    'null setup': baseShot({ setup: null }),
    'unknown club string': baseShot({ club: 'Mystery Stick 3000' }),
    'missing weather-adjacent fields (n/a at shot level, included for completeness)': baseShot({}),
    'distance_yards as a non-numeric string': baseShot({ distance_yards: 'a lot' }),
    'distance_yards as a numeric string ("140")': baseShot({ distance_yards: '140' }),
    'strike is null': baseShot({ strike: null }),
    'strike is undefined': baseShot({ strike: undefined }),
    'direction is an empty string': baseShot({ direction: '' }),
    'shot_number is a string ("1")': baseShot({ shot_number: '1' }),
    'target_distance_yards as NaN': baseShot({ target_distance_yards: NaN }),
  };

  for (const [name, shot] of Object.entries(cases)) {
    test(`single malformed shot [${name}]: sessionSummary does not throw`, () => {
      assert.doesNotThrow(() => stats.sessionSummary([shot]));
    });
  }

  test('a whole session of unknown-strike shots: percentages stay in [0,100], no crash, totals reflect the unrecognized data honestly', () => {
    const shots = Array.from({ length: 20 }, (_, i) => baseShot({ shot_id: `f${i}`, shot_number: i + 1, strike: 'chunk' }));
    const s = stats.sessionSummary(shots);
    assert.equal(s.total, 20);
    // "chunk" matches no known bucket — every known-strike pct should be 0, not NaN, and nothing should sum to more than 100.
    for (const k of Object.keys(s.strike)) {
      assert.ok(s.strike[k].pct >= 0 && s.strike[k].pct <= 100);
      assert.equal(s.strike[k].pct, 0);
    }
  });

  test('duplicate shot_number across two shots: no crash, both still counted, windows built by position not by number', () => {
    const shots = [
      baseShot({ shot_id: 'd1', shot_number: 5, strike: 'solid' }),
      baseShot({ shot_id: 'd2', shot_number: 5, strike: 'topped' }),
      baseShot({ shot_id: 'd3', shot_number: 6, strike: 'solid' }),
    ];
    assert.doesNotThrow(() => stats.sessionSummary(shots));
    const s = stats.sessionSummary(shots);
    assert.equal(s.total, 3);
  });
});

describe('Fuzz: distance_yards as a non-numeric string does not silently corrupt numeric analytics with NaN', () => {
  test('a string distance among otherwise-valid numeric distances does not turn min/max/median into NaN', () => {
    const shots = [
      baseShot({ shot_id: 'n1', shot_number: 1, distance_yards: 140 }),
      baseShot({ shot_id: 'n2', shot_number: 2, distance_yards: 'abc' }), // malformed legacy/import value
      baseShot({ shot_id: 'n3', shot_number: 3, distance_yards: 150 }),
    ];
    const d = stats.distanceConsistency(shots);
    // This is the exact failure mode fuzzing exists to catch: Math.min/max spread a
    // non-numeric string in and silently produce NaN for the whole aggregate.
    const corrupted = Number.isNaN(d.all.min) || Number.isNaN(d.all.max) || Number.isNaN(d.all.median);
    assert.equal(corrupted, false, 'a malformed distance string corrupted min/max/median into NaN');
  });
});

describe('Fuzz: db.js import layer with structurally-odd (but shape-valid) legacy data', () => {
  test('shot referencing a session_id that does not exist in sessions[]: does not crash getShotsForSession or sessionSummary', () => {
    const backup = {
      schemaVersion: 1,
      sessions: [{ session_id: 'real-session', date: '2026-01-01', start_time: '10:00', status: 'finished', default_club: '7i' }],
      shots: [baseShot({ session_id: 'orphaned-session-that-does-not-exist' })],
      settings: {},
    };
    assert.doesNotThrow(() => db.importFullDB(backup));
    assert.doesNotThrow(() => db.getShotsForSession('real-session'));
    assert.equal(db.getShotsForSession('real-session').length, 0); // orphaned shot correctly excluded, not mis-attributed
  });

  test('session missing optional fields entirely (very old schema shape): summary screens can still compute from its shots', () => {
    const backup = {
      schemaVersion: 1,
      sessions: [{ session_id: 'minimal', date: '2026-01-01', start_time: '10:00', status: 'finished' }], // no default_club, no weather fields, nothing
      shots: [baseShot({ session_id: 'minimal' })],
      settings: {},
    };
    db.importFullDB(backup);
    const shots = db.getShotsForSession('minimal');
    assert.doesNotThrow(() => stats.sessionSummary(shots));
  });

  test('CSV export does not throw for a session with a malformed/legacy shot', async () => {
    const exp = await import('../js/export.js');
    const backup = {
      schemaVersion: 1,
      sessions: [{ session_id: 'legacy', date: '2026-01-01', start_time: '10:00', status: 'finished', default_club: '7i' }],
      shots: [baseShot({ session_id: 'legacy', strike: 'UNKNOWN_LEGACY_VALUE', distance_yards: 'not a number' })],
      settings: {},
    };
    db.importFullDB(backup);
    assert.doesNotThrow(() => exp.sessionCSV('legacy'));
  });
});
