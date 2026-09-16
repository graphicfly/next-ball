import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundTotals, strokeBreakdown, clubAssociations, positiveMoment,
  practiceFocus, formatToPar, MIN_HOLES_FOR_PLAN,
} from '../js/roundAnalysis.js';

// Round Summary analytics — docs/course-mode-spec.md §4.5 (the summary),
// §7 (practice plans) and above all §7.4, the honesty rule: every sentence
// produced must be traceable to a field Course Mode actually records.

const STANDARD_9_PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4]; // par 35

// Builds a synthetic round's holes. Every value here is one of §6's fields.
function makeHoles({ pars = STANDARD_9_PARS, strokes, putts = [], shortGame = [], clubs = [] }) {
  return strokes.map((s, i) => ({
    hole_number: i + 1,
    par: pars[i] ?? null,
    yardage: null,
    strokes: s,
    clubs_used: clubs[i] ?? [],
    short_game_strokes: shortGame[i] ?? 0,
    putts: putts[i] ?? 0,
  }));
}

const ROUND = { round_id: 'r1', course_id: 'c1', course_name: 'Oakmont Golf Center' };

describe('Score and par math', () => {
  test('totals match a hand-computed round', async () => {
    // Pars 4+4+3+4+5+4+3+4+4 = 35. Strokes 5+5+4+5+6+5+4+5+5 = 44. +9.
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] });
    const t = roundTotals(holes);

    assert.equal(t.holesPlayed, 9);
    assert.equal(t.par, 35);
    assert.equal(t.strokes, 44);
    assert.equal(t.toPar, 9);
    assert.equal(t.putts, 18);
    assert.equal(t.shortGame, 0);
    assert.equal(t.fullSwings, 26); // 44 - 18 putts - 0 greenside
  });

  test('score to par covers only the holes played', async () => {
    // Seven holes of an 18: pars 4+4+3+4+5+4+3 = 27, strokes 27 -> even.
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3], putts: [2, 2, 2, 2, 2, 2, 2] });
    const t = roundTotals(holes);
    assert.equal(t.par, 27);
    assert.equal(t.strokes, 27);
    assert.equal(t.toPar, 0);
  });

  test('a round under par reports a negative score to par', async () => {
    const holes = makeHoles({ strokes: [3, 4, 3, 4, 4, 4, 3, 4, 4] }); // 33 vs 35
    assert.equal(roundTotals(holes).toPar, -2);
  });

  test('formatToPar reads the way a scorecard does', async () => {
    assert.equal(formatToPar(0), 'even');
    assert.equal(formatToPar(10), '+10');
    assert.equal(formatToPar(-2), '-2');
  });

  test('a hole with no par does not corrupt the totals', async () => {
    const holes = makeHoles({ pars: [4, null, 3], strokes: [5, 6, 4] });
    const t = roundTotals(holes);
    assert.equal(t.strokes, 15);
    assert.equal(t.par, 7);       // only the holes carrying a par
    assert.equal(t.hasPar, false); // so score-to-par is not claimed
  });
});

describe('Stroke decomposition', () => {
  // The three buckets must always sum back to score-to-par, so no stroke is
  // ever double-counted or invented.
  const cases = [
    { name: 'putting-heavy', strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3], shortGame: [] },
    { name: 'greenside-heavy', strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2], shortGame: [2, 1, 1, 2, 1, 1, 0, 1, 0] },
    { name: 'full-swing-heavy', strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2], shortGame: [] },
    { name: 'level par', strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2], shortGame: [] },
    { name: 'under par', strokes: [3, 4, 3, 4, 4, 4, 3, 4, 4], putts: [1, 2, 2, 2, 2, 2, 1, 2, 2], shortGame: [] },
    { name: 'inconsistent hole (§5.4)', strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2], shortGame: [2, 2, 2, 0, 0, 0, 0, 0, 0] },
  ];

  for (const c of cases) {
    test(`buckets sum to score to par — ${c.name}`, async () => {
      const holes = makeHoles(c);
      const b = strokeBreakdown(holes);
      assert.equal(b.puttsOver + b.shortGameOver + b.fullSwingOver, b.toPar);
    });
  }

  test('a hand-computed putting round attributes 7 of its 9 strokes to putts', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] });
    const b = strokeBreakdown(holes);
    assert.equal(b.toPar, 9);
    assert.equal(b.putts, 25);
    assert.equal(b.puttsOver, 7);      // 25 putts against a baseline of 18
    assert.equal(b.shortGameOver, 0);
    assert.equal(b.fullSwingOver, 2);  // 19 swings against a baseline of 17
  });
});

