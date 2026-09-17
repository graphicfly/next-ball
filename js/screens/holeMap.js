import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { greenEdgeYards, yardsBetween, metersToYards, bearingDegrees, boundsOf } from '../geo.js';
import { watchPosition, POSITION_STATE, accuracyTier, yardagesUsable } from '../livePosition.js';
import { loadMapLibre } from '../mapLibreLoader.js';

// Hole Map — docs/course-mode-spec.md §14.5, Reference C.
//
// One question: "how far am I from the green?" Everything on screen serves
// it, and §14.5's exclusion list is as load-bearing as its inclusion list —
// no tabs, no scoring control, no club recommendations, no hazard carries.
//
// Every number here comes from the geometry and position layers that
// already passed the Oakmont regression (§14.14). Nothing is recalculated
// locally: centre is yardsBetween(), front/back are greenEdgeYards()'s
// boundary intersections, the tee → green association is read from cached
// courseGeometry output, and the position comes from livePosition's
// high-accuracy watch. This file renders; it does not measure.

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Imagery &copy; Esri';
// A plain fallback so the map still draws shapes when imagery is blocked or
// unreachable — §14.5's job is the yardages, and losing the photo must not
// lose them.
const PLAIN_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// §14.5: chips are a fixed pixel size while a green is ~31 yd across, so at
// any zoom showing both golfer and green, three chips at their true
// coordinates collide into an unreadable cluster. They are separated in
// SCREEN space, not map space — a metre offset scales with the green and
// does not solve it.
const CHIP_OFFSET_PX = 44;

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const ICON_RECENTRE = '<circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v2.2" /><path d="M12 19.8V22" /><path d="M2 12h2.2" /><path d="M19.8 12H22" />';
const ICON_LAYERS = '<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" /><path d="m3 12.5 9 4.5 9-4.5" /><path d="m3 17 9 4.5 9-4.5" />';
const ICON_COMPASS = '<circle cx="12" cy="12" r="8.5" /><path d="m14.8 9.2-1.6 4.4-4.4 1.6 1.6-4.4 4.4-1.6Z" />';

const STATE_COPY = {
  [POSITION_STATE.LOCATING]: 'Locating…',
  [POSITION_STATE.DENIED]: 'Location access is needed for live yardages. The map and your round work without it.',
  [POSITION_STATE.UNAVAILABLE]: "Live yardages aren't available on this device.",
  [POSITION_STATE.TIMEOUT]: "Couldn't get a location fix.",
};

