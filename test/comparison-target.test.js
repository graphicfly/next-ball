import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import { generateSession, persistGenerated } from './generator.js';

let db, sessionAnalysis;

beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
  sessionAnalysis = await import('../js/sessionAnalysis.js');
});

describe('Target practice — accuracy metrics and non-contamination', () => {
  test('no target on any shot: targetAccuracyGroups is empty, no crash', () => {
    const { shots } = generateSession({ seed: 100, shots: 20, target: null });
    assert.deepEqual(stats.targetAccuracyGroups(shots), []);
  });

  test('single 125-yard target block: group reflects only those shots', () => {
    const shots = [120, 125, 130, 122, 128].map((d, i) => ({
      shot_number: i + 1, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: d, target_distance_yards: 125,
    }));
    const groups = stats.targetAccuracyGroups(shots);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].target, 125);
    assert.equal(groups[0].count, 5);
  });

  test('target changed mid-session (80yd then 120yd): two independent, non-contaminating groups', () => {
    const shots = [];
    for (let i = 1; i <= 10; i++) shots.push({ shot_number: i, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 78 + (i % 3), target_distance_yards: 80 });
    for (let i = 11; i <= 20; i++) shots.push({ shot_number: i, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 118 + (i % 3), target_distance_yards: 120 });
    const groups = stats.targetAccuracyGroups(shots);
    assert.equal(groups.length, 2);
    const g80 = groups.find((g) => g.target === 80);
    const g120 = groups.find((g) => g.target === 120);
    assert.equal(g80.count, 10);
    assert.equal(g120.count, 10);
    // Distances near 80 must never leak into the 120-target group's median (and vice versa).
    assert.ok(g80.medianActual < 85);
    assert.ok(g120.medianActual > 115);
  });

  test('non-targeted shots (target_distance_yards null) are excluded from every target group', () => {
    const shots = [
      { shot_number: 1, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 100, target_distance_yards: 100 },
      { shot_number: 2, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 9999, target_distance_yards: null }, // wildly different, no target — must not pollute the 100yd group
    ];
    const groups = stats.targetAccuracyGroups(shots);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 1);
    assert.equal(groups[0].medianActual, 100);
  });

  test('signed vs absolute error: over-target is positive signed, under-target is negative, both become positive absolute', () => {
    const shots = [
      { shot_number: 1, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 110, target_distance_yards: 100 }, // +10
      { shot_number: 2, strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 90, target_distance_yards: 100 }, // -10
    ];
    const g = stats.targetAccuracyGroups(shots)[0];
    assert.equal(g.medianSignedError, 0); // median of [+10,-10] = 0
    assert.equal(g.medianAbsoluteError, 10); // median of [10,10] = 10
  });
});