describe('Positive moment — one, and only when true', () => {
  test('a new best at this course', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 5] }); // +1
    const prior = [{ course_id: 'c1', holesPlayed: 9, toPar: 9, hasPar: true }];

    const m = positiveMoment(ROUND, holes, prior);
    assert.equal(m.headline, 'New best here');
    assert.match(m.detail, /Oakmont Golf Center/);
  });

  test('a worse round at the same course is NOT called a new best', async () => {
    const holes = makeHoles({ strokes: [6, 6, 5, 6, 7, 6, 5, 6, 6] }); // +18
    const prior = [{ course_id: 'c1', holesPlayed: 9, toPar: 2, hasPar: true }];

    const m = positiveMoment(ROUND, holes, prior);
    assert.notEqual(m.headline, 'New best here');
  });

  test('rounds over a different number of holes are not comparable', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 5] });
    const prior = [{ course_id: 'c1', holesPlayed: 18, toPar: 1, hasPar: true }];

    // An 18-hole round is not a yardstick for a 9.
    const m = positiveMoment(ROUND, holes, prior);
    assert.notEqual(m.headline, 'New best here');
  });

  test('best across recent rounds needs at least three to compare with', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 5] }); // +1
    const prior = [
      { course_id: 'other1', holesPlayed: 9, toPar: 5, hasPar: true },
      { course_id: 'other2', holesPlayed: 9, toPar: 8, hasPar: true },
      { course_id: 'other3', holesPlayed: 9, toPar: 6, hasPar: true },
    ];

    const m = positiveMoment(ROUND, holes, prior);
    assert.equal(m.headline, 'Best in a while');
    assert.match(m.detail, /last 3 rounds/);
  });

  test('a genuinely strong finish is called out with its real number', async () => {
    // First six average +2 per hole; last three are level.
    const holes = makeHoles({ strokes: [6, 6, 5, 6, 7, 6, 3, 4, 4] });
    const m = positiveMoment(ROUND, holes, []);
    assert.equal(m.headline, 'Nice finish!');
    assert.equal(m.detail, 'You played the last 3 holes in even.');
  });

  test('a finish WORSE than the rest of the round is never called a nice finish', async () => {
    // The last three are the worst holes of the day.
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 6, 7, 7] });
    const m = positiveMoment(ROUND, holes, []);
    assert.notEqual(m.headline, 'Nice finish!');
  });

  test('pars or better are counted exactly', async () => {
    // Level on holes 3 and 7, over everywhere else, and a poor finish so
    // the finish rule cannot fire.
    const holes = makeHoles({ strokes: [5, 5, 3, 5, 6, 5, 3, 6, 6] });
    const m = positiveMoment(ROUND, holes, []);
    assert.equal(m.headline, '2 pars or better');
    assert.match(m.detail, /2 holes/);
  });

  test('with nothing noteworthy it states a plain fact rather than praise', async () => {
    // Over par on every hole, and the finish is the worst stretch.
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 5, 7, 7] });
    const m = positiveMoment(ROUND, holes, []);
    assert.equal(m.headline, 'Round complete');
    assert.equal(m.detail, '9 holes played at Oakmont Golf Center.');
  });

  test('there is always exactly one moment, never a stack', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4] });
    const m = positiveMoment(ROUND, holes, []);
    assert.equal(typeof m.headline, 'string');
    assert.equal(typeof m.detail, 'string');
    assert.deepEqual(Object.keys(m).sort(), ['detail', 'headline']);
  });
});

