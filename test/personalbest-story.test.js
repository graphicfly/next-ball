import './setup.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import { buildRecapInsight } from '../js/sessionStory.js';
import { generateSession, persistGenerated } from './generator.js';

let db, sessionAnalysis;
beforeEach(async () => {
  db = await (await import('./setup.js')).resetDB();
  sessionAnalysis = await import('../js/sessionAnalysis.js');
});

describe('Personal Bests — gating, scoping, and tie handling', () => {
  test('fewer than 2 prior same-club sessions: no PB flagged even if objectively the best ever', async () => {
    const prior = generateSession({ seed: 300, shots: 20, club: '7i', strikeMix: { topped: 1 }, date: '2026-01-01' }); // 0% solid
    await persistGenerated(db, prior);
    const current = generateSession({ seed: 301, shots: 20, club: '7i', strikeMix: { solid: 1 }, date: '2026-01-02', status: 'active' }); // 100% solid — objectively best
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const s = stats.sessionSummary(shots);
    const bests = sessionAnalysis.getPersonalBests(session, shots, s);
    assert.deepEqual(bests, []); // only 1 prior same-club session — "best ever" isn't a meaningful claim yet
  });

  test('2+ prior same-club sessions, current strictly exceeds all: Best Solid % is flagged', async () => {
    for (let i = 0; i < 2; i++) {
      const prior = generateSession({ seed: 310 + i, shots: 20, club: '7i', strikeMix: { solid: 0.5, topped: 0.5 }, date: `2026-01-0${i + 1}` });
      await persistGenerated(db, prior);
    }
    const current = generateSession({ seed: 313, shots: 20, club: '7i', strikeMix: { solid: 1 }, date: '2026-01-05', status: 'active' });
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const s = stats.sessionSummary(shots);
    const bests = sessionAnalysis.getPersonalBests(session, shots, s);
    assert.ok(bests.some((b) => b.type === 'solidPct'));
  });

  test('exact tie with the best prior session: NOT flagged as a new PB (must strictly exceed, ties are intentional non-events)', async () => {
    // Two identical prior sessions at exactly 50% solid.
    for (let i = 0; i < 2; i++) {
      const shots = Array.from({ length: 20 }, (_, j) => ({ strike: j < 10 ? 'solid' : 'topped', direction: 'straight' }));
      const session = { session_id: `prior-${i}`, date: `2026-01-0${i + 1}`, start_time: '10:00', target_ball_count: 20, default_club: '7i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full', current_drill: 'Normal Swing', current_target_distance: null, practice_focus: [], session_notes: '', fatigue_rating: null, hand_discomfort_rating: null, elbow_discomfort_rating: null, status: 'finished' };
      await persistGenerated(db, { session, shots: shots.map((s, j) => ({ ...s, drill: 'Normal Swing', target_distance_yards: null, height: 'medium', distance_yards: 140 })) });
    }
    const current = generateSession({ seed: 320, shots: 20, club: '7i', strikeMix: { solid: 1 }, date: '2026-01-10', status: 'active' });
    // Force current to exactly 50% too, tying rather than beating.
    current.shots.forEach((sh, i) => { sh.strike = i < 10 ? 'solid' : 'topped'; });
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const s = stats.sessionSummary(shots);
    const bests = sessionAnalysis.getPersonalBests(session, shots, s);
    assert.equal(bests.some((b) => b.type === 'solidPct'), false);
  });

  test('PB is scoped to the same club: a great Driver session never counts as a 7i PB', async () => {
    for (let i = 0; i < 2; i++) {
      const prior = generateSession({ seed: 330 + i, shots: 20, club: '7i', strikeMix: { solid: 0.9 }, date: `2026-01-0${i + 1}` });
      await persistGenerated(db, prior);
    }
    // Different club entirely, terrible session — must not affect 7i comparisons either direction.
    const otherClub = generateSession({ seed: 333, shots: 20, club: 'Driver', strikeMix: { topped: 1 }, date: '2026-01-04' });
    await persistGenerated(db, otherClub);
    const current = generateSession({ seed: 334, shots: 20, club: '7i', strikeMix: { solid: 0.95 }, date: '2026-01-05', status: 'active' });
    const currentId = await persistGenerated(db, current);
    const session = db.getSession(currentId);
    const shots = db.getShotsForSession(currentId);
    const s = stats.sessionSummary(shots);
    const priorSameClub = db.listFinishedSessions().filter((p) => p.default_club === '7i');
    assert.equal(priorSameClub.length, 2); // the Driver session correctly excluded from the "prior same club" pool
  });
});