export function renderHoleMap(root, holeNumberParam) {
  const round = db.getActiveRound();
  if (!round) { location.hash = '#/home'; return; }

  const holeNumber = Number.parseInt(holeNumberParam, 10);
  const def = round.hole_defs.find((d) => d.hole_number === holeNumber);
  // Read from the cache. §14.5/§14.12.1: never refetch Overpass on open —
  // course geometry was resolved once and stored on the course record.
  const green = db.getGreenForHole(round.course_id, holeNumber);

  // Hole Entry's pill is gated on exactly this, so arriving without it means
  // a stale link or a course removed mid-round. Handled anyway (§14.8).
  if (!def || !green?.centroid) { location.hash = '#/course/round'; return; }

  const centroid = green.centroid;
  const polygon = green.polygon?.length >= 3 ? green.polygon : null;

  // The hole's own tee, as associated by the geometry layer. Read, never
  // re-derived here — §14.7 is explicit that guessing tee associations from
  // proximity is wrong, and that work is already done and tested.
  const teeCentroid = teeForRound(round, holeNumber);

  // Published, from the selected tee's snapshot. Never the live number, and
  // never reconciled against it (§14.6).
  const parts = [];
  if (def.par != null) parts.push(`Par ${def.par}`);
  if (def.yardage != null) parts.push(`${def.yardage} yd`);

  root.innerHTML = `
    <div class="screen hole-map-screen">
      <div class="topbar hole-map-topbar">
        <button class="back" id="backBtn">&larr; Back</button>
        <span class="hole-map-title">
          <span class="hole-map-hole">Hole ${holeNumber}</span>
          ${parts.length ? `<span class="hole-map-meta">${escapeHtml(parts.join(' • '))}</span>` : ''}
        </span>
        <span class="side-space"></span>
      </div>

      <div class="hole-map-canvas" id="mapCanvas">
        <div class="hole-map-fallback" id="mapFallback" hidden></div>
        <div class="hole-map-controls" id="mapControls" hidden>
          <button class="map-control" id="recentreBtn" aria-label="Recentre on your position">${icon(ICON_RECENTRE)}</button>
          <button class="map-control" id="layersBtn" aria-label="Switch imagery">${icon(ICON_LAYERS)}</button>
          <button class="map-control" id="compassBtn" aria-label="Reset the map to hole-up">${icon(ICON_COMPASS)}</button>
        </div>
      </div>

      <div class="card hole-map-readout" role="status" aria-live="polite">
        <div class="hole-map-readout-main">
          <span class="hole-map-distance" id="distanceValue">—</span>
          <span class="hole-map-distance-label">to center</span>
        </div>
        <div class="hole-map-readout-divider"></div>
        <div class="hole-map-readout-side">
          <span class="hole-map-accuracy-value" id="accuracyValue">—</span>
          <span class="hole-map-accuracy-label" id="accuracyLabel">GPS accuracy</span>
        </div>
      </div>
      <div class="hole-map-message" id="stateMessage" role="status" hidden></div>
    </div>
  `;

  const distanceEl = qs('#distanceValue', root);
  const accuracyValueEl = qs('#accuracyValue', root);
  const accuracyLabelEl = qs('#accuracyLabel', root);
  const messageEl = qs('#stateMessage', root);
  const fallbackEl = qs('#mapFallback', root);

  let map = null;
  let chips = null;
  let golferMarker = null;
  let lastFix = null;
  let holeUpBearing = teeCentroid ? bearingDegrees(teeCentroid, centroid) : null;
  let usingImagery = true;
  let disposed = false;

  // ---------- teardown ----------
  // Every exit path runs this: both buttons, the browser back gesture, and
  // the bottom nav — which §14.9 names as the exit most likely to leak a
  // watch, and which this screen uniquely shows (§14.5).
  let stopWatch = () => {};
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopWatch();
    window.removeEventListener('hashchange', onHashChange);
    if (map) { try { map.remove(); } catch (e) { /* already gone */ } map = null; }
  }
  function onHashChange() {
    if (!location.hash.startsWith('#/course/map/')) dispose();
  }
  window.addEventListener('hashchange', onHashChange);

  const leave = () => { dispose(); location.hash = '#/course/round'; };
  qs('#backBtn', root).addEventListener('click', leave);

  // ---------- readout ----------
  function showState(state) {
    if (state === POSITION_STATE.AVAILABLE) { messageEl.hidden = true; return; }
    const copy = STATE_COPY[state];
    if (!copy) return;
    distanceEl.textContent = '—';
    accuracyValueEl.textContent = '—';
    messageEl.hidden = false;
    messageEl.textContent = copy;
    chips?.clear();
    golferMarker?.remove();
    golferMarker = null;
  }

  function showFix(fix) {
    lastFix = fix;
    messageEl.hidden = true;
    const here = { lat: fix.lat, lon: fix.lon };
    const tier = accuracyTier(fix.accuracy_m);

    // §14.8: beyond the unusable threshold the numbers go entirely. A wrong
    // yardage is worse than none. Accuracy stays on screen so the golfer can
    // see why.
    if (!yardagesUsable(fix)) {
      distanceEl.textContent = '—';
      accuracyValueEl.textContent = `± ${Math.round(metersToYards(fix.accuracy_m))} yd`;
      accuracyLabelEl.textContent = 'GPS accuracy';
      messageEl.hidden = false;
      messageEl.textContent = "Location isn't precise enough for yardages right now.";
      chips?.clear();
      placeGolfer(here);
      return;
    }

    const centre = yardsBetween(here, centroid);
    // The approximate marker is "~" plus the accuracy line, never colour
    // (§14.10). Whole yards only — a decimal implies precision GPS lacks.
    distanceEl.textContent = `${tier === 'approximate' ? '~' : ''}${centre}`;
    accuracyValueEl.textContent = `± ${Math.round(metersToYards(fix.accuracy_m))} yd`;
    accuracyLabelEl.textContent = 'GPS accuracy';

    // Front and back only where a polygon exists. A captured single point is
    // centre-only and must never have them estimated (§14.7 B, §14.13.3).
    const edges = polygon ? greenEdgeYards(here, polygon, centroid) : null;
    chips?.update({ centre, edges, approximate: tier === 'approximate', from: here });
    placeGolfer(here);
    drawLine(here);
  }

  function placeGolfer(here) {
    if (!map || !window.maplibregl) return;
    if (!golferMarker) {
      const el = document.createElement('div');
      el.className = 'golfer-marker';
      el.innerHTML = '<span class="golfer-dot"></span><span class="golfer-label">You are here</span>';
      golferMarker = new window.maplibregl.Marker({ element: el, anchor: 'center' });
      golferMarker.setLngLat([here.lon, here.lat]).addTo(map);
    } else {
      golferMarker.setLngLat([here.lon, here.lat]);
    }
    golferMarker.getElement().setAttribute('aria-label',
      `Your location, ${yardsBetween(here, centroid)} yards from the green center`);
  }

  function drawLine(here) {
    const src = map?.getSource?.('aim');
    if (!src) return;
    src.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[here.lon, here.lat], [centroid.lon, centroid.lat]] },
    });
  }

  // ---------- map ----------
  loadMapLibre().then((gl) => {
    if (disposed) return;
    buildMap(gl);
  }).catch(() => {
    if (disposed) return;
    // §14.5's failure posture: losing the imagery must not lose the
    // yardages. The readout above is already live and is the screen's whole
    // purpose; the canvas simply says so and gets out of the way.
    fallbackEl.hidden = false;
    fallbackEl.textContent = 'Map imagery is unavailable right now. Yardages below are still live.';
  });

  function buildMap(gl) {
    map = new gl.Map({
      container: qs('#mapCanvas', root),
      style: styleFor(true),
      center: [centroid.lon, centroid.lat],
      zoom: 16.5,
      bearing: holeUpBearing ?? 0,
      // §14.5: free pan and pinch-rotate are why MapLibre was chosen over
      // Leaflet. Hole-up is the opening orientation, not a lock.
      attributionControl: { compact: true },
      // No default control cluster — §14.5 allows exactly three, and they
      // are rendered as the app's own buttons.
      pitchWithRotate: false,
      dragRotate: true,
    });

    map.on('error', () => { /* a dead tile must never throw into the round */ });

    map.on('load', () => {
      if (disposed) return;
      qs('#mapControls', root).hidden = false;

      if (polygon) {
        map.addSource('green', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[...polygon.map((p) => [p.lon, p.lat]), [polygon[0].lon, polygon[0].lat]]] },
          },
        });
        map.addLayer({ id: 'green-fill', type: 'fill', source: 'green', paint: { 'fill-color': '#3ee892', 'fill-opacity': 0.18 } });
        map.addLayer({ id: 'green-line', type: 'line', source: 'green', paint: { 'line-color': '#3ee892', 'line-width': 2 } });
      }

      map.addSource('aim', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'aim-line',
        type: 'line',
        source: 'aim',
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
      });

      chips = createChips(gl, map, centroid, !!polygon);
      // Framed on the green and the golfer, never the whole hole: fitting
      // tee-to-green shrinks the green to a few pixels and makes every
      // yardage unreadable (§14.5).
      frame();
      if (lastFix) showFix(lastFix);
    });

    qs('#recentreBtn', root).addEventListener('click', () => {
      if (lastFix) map.easeTo({ center: [lastFix.lon, lastFix.lat], duration: 400 });
      else frame();
    });
    qs('#compassBtn', root).addEventListener('click', () => {
      map.easeTo({ bearing: holeUpBearing ?? 0, duration: 400 });
      frame();
    });
    qs('#layersBtn', root).addEventListener('click', () => {
      usingImagery = !usingImagery;
      map.setStyle(styleFor(usingImagery));
      map.once('styledata', () => { if (!disposed) reAddLayers(); });
    });
  }

  function reAddLayers() {
    // setStyle drops sources and layers; the chips are DOM markers and
    // survive it, so only the GeoJSON needs rebuilding.
    if (!map || map.getSource('aim')) return;
    if (polygon && !map.getSource('green')) {
      map.addSource('green', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...polygon.map((p) => [p.lon, p.lat]), [polygon[0].lon, polygon[0].lat]]] } },
      });
      map.addLayer({ id: 'green-fill', type: 'fill', source: 'green', paint: { 'fill-color': '#3ee892', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'green-line', type: 'line', source: 'green', paint: { 'line-color': '#3ee892', 'line-width': 2 } });
    }
    map.addSource('aim', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'aim-line', type: 'line', source: 'aim', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
    if (lastFix) drawLine({ lat: lastFix.lat, lon: lastFix.lon });
  }

  function frame() {
    if (!map) return;
    const pts = [centroid, ...(polygon || [])];
    if (lastFix) pts.push({ lat: lastFix.lat, lon: lastFix.lon });
    const b = boundsOf(pts);
    if (!b) return;
    map.fitBounds(b, { padding: { top: 90, bottom: 120, left: 70, right: 70 }, duration: 0, maxZoom: 18, bearing: map.getBearing() });
  }

  function styleFor(imagery) {
    return {
      version: 8,
      sources: {
        base: {
          type: 'raster',
          tiles: [imagery ? ESRI_IMAGERY : OSM_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: imagery ? ESRI_ATTRIBUTION : PLAIN_ATTRIBUTION,
        },
      },
      layers: [{ id: 'base', type: 'raster', source: 'base' }],
    };
  }

  // ---------- position ----------
  stopWatch = watchPosition({
    onFix: (fix) => { if (!disposed) showFix(fix); },
    onState: (state) => { if (!disposed) showState(state); },
  });
}

