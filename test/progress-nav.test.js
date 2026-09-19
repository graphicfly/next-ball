import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// V4.3 navigation: Progress replaces Trends in the global nav.
//
// The risk this guards is specific and stated in the brief: Trends must not
// be deleted or rewritten, only relocated. A regression here would look
// like a working app with a feature quietly missing.

const read = (f) => fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');

describe('Global navigation is Home · Progress · History · Settings', () => {
  const ui = read('ui.js');

  test('the four tabs are exactly those, in that order', () => {
    const block = ui.match(/const NAV_ITEMS = \[([\s\S]*?)\];/)[1];
    const hashes = [...block.matchAll(/hash: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(hashes, ['#/home', '#/progress', '#/history', '#/settings']);
  });

  test('Trends is no longer a tab', () => {
    const block = ui.match(/const NAV_ITEMS = \[([\s\S]*?)\];/)[1];
    assert.ok(!block.includes("'#/trends'"), 'Trends must not be a nav tab');
  });

  test('Progress and Trends both keep the bottom nav', () => {
    // A golfer inside Trends has not left the Progress area, so the nav
    // stays rather than treating it as a single-task screen.
    const routes = ui.match(/const NAV_ROUTES = new Set\(\[([\s\S]*?)\]\)/)[1];
    assert.ok(routes.includes("'#/progress'"));
    assert.ok(routes.includes("'#/trends'"));
  });
});

describe('Trends survives the move', () => {
  test('its screen module still exists and still exports renderTrends', () => {
    const trends = read('screens/trends.js');
    assert.match(trends, /export function renderTrends/);
    // The substance, not just the export: its filters and chart are intact.
    assert.match(trends, /sessionTrendPoint/);
  });

  test('its route is unchanged', () => {
    assert.match(read('app.js'), /#\\\/trends\$\/, render: \(\) => renderTrends\(root\)/);
  });

  test('it returns to Progress rather than Home', () => {
    assert.match(read('screens/trends.js'), /location\.hash = '#\/progress'/);
  });
});

describe('Progress is a container, not a rewrite', () => {
  const progress = read('screens/progress.js');

  test('it routes to Trends, Swing Lab and Development', () => {
    assert.match(progress, /#\/trends/);
    assert.match(progress, /#\/swing-lab/);
    assert.match(progress, /developmentRow/);
  });

  test('Development is disabled rather than pretending to open', () => {
    // It depends on V4.1's confidence machinery, which is specified and
    // not built. Showing it honestly beats hiding the shape of Progress.
    assert.match(progress, /setAttribute\('disabled'/);
  });

  test('it computes nothing analytical of its own', () => {
    // Progress must not grow a second analytics implementation beside
    // stats.js — it lists destinations and counts records.
    assert.ok(!progress.includes('grooveScore'), 'no analytics in the container');
    assert.ok(!progress.includes('sessionSummary'), 'no analytics in the container');
  });
});
