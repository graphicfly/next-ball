import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../js/stats.js';
import { shotTimelineHtml, timelineLegendHtml, recapBestStretchHtml } from '../js/summarySections.js';

// Regression coverage for the short-session bug: the shot map generated
// exactly the right markers all along (the bug was that .scroll clipped
// them below the fold for short sessions), but this locks in the adaptive
// tiers added while fixing it so a future change can't silently start
// omitting markers again.
function shot(ball, strike, direction = 'straight', distance_yards = 140) {
  return {
    shot_id: `shot-${ball}`,
    shot_number: ball,
    strike,
    direction: strike === 'miss' ? null : direction,
    height: strike === 'miss' ? null : 'medium',
    distance_yards: strike === 'miss' ? null : distance_yards,
  };
}

function fill(n, strike = 'solid') {
  return Array.from({ length: n }, (_, i) => shot(i + 1, strike));
}

function markerCount(html) {
  // Match the cell buttons specifically, not the "tm-cell-number" label
  // span the lg tier also prints inside each one.
  const matches = html.match(/<button class="tm-cell/g);
  return matches ? matches.length : 0;
}

describe('Shot map — marker count always equals shot count', () => {
  for (const n of [1, 3, 5, 9, 10, 11, 20, 43, 50, 60]) {
    test(`${n} shot${n === 1 ? '' : 's'}: exactly ${n} markers render, never fewer`, () => {
      const shots = fill(n);
      const html = shotTimelineHtml(shots, stats.bestWindow(shots));
      assert.equal(markerCount(html), n);
      // every shot's own id is present — nobody was silently dropped or
      // deduplicated by the row-chunking logic
      for (const s of shots) assert.ok(html.includes(`data-shot-id="${s.shot_id}"`));
    });
  }

  test('0 shots: renders nothing (not an empty grid)', () => {
    assert.equal(shotTimelineHtml([], null), '');
  });
});

describe('Shot map — adaptive size tiers', () => {
  test('1-5 shots use the lg tier, single row, numbered underneath each marker', () => {
    const shots = fill(3);
    const html = shotTimelineHtml(shots, null);
    assert.match(html, /shot-map-row lg/);
    assert.match(html, /shot-map-grid lg/);
    // ball numbers 1, 2, 3 each appear as a printed label
    for (const n of [1, 2, 3]) assert.match(html, new RegExp(`<span class="tm-cell-number"[^>]*>${n}</span>`));
    // no row range label — a single short row doesn't need "1–3"
    assert.doesNotMatch(html, /shot-map-row-label/);
  });

  test('6-10 shots use the mdlg tier and let CSS (auto-fit), not JS, decide wrapping', () => {
    const html = shotTimelineHtml(fill(9), null);
    assert.match(html, /shot-map-row mdlg/);
    assert.match(html, /shot-map-grid mdlg/);
    // JS must not hardcode a column-count grid-template for mdlg — that's
    // what let a fixed single row overflow narrow phones; the CSS class
    // (auto-fit/minmax) is what should own wrapping.
    assert.doesNotMatch(html, /grid-template-columns/);
    assert.doesNotMatch(html, /tm-cell-number/); // no numbers at this tier
  });

  test('exactly 10 shots is still the mdlg (single/wrap) tier, not the 11-20 compact grid', () => {
    const html = shotTimelineHtml(fill(10), null);
    assert.match(html, /shot-map-row mdlg/);
  });

  test('11-20 shots use the compact md tier with a fixed 10-column grid', () => {
    const html = shotTimelineHtml(fill(11), null);
    assert.match(html, /shot-map-row md/);
    assert.match(html, /grid-template-columns:repeat\(10,/);
    assert.match(html, /shot-map-row-label/); // 2 rows now, so a range label appears
  });

  test('21+ shots use the sm tier — unchanged from the original 50-shot design', () => {
    const html = shotTimelineHtml(fill(50), null);
    assert.match(html, /shot-map-row sm/);
    assert.match(html, /grid-template-columns:repeat\(10,/);
  });

  test('50 shots lay out as 5 full rows of 10 (5×10), matching the original design exactly', () => {
    const html = shotTimelineHtml(fill(50), null);
    assert.equal((html.match(/shot-map-row sm/g) || []).length, 5);
    assert.equal(markerCount(html), 50);
  });

  test('43 shots: 4 full rows of 10 plus a final row of 3, no placeholder markers for the missing 7', () => {
    const html = shotTimelineHtml(fill(43), null);
    assert.equal(markerCount(html), 43);
    assert.match(html, /41&ndash;43/); // final short row's range label
  });

  test('11 shots: no marker jump or disappearance across the short→compact boundary vs. 10 shots', () => {
    const at10 = shotTimelineHtml(fill(10), null);
    const at11 = shotTimelineHtml(fill(11), null);
    assert.equal(markerCount(at10), 10);
    assert.equal(markerCount(at11), 11);
  });
});

describe('Shot map — chronological order preserved regardless of input order', () => {
  test('shots passed out of order are still rendered in shot_number order', () => {
    const shots = [shot(3, 'solid'), shot(1, 'solid'), shot(2, 'thin')];
    const html = shotTimelineHtml(shots, null);
    const order = [...html.matchAll(/data-shot-id="shot-(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(order, [1, 2, 3]);
  });
});

describe('Legend — conditional on strike types actually present', () => {
  test('only Solid and Thin present: legend lists exactly those two, nothing else', () => {
    const shots = [shot(1, 'solid'), shot(2, 'solid'), shot(3, 'thin')];
    const html = timelineLegendHtml(shots);
    assert.match(html, /Solid/);
    assert.match(html, /Thin/);
    for (const label of ['Topped', 'Fat', 'Shank', 'Miss']) assert.doesNotMatch(html, new RegExp(label));
  });

  test('every strike type present: legend lists all six', () => {
    const shots = ['solid', 'thin', 'topped', 'fat', 'shank', 'miss'].map((strike, i) => shot(i + 1, strike));
    const html = timelineLegendHtml(shots);
    for (const label of ['Solid', 'Thin', 'Topped', 'Fat', 'Shank', 'Miss']) assert.match(html, new RegExp(label));
  });

  test('no shots: no legend at all', () => {
    assert.equal(timelineLegendHtml([]), '');
  });
});

describe('Best Stretch / Best 10 — only appears at 10+ shots', () => {
  test('9 shots: bestWindow is null, and the card renders nothing (no empty placeholder)', () => {
    const shots = fill(9);
    assert.equal(stats.bestWindow(shots), null);
    assert.equal(recapBestStretchHtml(stats.bestWindow(shots)), '');
  });

  test('exactly 10 shots: bestWindow exists using the existing rolling-10 logic, card renders', () => {
    const shots = fill(10);
    const window = stats.bestWindow(shots);
    assert.ok(window);
    assert.match(recapBestStretchHtml(window), /Best Stretch/);
  });

  test('50 shots: Best 10 highlight still resolves to a real window (existing logic untouched)', () => {
    const shots = fill(50);
    const window = stats.bestWindow(shots);
    assert.ok(window);
    const html = shotTimelineHtml(shots, window);
    assert.match(html, /tm-cell best/);
  });
});
