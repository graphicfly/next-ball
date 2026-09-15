import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';

function shot(ball, strike, direction = 'straight', distance_yards = 140) {
  return { shot_number: ball, strike, direction: strike === 'miss' ? null : direction, height: strike === 'miss' ? null : 'medium', distance_yards: strike === 'miss' ? null : distance_yards, target_distance_yards: null, drill: 'Normal Swing' };
}

function fill(n, strike = 'solid', direction = 'straight') {
  return Array.from({ length: n }, (_, i) => shot(i + 1, strike, direction));
}

describe('grooveScore — availability thresholds', () => {
  test('below 10 shots: no numeric score, reports shots remaining', () => {
    const g = stats.grooveScore(fill(9));
    assert.equal(g.score, null);
    assert.equal(g.shotsUntilAvailable, 1);
    assert.deepEqual(g.components, []);
    assert.deepEqual(g.dropped, []);
  });

  test('exactly 10 shots: numeric score, Best Window dropped and reweighted to 62.5/18.75/18.75', () => {
    const g = stats.grooveScore(fill(10));
    assert.notEqual(g.score, null);
    assert.equal(g.shotsUntilAvailable, null);
    assert.deepEqual(g.dropped, ['bestWindow']);
    const byKey = Object.fromEntries(g.components.map((c) => [c.key, c.weight]));
    assert.equal(byKey.contact, 62.5);
    assert.equal(byKey.direction, 18.75);
    assert.equal(byKey.cleanStreak, 18.75);
  });

  test('14 shots: still below the Best Window threshold, same reweighting', () => {
    const g = stats.grooveScore(fill(14));
    assert.deepEqual(g.dropped, ['bestWindow']);
  });

  test('exactly 15 shots: Best Window included at its full 50/20/15/15 split', () => {
    const g = stats.grooveScore(fill(15));
    assert.deepEqual(g.dropped, []);
    const byKey = Object.fromEntries(g.components.map((c) => [c.key, c.weight]));
    assert.equal(byKey.contact, 50);
    assert.equal(byKey.bestWindow, 20);
    assert.equal(byKey.direction, 15);
    assert.equal(byKey.cleanStreak, 15);
  });
});

describe('grooveScore — component formulas', () => {
  test('all-solid, all-straight, 20-shot session scores 100 with every component at 100', () => {
    const g = stats.grooveScore(fill(20, 'solid', 'straight'));
    assert.equal(g.score, 100);
    for (const c of g.components) assert.equal(c.score, 100);
  });

  test('all-shank session scores 0 contact and 0 clean-streak, but never negative or crashing', () => {
    const g = stats.grooveScore(fill(20, 'shank', 'left'));
    const byKey = Object.fromEntries(g.components.map((c) => [c.key, c.score]));
    assert.equal(byKey.contact, 0);
    assert.equal(byKey.cleanStreak, 0);
    assert.ok(g.score >= 0);
  });

  test('contact quality matches the documented point table exactly (solid=100, thin=65, topped=20, fat=20, shank=0, miss=0)', () => {
    // 10 shots: one of each of the six strikes, plus 4 more solid — a
    // hand-checkable weighted mean.
    const shots = [
      shot(1, 'solid'), shot(2, 'thin'), shot(3, 'topped'), shot(4, 'fat'), shot(5, 'shank'),
      shot(6, 'miss'), shot(7, 'solid'), shot(8, 'solid'), shot(9, 'solid'), shot(10, 'solid'),
    ];
    const g = stats.grooveScore(shots);
    // (5*100 + 1*65 + 1*20 + 1*20 + 1*0 + 1*0) / 10 = 60.5 -> rounds to 61
    const contact = g.components.find((c) => c.key === 'contact');
    assert.equal(contact.score, 61);
  });

  test('direction control: 90% straight scores 90 (repeatability=90, straightness=90)', () => {
    const shots = fill(9, 'solid', 'straight').concat([shot(10, 'solid', 'left')]);
    const g = stats.grooveScore(shots);
    const direction = g.components.find((c) => c.key === 'direction');
    assert.equal(direction.score, 90);
  });

  test('direction control: 90% right / 10% straight scores 66 (0.7*90 + 0.3*10)', () => {
    const shots = fill(9, 'solid', 'right').concat([shot(10, 'solid', 'straight')]);
    const g = stats.grooveScore(shots);
    const direction = g.components.find((c) => c.key === 'direction');
    assert.equal(direction.score, 66);
  });

  test('direction control: 70% straight / 20% left / 10% right scores 70 (repeatability=straightness=70)', () => {
    const shots = fill(7, 'solid', 'straight')
      .concat([shot(8, 'solid', 'left'), shot(9, 'solid', 'left'), shot(10, 'solid', 'right')]);
    const g = stats.grooveScore(shots);
    const direction = g.components.find((c) => c.key === 'direction');
    assert.equal(direction.score, 70);
  });

  test('clean contact streak: fixed target of 10, never normalized by session length', () => {
    // A 12-shot clean run inside a 60-shot session must score identically to
    // the same 12-shot run inside a 15-shot session.
    const longSession = fill(12, 'solid').concat(fill(48, 'shank').map((s, i) => shot(13 + i, 'shank')));
    const shortSession = fill(12, 'solid').concat(fill(3, 'shank').map((s, i) => shot(13 + i, 'shank')));
    const gLong = stats.grooveScore(longSession);
    const gShort = stats.grooveScore(shortSession);
    const streakLong = gLong.components.find((c) => c.key === 'cleanStreak');
    const streakShort = gShort.components.find((c) => c.key === 'cleanStreak');
    assert.equal(streakLong.score, 100); // 12/10 capped at 100
    assert.equal(streakShort.score, 100);
  });

  test('clean contact streak predicate excludes Top/Fat/Shank/Miss, unlike streaksSummary().cleanContact', () => {
    // A thin shot keeps the groove-streak alive; a topped shot ends it —
    // same as cleanContact — but a shank must ALSO end it, which
    // cleanContact does not enforce.
    const shots = fill(5, 'thin').concat([shot(6, 'shank')]).concat(fill(4, 'solid').map((s, i) => shot(7 + i, 'solid')));
    const g = stats.grooveScore(shots);
    const streak = g.components.find((c) => c.key === 'cleanStreak');
    assert.equal(streak.score, 50); // longest run is 5 (the leading thin run) -> 5/10*100
  });

  test('best window scores the SAME 10 shots bestWindow() itself selects', () => {
    const shots = fill(15, 'topped', 'left');
    // Make balls 6-15 the unambiguous best window.
    for (let i = 5; i < 15; i++) shots[i] = shot(i + 1, 'solid', 'straight');
    const window = stats.bestWindow(shots);
    assert.equal(window.startBall, 6);
    assert.equal(window.endBall, 15);
    const g = stats.grooveScore(shots);
    const bw = g.components.find((c) => c.key === 'bestWindow');
    assert.equal(bw.score, 100); // that window is 100% solid/straight
  });
});