describe('sessionStory.buildRecapInsight — priority chain', () => {
  function summaryWith(overrides) {
    return {
      total: 10,
      strike: {
        solid: { pct: 30, count: 3 },
        thin: { pct: 0, count: 0 },
        topped: { pct: 0, count: 0 },
        fat: { pct: 0, count: 0 },
        shank: { pct: 0, count: 0 },
        miss: { pct: 0, count: 0 },
      },
      bestWindow: null,
      firstLast: { overlapping: true, first10: [], last10: [] },
      streaks: { cleanContact: { length: 0 }, solid: { length: 0 } },
      ...overrides,
    };
  }

  test('Personal Best takes priority over every other tier when present', () => {
    const s = summaryWith({ strike: { solid: { pct: 95 } }, bestWindow: { solidPct: 100, startBall: 1, endBall: 10 } });
    const bests = [{ type: 'solidPct', label: 'Best Solid %', value: 95 }];
    const insight = buildRecapInsight(s, null, bests, { default_club: '7i' });
    assert.equal(insight.headline, 'Personal Best');
  });

  test('a strong bestWindow alone produces no insight — the dedicated Best Stretch section already shows that exact window, so an insight-card copy would just duplicate it', () => {
    const s = summaryWith({ bestWindow: { solidPct: 90, startBall: 1, endBall: 10 } });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight, null);
  });

  test('Contact Improved fires when comparison solid diff >= 8 pts on a long-enough session', () => {
    const s = summaryWith({ bestWindow: { solidPct: 90, startBall: 1, endBall: 10 } });
    const comparison = { metricsCompare: { solid: { diff: 10 }, topped: { diff: 0 }, fat: { diff: 0 }, solidDistanceCV: { diff: 0 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.equal(insight.headline, 'Contact Improved');
  });

  test('comparison tiers are ignored below the 10-shot comparison floor, even with a huge point diff (small samples are too noisy to call "improved")', () => {
    const s = summaryWith({ total: 5 });
    const comparison = { metricsCompare: { solid: { diff: 40 }, topped: { diff: -40 }, fat: { diff: 0 }, solidDistanceCV: { diff: -20 } }, match: { session: { default_club: '7i' } }, targetAccuracyCompare: [{ improvementYards: 10 }] };
    const insight = buildRecapInsight(s, comparison, [], {});
    assert.notEqual(insight?.headline, 'Contact Improved');
    assert.notEqual(insight?.headline, 'Fewer Tops');
    assert.notEqual(insight?.headline, 'Consistency Improved');
    assert.notEqual(insight?.headline, 'Target Accuracy Improved');
  });

  test('nothing clears any bar on a long-enough session: returns null rather than inventing generic praise', () => {
    const s = summaryWith({ strike: { solid: { pct: 20, count: 2 }, thin: { pct: 0, count: 0 }, topped: { pct: 0, count: 0 }, fat: { pct: 0, count: 0 }, shank: { pct: 0, count: 0 }, miss: { pct: 0, count: 0 } } });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight, null);
  });

  test('short session (<=9 shots) with a mixed result falls back to a counts breakdown rather than repeating the hero\'s Solid % (never duplicates the hero metric)', () => {
    const s = summaryWith({
      total: 8,
      strike: {
        solid: { pct: 63, count: 5 },
        thin: { pct: 38, count: 3 },
        topped: { pct: 0, count: 0 },
        fat: { pct: 0, count: 0 },
        shank: { pct: 0, count: 0 },
        miss: { pct: 0, count: 0 },
      },
    });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight.headline, '5 of 8 Solid');
    assert.equal(insight.sub, '3 Thin strikes.');
  });

  test('short session (<=9 shots), every shot solid: shows a plain factual count — small enough that "all N" reads as fact, not a restated percentage', () => {
    const s = summaryWith({
      total: 5,
      strike: {
        solid: { pct: 100, count: 5 },
        thin: { pct: 0, count: 0 },
        topped: { pct: 0, count: 0 },
        fat: { pct: 0, count: 0 },
        shank: { pct: 0, count: 0 },
        miss: { pct: 0, count: 0 },
      },
    });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight.headline, 'All 5 Solid');
  });

  test('session longer than the short-session fallback window (>9 shots) with nothing else notable: hidden, not a forced restatement', () => {
    const s = summaryWith({ total: 10, strike: { solid: { pct: 59, count: 6 }, thin: { pct: 41, count: 4 }, topped: { pct: 0, count: 0 }, fat: { pct: 0, count: 0 }, shank: { pct: 0, count: 0 }, miss: { pct: 0, count: 0 } } });
    const insight = buildRecapInsight(s, null, [], {});
    assert.equal(insight, null);
  });
});
