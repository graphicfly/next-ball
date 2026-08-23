const CACHE_NAME = 'nextball-v41';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/state.js',
  './js/weather.js',
  './js/sessionWeather.js',
  './js/sessionLocation.js',
  './js/places.js',
  './js/sessionAnalysis.js',
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept weather/API calls

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
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
