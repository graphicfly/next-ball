import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The service worker is not a module and never runs under Node, so it is
// read and evaluated here as source. That is deliberate: these rules decide
// what the app treats as immutable, and a typo in a path prefix would be
// invisible until a golfer saw a stale answer weeks later.

const SRC = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

// Lift the exclusion logic out of the shipped file rather than restating it,
// so this test fails if the real rules drift.
const isDynamicPath = (() => {
  const consts = SRC.match(/const DYNAMIC_PATHS = \[[^\]]*\];/)[0];
  const fn = SRC.match(/function isDynamicPath\(url\) \{[\s\S]*?\n\}/)[0];
  return new Function(`${consts}\n${fn}\nreturn isDynamicPath;`)();
})();

const at = (pathname) => ({ pathname });

describe('Service worker — what must never be cached as app shell', () => {
  test('the reserved dynamic prefixes are excluded', () => {
    assert.equal(isDynamicPath(at('/api/interpret')), true);
    assert.equal(isDynamicPath(at('/media/abc123.mp4')), true);
    assert.equal(isDynamicPath(at('/analysis/job/42')), true);
  });

  test('every real application asset is still cacheable', () => {
    for (const p of [
      '/', '/index.html', '/js/app.js', '/js/db.js', '/css/style.css',
      '/manifest.json', '/service-worker.js', '/icons/icon-192.png',
      '/graphics/home/range_hero.webp', '/vendor/maplibre/maplibre-gl.js',
    ]) {
      assert.equal(isDynamicPath(at(p)), false, `${p} must remain cacheable`);
    }
  });

  test('matching is by path prefix, not substring — a lookalike asset is not excluded', () => {
    // An asset merely CONTAINING the word must not be swept up.
    assert.equal(isDynamicPath(at('/js/screens/apiHelpers.js')), false);
    assert.equal(isDynamicPath(at('/graphics/media-icon.png')), false);
    assert.equal(isDynamicPath(at('/js/analysisView.js')), false);
  });

  test('the prefix list is exactly what is documented', () => {
    const list = SRC.match(/const DYNAMIC_PATHS = \[([^\]]*)\]/)[1];
    const parsed = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(parsed, ['/api/', '/media/', '/analysis/']);
    // Trailing slashes matter: '/api' alone would also exclude '/apiary.js'.
    for (const p of parsed) assert.ok(p.endsWith('/'), `${p} needs a trailing slash`);
  });
});

describe('Service worker — the caching predicate', () => {
  test('non-GET is still bypassed before anything else', () => {
    assert.match(SRC, /if \(req\.method !== 'GET'\) return;/);
  });

  test('cross-origin is still never intercepted', () => {
    assert.match(SRC, /if \(url\.origin !== self\.location\.origin\) return;/);
  });

  test('ranged requests bypass the cache entirely', () => {
    // Video playback is built out of Range requests; a cached fragment
    // replayed as a whole file corrupts playback rather than just ageing.
    assert.match(SRC, /req\.headers\.has\('Range'\)\) return;/);
  });

  test('only an exact 200 basic response is stored', () => {
    // res.ok spans 200-299, which would admit a 206 Partial Content.
    assert.match(SRC, /res\.status === 200 && res\.type === 'basic'/);
    assert.doesNotMatch(SRC, /if \(res && res\.ok\) \{/);
  });

  test('the precache still populates at install, so offline never depends on these rules', () => {
    assert.match(SRC, /cache\.addAll\(PRECACHE_URLS\)/);
  });
});
