const CACHE_NAME = 'nextball-v87';
// NOTE: vendor/maplibre is deliberately NOT precached (§14.5). At 1.01 MB it
// is larger than the entire rest of the app, for a screen half of all
// courses cannot show — precaching it would roughly double a fresh install.
// It is same-origin, so the runtime cache below picks it up on the first
// Hole Map open and every later open is instant and works offline.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/geo.js',
  './js/courseGeometry.js',
  './js/mapLibreLoader.js',
  './js/livePosition.js',
  './js/state.js',
  './js/version.js',
  './js/weather.js',
  './js/sessionWeather.js',
  './js/sessionLocation.js',
  './js/places.js',
  './js/courseProvider.js',
  './js/sessionAnalysis.js',
  './js/roundAnalysis.js',
  './js/lessonPlan.js',
  // Swing Lab media tier (V4.3 Phase 1). These are APPLICATION modules and
  // are precached like any other. User media is not: swing video lives in
  // IndexedDB and is played from a Blob URL, which never reaches this
  // service worker at all.
  './js/media.js',
  './js/mediaMeta.js',
  './js/swingMedia.js',
  './js/swingCapture.js',
  './js/swingContext.js',
  // The evidence layer. swingPose.js is deliberately ABSENT: it pulls a
  // multi-megabyte model from a CDN and is imported only when a golfer
  // chooses Analyze, exactly as vendor/maplibre is handled.
  './js/swingEvidence.js',
  './js/swingPhases.js',
  './js/swingMeasure.js',
  './js/swingAnalysis.js',
  './js/rangeCourseInsights.js',
  './js/sessionStory.js',
  './js/summarySections.js',
  './js/setupPersonalization.js',
  './js/wakeLock.js',
  './js/stats.js',
  './js/export.js',
  './js/ui.js',
  './js/screens/home.js',
  './js/screens/start.js',
  './js/screens/active.js',
  './js/screens/shotEntry.js',
  './js/screens/checkin.js',
  './js/screens/summary.js',
  './js/screens/history.js',
  './js/screens/historyDetail.js',
  './js/screens/yourGroove.js',
  './js/screens/courseSelect.js',
  './js/screens/courseSetup.js',
  './js/screens/courseEdit.js',
  './js/screens/courseRound.js',
  './js/screens/holeMap.js',
  './js/screens/roundSummary.js',
  './js/screens/roundExplore.js',
  './js/screens/practicePlan.js',
  './js/screens/lessonEntry.js',
  './js/screens/lessonSummary.js',
  './js/screens/devMedia.js',
  './js/screens/progress.js',
  './js/screens/swingCaptureScreen.js',
  './js/screens/swingPreview.js',
  './js/screens/swingLab.js',
  './js/screens/swingResult.js',
  './js/screens/trends.js',
  './js/screens/settings.js',
  './js/screens/locationSheet.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './graphics/direction/strike_solid.webp',
  './graphics/direction/strike_thin.webp',
  './graphics/direction/strike_topped.webp',
  './graphics/direction/strike_fat.webp',
  './graphics/direction/strike_shank.webp',
  './graphics/direction/strike_miss.webp',
  './graphics/height/height.webp',
  './graphics/active/range_backdrop.webp',
  './graphics/home/range_hero.webp',
  './graphics/distance/distance_ladder.webp',
  './graphics/direction/ball_grass.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Same-origin paths that are DATA, not application shell. Everything the
// cache below holds is treated as immutable until CACHE_NAME changes, which
// is right for a versioned app shell and wrong for anything that answers a
// question: one stale response would outlive the question that asked it.
//
// Reserved in advance, before any of these exist. The app has no same-origin
// endpoint today — this is here so that adding the first one cannot quietly
// inherit app-shell caching, which would be invisible until a golfer saw an
// answer from last week.
//
// The stronger protection is to put any future API on a DIFFERENT ORIGIN
// (api.nextballgolf.com), which never reaches this handler at all. This is
// the backstop for when that is not possible.
// '/spike/' is the Swing Lab feasibility prototype. It is excluded for a
// practical reason as much as a principled one: a cache-first app shell
// would pin whichever build of the prototype a test phone saw first, and
// iterating on a real device is the entire point of it.
const DYNAMIC_PATHS = ['/api/', '/media/', '/analysis/', '/spike/'];

function isDynamicPath(url) {
  return DYNAMIC_PATHS.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept weather/API calls
  if (isDynamicPath(url)) return;                  // data, not app shell — never cached
  // A ranged request asks for part of a file, and video playback is built
  // almost entirely out of them. The response is a 206, which `ok` happily
  // accepts — so without this the cache would fill with fragments and later
  // serve one as though it were the whole file.
  if (req.headers.has('Range')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Exactly 200, and only a same-origin response we fetched
          // ourselves. `res.ok` spans 200-299, which would let a 206 in;
          // `type === 'basic'` keeps opaque and cross-origin responses out.
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
          return caches.match(req);
        });
    })
  );
});