// The tee this round is being played from, as associated by the geometry
// layer. Falls back to any tee the hole has, then to null — at which point
// §14.5's fallback applies and the bearing comes from golfer → green.
function teeForRound(round, holeNumber) {
  const geometry = db.getCourseGeometry(round.course_id);
  const hole = geometry?.holes?.find((h) => h.hole_number === holeNumber);
  if (!hole?.tees?.length) return null;
  const match = round.tee_id ? hole.tees.find((t) => t.tee === round.tee_id) : null;
  return (match || hole.tees[0]).centroid || null;
}

// Front / Center / Back as DOM markers pinned to the green centroid and
// separated by a fixed pixel offset along the golfer → centre direction on
// SCREEN (§14.5). Centre carries the accent border and numeral because it is
// the number golfers play to; front and back are neutral.
function createChips(gl, map, centroid, hasPolygon) {
  const make = (cls) => {
    const el = document.createElement('div');
    el.className = `yardage-chip ${cls}`;
    const marker = new gl.Marker({ element: el, anchor: 'center' })
      .setLngLat([centroid.lon, centroid.lat])
      .addTo(map);
    return { el, marker };
  };

  const centre = make('center');
  const front = hasPolygon ? make('edge') : null;
  const back = hasPolygon ? make('edge') : null;
  let current = null;

  // The screen-space direction from the golfer to the centre. Recomputed on
  // every map move so the offsets stay correct through pan, zoom and rotate.
  function direction() {
    const fix = current?.from;
    const c = map.project([centroid.lon, centroid.lat]);
    if (!fix) return { x: 0, y: -1 };
    const g = map.project([fix.lon, fix.lat]);
    const dx = c.x - g.x;
    const dy = c.y - g.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return { x: 0, y: -1 };
    return { x: dx / len, y: dy / len };
  }

  function layout() {
    if (!front || !back) return;
    const d = direction();
    // Front sits back toward the golfer, back sits beyond the centre.
    front.marker.setOffset([-d.x * CHIP_OFFSET_PX, -d.y * CHIP_OFFSET_PX]);
    back.marker.setOffset([d.x * CHIP_OFFSET_PX, d.y * CHIP_OFFSET_PX]);
  }

  map.on('move', layout);
  map.on('rotate', layout);

  return {
    update({ centre: centreYards, edges, approximate, from }) {
      current = { from: from || current?.from };
      const mark = approximate ? '~' : '';
      centre.el.innerHTML = `<span class="chip-value">${mark}${centreYards}</span><span class="chip-label">Center</span>`;
      centre.el.setAttribute('aria-label', `Green center, ${centreYards} yards`);
      if (!front || !back) return;
      if (!edges) { front.el.hidden = true; back.el.hidden = true; return; }
      front.el.hidden = false;
      back.el.hidden = false;
      front.el.innerHTML = `<span class="chip-value">${mark}${edges.front}</span><span class="chip-label">Front</span>`;
      front.el.setAttribute('aria-label', `Green front, ${edges.front} yards`);
      back.el.innerHTML = `<span class="chip-value">${mark}${edges.back}</span><span class="chip-label">Back</span>`;
      back.el.setAttribute('aria-label', `Green back, ${edges.back} yards`);
      layout();
    },
    setFrom(from) { current = { ...current, from }; layout(); },
    clear() {
      centre.el.innerHTML = '';
      if (front) front.el.hidden = true;
      if (back) back.el.hidden = true;
    },
  };
}
