// Lazy loader for MapLibre GL JS (docs/course-mode-spec.md §14.5).
//
// MapLibre is 1.01 MB — larger than the entire rest of the app combined —
// for a screen that half of all courses cannot show (§14.12.1). So it is
// DELIBERATELY absent from PRECACHE_URLS and fetched on first Hole Map open
// instead. It is vendored rather than pulled from a CDN so that the service
// worker's ordinary same-origin runtime caching picks it up on that first
// fetch: later opens are instant and work offline, with no cross-origin
// carve-out in the worker.
//
// This adds no new failure mode. The map already needs connectivity for its
// tiles (§14.12.6), so needing it once for the library is consistent with
// what the screen already cannot do without a signal.

const BASE = 'vendor/maplibre';
let loading = null;

function loadCss() {
  return new Promise((resolve) => {
    if (document.getElementById('maplibreCss')) return resolve();
    const link = document.createElement('link');
    link.id = 'maplibreCss';
    link.rel = 'stylesheet';
    link.href = `${BASE}/maplibre-gl.css`;
    // A missing stylesheet degrades the map's own controls, not the
    // yardages, so it never blocks the screen.
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

function loadScript() {
  return new Promise((resolve, reject) => {
    if (window.maplibregl) return resolve(window.maplibregl);
    const s = document.createElement('script');
    s.src = `${BASE}/maplibre-gl.js`;
    s.async = true;
    s.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibre absent after load')));
    s.onerror = () => reject(new Error('maplibre failed to load'));
    document.head.appendChild(s);
  });
}

// Resolves with the maplibregl global, or rejects. The promise is cached on
// success so a second open costs nothing; a failure is NOT cached, so a
// golfer who was offline on their first attempt can succeed on the next.
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loading) return loading;
  loading = Promise.all([loadCss(), loadScript()])
    .then(([, gl]) => gl)
    .catch((err) => { loading = null; throw err; });
  return loading;
}

export function mapLibreReady() {
  return !!window.maplibregl;
}