describe('Practice recommendation — synthetic rounds', () => {
  test('a putting round recommends putting, citing three-putts', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] });
    const f = practiceFocus(ROUND, holes);

    assert.equal(f.signal, 'putting');
    assert.equal(f.focus_title, 'Sharpen your putting');
    assert.equal(f.focus_rationale, 'You had 7 three-putt holes today.');
    assert.ok(f.steps.length >= 2 && f.steps.length <= 4);
  });

  test('a greenside round recommends short game', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      putts: [2, 2, 2, 2, 2, 2, 2, 2, 2],
      shortGame: [2, 1, 1, 2, 1, 1, 0, 1, 0],
    });
    const f = practiceFocus(ROUND, holes);

    assert.equal(f.signal, 'short_game');
    assert.equal(f.focus_title, 'Sharpen short game');
    assert.equal(f.focus_rationale, 'Extra shots around the green added strokes today.');
  });

  test('a full-swing round with no club pattern recommends ball striking', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] });
    const f = practiceFocus(ROUND, holes);

    assert.equal(f.signal, 'full_swing');
    assert.equal(f.focus_title, 'Tighten your ball striking');
  });

  test('a club on clearly worse holes is named — but only as "appeared on"', async () => {
    const holes = makeHoles({
      strokes: [7, 7, 6, 4, 5, 4, 3, 4, 4],
      putts: [2, 2, 2, 2, 2, 2, 2, 2, 2],
      clubs: [['9i'], ['9i'], ['9i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
    });
    const f = practiceFocus(ROUND, holes);

    assert.equal(f.signal, 'club');
    assert.equal(f.club, '9i');
    assert.equal(f.focus_rationale, 'Your 9i appeared on several of your higher-scoring holes.');
    // §7.4 — nothing may claim direction, contact, or per-shot attribution.
    assert.doesNotMatch(f.focus_rationale, /left|right|missed|thin|fat|topped|lost \d+ strokes/i);
  });

  test('a club appearing on only one hole is not a pattern', async () => {
    const holes = makeHoles({
      strokes: [8, 5, 4, 5, 6, 5, 4, 5, 5],
      putts: [2, 2, 2, 2, 2, 2, 2, 2, 2],
      clubs: [['3W'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
    });
    const f = practiceFocus(ROUND, holes);
    assert.notEqual(f.club, '3W');
  });

  test('three-putts win even when the round was otherwise level', async () => {
    // Level par overall, but putting is still visibly costing shots.
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4], putts: [3, 3, 2, 3, 1, 1, 1, 1, 1] });
    const f = practiceFocus(ROUND, holes);
    assert.equal(f.signal, 'putting');
  });

  test('a level round with nothing wrong gets a maintenance focus, not an invented fault', async () => {
    const holes = makeHoles({ strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] });
    const f = practiceFocus(ROUND, holes);

    assert.equal(f.signal, 'maintenance');
    assert.match(f.focus_rationale, /held up/);
  });

  test('every focus carries a goal and countable steps', async () => {
    const rounds = [
      { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [3, 3, 2, 3, 3, 3, 2, 3, 3] },
      { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2], shortGame: [2, 1, 1, 2, 1, 1, 0, 1, 0] },
      { strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] },
      { strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4], putts: [2, 2, 2, 2, 2, 2, 2, 2, 2] },
    ];
    for (const r of rounds) {
      const f = practiceFocus(ROUND, makeHoles(r));
      assert.ok(f.focus_title && f.focus_rationale && f.goal_text);
      assert.ok(f.steps.length >= 2 && f.steps.length <= 4);
      for (const s of f.steps) {
        assert.ok(s.order && s.title && s.detail);
        // Each step names something countable (§4.6).
        assert.ok(s.ball_count != null || s.challenge_count != null || /\d/.test(s.detail));
      }
    }
  });

  test('too few holes produces no plan, so the card is omitted rather than padded', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5] }); // 4 holes
    assert.ok(holes.length < MIN_HOLES_FOR_PLAN);
    assert.equal(practiceFocus(ROUND, holes), null);
  });

  test('a round with no par at all produces no plan', async () => {
    const holes = makeHoles({ pars: [null, null, null, null, null], strokes: [5, 5, 4, 5, 6] });
    assert.equal(practiceFocus(ROUND, holes), null);
  });

  test('an inconsistent hole never produces a negative derived value', async () => {
    // §5.4 — short game + putts exceed strokes; analytics must tolerate it.
    const holes = makeHoles({
      strokes: [4, 4, 3, 4, 5, 4, 3, 4, 4],
      putts: [2, 2, 2, 2, 2, 2, 2, 2, 2],
      shortGame: [3, 3, 3, 0, 0, 0, 0, 0, 0],
    });
    const b = strokeBreakdown(holes);
    assert.ok(b.fullSwings >= 0);
    const f = practiceFocus(ROUND, holes);
    assert.ok(f.focus_title);
  });
});

describe('Club associations', () => {
  test('reports how holes with a club scored against holes without it', async () => {
    // Holes 1-2 (the 9i holes) are three over; every other hole is level.
    const holes = makeHoles({
      strokes: [7, 7, 3, 4, 5, 4, 3, 4, 4],
      clubs: [['9i'], ['9i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i'], ['7i']],
    });
    const [top] = clubAssociations(holes);
    assert.equal(top.club, '9i');
    assert.equal(top.holeCount, 2);
    assert.equal(top.avgToPar, 3); // both holes three over
    assert.equal(top.margin, 3);   // versus level on the rest
  });

  test('a club used on every hole yields no comparison', async () => {
    const holes = makeHoles({
      strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5],
      clubs: Array(9).fill(['7i']),
    });
    assert.deepEqual(clubAssociations(holes), []);
  });

  test('holes with no clubs recorded are simply absent from the comparison', async () => {
    const holes = makeHoles({ strokes: [5, 5, 4, 5, 6, 5, 4, 5, 5] });
    assert.deepEqual(clubAssociations(holes), []);
  });
});
