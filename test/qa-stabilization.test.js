import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';

const CSS = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const CANVAS = fs.readFileSync(new URL('../js/screens/practiceCanvas.js', import.meta.url), 'utf8');
const CHIP = fs.readFileSync(new URL('../js/screens/chippingSession.js', import.meta.url), 'utf8');
const HISTORY = fs.readFileSync(new URL('../js/screens/history.js', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

function block(css, selector) {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `${selector} not found`);
  return css.slice(i, css.indexOf('}', i));
}

describe('History filters stay reachable as modes are added', () => {
  test('the filter row wraps instead of scrolling out of sight', () => {
    // Four chips fitted one row. Chipping and Putting made six, which pushed
    // Rounds and Lessons off a 375px screen with nothing on screen to say
    // they were there.
    const b = block(CSS, '.history-filters');
    assert.match(b, /flex-wrap:\s*wrap/);
    assert.ok(!/overflow-x:\s*auto/.test(b), 'a scroller you cannot see the end of hides its contents');
  });

  test('every mode has a chip', () => {
    for (const label of ['Range', 'Chipping', 'Putting', 'Rounds', 'Lessons']) {
      assert.ok(HISTORY.includes(`label: '${label}'`), `${label} filter missing`);
    }
  });
});

describe('Focus is visible wherever it can land', () => {
  test('there is a global focus-visible ring, not just per-component ones', () => {
    assert.match(CSS, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--color-accent\)/);
  });

  test('tap targets clear 44px', () => {
    for (const sel of ['.filter-chip', '.mini-toggle', '.practice-secondary']) {
      const m = block(CSS, sel).match(/min-height:\s*(\d+)px/);
      assert.ok(m && Number(m[1]) >= 44, `${sel} was ${m && m[1]}px`);
    }
  });
});

describe('The chipping rings are operable without a mouse', () => {
  test('each ring is a focusable, named control', () => {
    // An SVG circle is not a button and takes no keyboard activation of its
    // own, and the rings are the primary interaction of the whole screen.
    assert.match(CANVAS, /role="button" tabindex="0" aria-label=/);
  });

  test('Enter and Space activate a ring', () => {
    assert.match(CHIP, /keydown[\s\S]{0,200}e\.key !== 'Enter' && e\.key !== ' '/);
  });
});

describe('The service worker cannot silently fail to install', () => {
  test('every precached path is a file that exists', () => {
    const list = SW.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/)[1];
    const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(urls.length > 50, 'the precache list looks truncated');
    const missing = urls
      .filter((u) => !/^https?:/.test(u) && u !== './')
      .map((u) => u.replace(/^\.\//, ''))
      .filter((rel) => !fs.existsSync(new URL(`../${rel}`, import.meta.url)));
    // cache.addAll rejects wholesale on a single 404, which leaves the app
    // with no service worker and no offline shell at all.
    assert.deepEqual(missing, [], 'precached files that do not exist');
  });

  test('the cache name tracks the build version', () => {
    const v = fs.readFileSync(new URL('../js/version.js', import.meta.url), 'utf8').match(/BUILD_VERSION = '([^']+)'/)[1];
    assert.ok(SW.includes(`nextball-${v}`), `service worker cache is not ${v}`);
  });

  test('ranged and dynamic requests are never cached', () => {
    assert.match(SW, /req\.headers\.has\('Range'\)/);
    assert.match(SW, /isDynamicPath\(url\)/);
  });
});

describe('A legacy index opens without loss', () => {
  test('collections added after a golfer installed simply appear', async () => {
    const db = await resetDB();
    localStorage.setItem('rangelog_index_v1', JSON.stringify({
      schemaVersion: 2,
      sessions: [{ session_id: 'old-1', date: '2025-06-01', start_time: '09:00', status: 'finished', target_ball_count: 50, default_club: '7i', created_at: '2025-06-01T09:00:00.000Z' }],
      goals: [],
      settings: { lastClub: '7i' },
    }));
    localStorage.setItem('rangelog_shots_v1_old-1', JSON.stringify([
      { shot_id: 's1', shot_timestamp: '2025-06-01T09:01:00.000-04:00', club: '7i', strike: 'solid', direction: 'straight' },
    ]));
    db.__resetForTests();
    assert.equal(db.getShotsForSession('old-1').length, 1, 'old shots survive');
    for (const list of [db.listPracticeSessions(), db.listRounds(), db.listLessons(), db.listSwingVideos()]) {
      assert.deepEqual(list, [], 'newer collections default to empty, never undefined');
    }
    assert.ok(db.getSettings().lastClub === '7i', 'settings are preserved, not replaced');
  });
});