describe('Previous-session comparison — priority scoring and match labeling', () => {
  test('exact match on club/swing/setup beats a session matching on fewer criteria', async () => {
    const older = generateSession({ seed: 201, shots: 15, club: '8i', setup: 'tee', swing: 'half', date: '2026-01-01' });
    const closer = generateSession({ seed: 202, shots: 15, club: '7i', setup: 'ground', swing: 'full', date: '2026-01-02' });
    await persistGenerated(db, older);
    await persistGenerated(db, closer);
    const current = generateSession({ seed: 203, shots: 12, club: '7i', setup: 'ground', swing: 'full', date: '2026-01-03', status: 'active' });
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const priorFinished = db.listFinishedSessions().filter((s) => s.session_id !== currentId);
    const shotsBySessionId = new Map(priorFinished.map((s) => [s.session_id, db.getShotsForSession(s.session_id)]));
    const match = stats.findComparableSession(session, shots, priorFinished, shotsBySessionId);
    assert.equal(match.session.default_club, '7i');
    assert.equal(match.session.default_setup, 'ground');
    assert.equal(match.comparable, true);
  });

  test('only an unrelated prior session exists: comparable=false, but a session is still returned (not silently hidden)', async () => {
    // Every single matching criterion (club/swing/setup/drill/surface) must
    // differ for a genuine zero-score case — generateSession's drill/surface
    // defaults are otherwise identical across calls and would accidentally match.
    const unrelated = generateSession({ seed: 210, shots: 15, club: 'Driver', setup: 'tee', swing: 'half', surface: 'grass', drill: 'Connection', date: '2026-01-01' });
    await persistGenerated(db, unrelated);
    const current = generateSession({ seed: 211, shots: 12, club: 'PW', setup: 'ground', swing: 'full', surface: 'mat', drill: 'Normal Swing', date: '2026-01-02', status: 'active' });
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const priorFinished = db.listFinishedSessions().filter((s) => s.session_id !== currentId);
    const shotsBySessionId = new Map(priorFinished.map((s) => [s.session_id, db.getShotsForSession(s.session_id)]));
    const match = stats.findComparableSession(session, shots, priorFinished, shotsBySessionId);
    assert.equal(match.comparable, false); // nothing matched — must not be silently presented as a real comparison
    assert.ok(match.session); // still surfaces which session it fell back to, for "no closely comparable session found — compared with X" labeling
  });

  test('no prior session at all: findComparableSession returns null (not a crash or empty-but-truthy object)', () => {
    const match = stats.findComparableSession({ default_club: '7i' }, [], [], new Map());
    assert.equal(match, null);
  });

  test('getComparisonContext returns null (section hidden) when there is no prior session', () => {
    const current = generateSession({ seed: 220, shots: 15, status: 'active' });
    return persistGenerated(db, current).then((currentId) => {
      const session = db.getSession(currentId);
      const shots = db.getShotsForSession(currentId);
      const ctx = sessionAnalysis.getComparisonContext(session, shots, stats.bestWindow(shots));
      assert.equal(ctx, null);
    });
  });
});

describe('Percentage-point comparisons — direction of improvement per metric', () => {
  test('Solid 50% -> 40%: diff = +10 pts (not +25%), and is flagged as improvement since higher=better', () => {
    const current = Array.from({ length: 10 }, (_, i) => ({ strike: i < 5 ? 'solid' : 'topped', direction: 'straight' }));
    const previous = Array.from({ length: 10 }, (_, i) => ({ strike: i < 4 ? 'solid' : 'topped', direction: 'straight' }));
    const cmp = stats.compareMetrics(current, previous);
    assert.equal(cmp.solid.current, 50);
    assert.equal(cmp.solid.previous, 40);
    assert.equal(cmp.solid.diff, 10); // percentage POINTS, not (50-40)/40*100=25%
    assert.equal(cmp.solid.betterWhen, 'higher');
  });

  test('lower-is-better metrics (Topped/Fat/Thin) are tagged betterWhen=lower', () => {
    const current = [{ strike: 'topped', direction: 'straight' }];
    const previous = [{ strike: 'topped', direction: 'straight' }];
    const cmp = stats.compareMetrics(current, previous);
    assert.equal(cmp.topped.betterWhen, 'lower');
    assert.equal(cmp.fat.betterWhen, 'lower');
    assert.equal(cmp.thin.betterWhen, 'lower');
    assert.equal(cmp.solidDistanceCV.betterWhen, 'lower');
  });

  test('distance is always tagged neutral, never higher or lower (median needs only 1 sample, unlike stddev/CV which need 3+)', () => {
    const current = [{ strike: 'solid', direction: 'straight', distance_yards: 150 }];
    const previous = [{ strike: 'solid', direction: 'straight', distance_yards: 100 }];
    const cmp = stats.compareMetrics(current, previous);
    assert.equal(cmp.medianSolidDistance.betterWhen, 'neutral');
    assert.equal(cmp.medianSolidDistance.diff, 50); // computed and reported, but never labeled better/worse
  });

  test('distance diff is the raw signed yardage change, with no better/worse judgment attached by the metric itself', () => {
    const current = [1,2,3].map((i) => ({ strike: 'solid', direction: 'straight', distance_yards: 150 }));
    const previous = [1,2,3].map((i) => ({ strike: 'solid', direction: 'straight', distance_yards: 100 }));
    const cmp = stats.compareMetrics(current, previous);
    assert.equal(cmp.medianSolidDistance.diff, 50); // +50 yd, reported neutrally
    assert.equal(cmp.medianSolidDistance.betterWhen, 'neutral');
  });
});