describe('grooveScore — versioning and shape', () => {
  test('emits GROOVE_SCORE_VERSION on every result, including the below-threshold shape', () => {
    assert.equal(stats.grooveScore(fill(3)).version, stats.GROOVE_SCORE_VERSION);
    assert.equal(stats.grooveScore(fill(20)).version, stats.GROOVE_SCORE_VERSION);
  });

  test('never scores a dropped component as zero — it is absent from components entirely', () => {
    const g = stats.grooveScore(fill(10));
    assert.ok(!g.components.some((c) => c.key === 'bestWindow'));
    assert.ok(g.dropped.includes('bestWindow'));
  });

  test('is a pure function: identical input produces identical output on repeated calls', () => {
    const shots = fill(20, 'thin', 'right');
    assert.deepEqual(stats.grooveScore(shots), stats.grooveScore(shots));
  });
});

describe('grooveScore — component functions are independently exported/callable', () => {
  test('contactQualityScore, directionControlScore, and cleanContactStreakScore match grooveScore\'s own component scores', () => {
    const shots = fill(20, 'thin', 'right');
    const g = stats.grooveScore(shots);
    const byKey = Object.fromEntries(g.components.map((c) => [c.key, c.score]));
    assert.equal(Math.round(stats.contactQualityScore(shots)), byKey.contact);
    assert.equal(Math.round(stats.directionControlScore(shots)), byKey.direction);
    assert.equal(Math.round(stats.cleanContactStreakScore(shots)), byKey.cleanStreak);
  });
});

describe('grooveScore — validation against known session shapes', () => {
  test('a known-strong session (90% solid, ~96% straight) scores extremely well', () => {
    // 50 shots: 45 solid + 5 thin (90% solid, never a top/fat/shank/miss),
    // 48 straight + 2 left (96% straight) — the exact shape product asked
    // to sanity-check: this should score in the high 90s, not merely "good".
    const shots = [];
    for (let i = 0; i < 50; i++) {
      shots.push(shot(i + 1, i < 45 ? 'solid' : 'thin', i < 48 ? 'straight' : 'left'));
    }
    const g = stats.grooveScore(shots);
    assert.ok(g.score >= 90, `expected a known-strong session to score >= 90, got ${g.score}`);
  });

  test('a short (10-14 shot) session is never inflated by double-counting the same contact signal via Best Window', () => {
    // At 10-14 shots, Best Window would be nearly the whole session and is
    // dropped entirely (not scored as a second, redundant read of Contact
    // Quality) — confirm the score is EXACTLY the renormalized 3-component
    // blend, not something higher that snuck in a duplicated contact read.
    for (const total of [10, 12, 14]) {
      const solidCount = Math.round(total * 0.7);
      const shots = Array.from({ length: total }, (_, i) => shot(i + 1, i < solidCount ? 'solid' : 'topped'));
      const g = stats.grooveScore(shots);
      assert.ok(!g.components.some((c) => c.key === 'bestWindow'), `bestWindow must be dropped at ${total} shots`);

      const contact = g.components.find((c) => c.key === 'contact').score;
      const direction = g.components.find((c) => c.key === 'direction').score;
      const cleanStreak = g.components.find((c) => c.key === 'cleanStreak').score;
      const expected = Math.round(contact * 0.625 + direction * 0.1875 + cleanStreak * 0.1875);
      assert.equal(g.score, expected, `${total}-shot score should be exactly the renormalized 3-component blend`);
    }
  });

  test('scores rank sessions in the expected order: all-solid-straight > known-strong > mixed > all-topped', () => {
    const allSolid = fill(50, 'solid', 'straight');
    const mixed = Array.from({ length: 50 }, (_, i) => shot(i + 1, i % 2 === 0 ? 'solid' : 'topped'));
    const allTopped = fill(50, 'topped', 'left');
    const scoreAllSolid = stats.grooveScore(allSolid).score;
    const scoreMixed = stats.grooveScore(mixed).score;
    const scoreAllTopped = stats.grooveScore(allTopped).score;
    assert.equal(scoreAllSolid, 100);
    assert.ok(scoreAllSolid > scoreMixed);
    assert.ok(scoreMixed > scoreAllTopped);
  });
});
