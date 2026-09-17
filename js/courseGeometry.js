// Course feature geometry from OpenStreetMap — greens, tees and hole lines
// (docs/course-mode-spec.md §14.7, §14.12.1, §14.12.3).
//
// Same contract as places.js, for the same reasons: free, keyless, two
// public mirrors, and it never throws. Roughly half of Overpass queries in
// the §14.12.1 sample failed on first attempt with "server too busy", so a
// failure here is an ordinary outcome rather than an exception — it yields
// `reachable: false` and the caller carries on with no mapping at all.
// Nothing about this fetch may block scoring.
//
// Fetch once per course and cache permanently on the course record (see
// db.js setCourseGeometry). Course geometry does not change week to week.

import {
  haversineMeters, polygonCentroid, polygonMaxSpanMeters, isClosedWay,
  isCoord, metersToYards, nearestTo, distinctRing,
} from './geo.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Generous enough to cover an 18-hole course from its centre point. The
// area-scoped query below is preferred precisely because this radius alone
// can reach a neighbouring course on a crowded site.
export const COURSE_FEATURE_RADIUS_M = 2000;

// How far a tee may sit from a hole line's start and still be that hole's
// tee. A hole's own tee boxes string out along the line — Oakmont's red
// tees sit up to ~40 m ahead of the blue — while a neighbouring hole's tee
// is a full hole away. 80 m admits the former without admitting the latter,
// and matters only for a colour this hole does not actually have: without
// a cap, "nearest tee of each colour" would hand every hole a gold tee
// belonging to a different one (§14.7).
export const TEE_ASSOCIATION_MAX_M = 80;

// A hole line's end must land somewhere near a green for the association to
// mean anything. Oakmont's loosest is 95 m; beyond this the line is either
// mis-drawn or the green simply is not mapped, and no green is claimed.
export const GREEN_ASSOCIATION_MAX_M = 150;

export const GEOMETRY_STATUS = {
  OK: 'ok',
  UNREACHABLE: 'unreachable',
  NO_FEATURES: 'no_features',
};

// ---------- Overpass ----------

// Returns the element array on success — legitimately empty for an unmapped
// course — or null when every mirror failed. The distinction matters: one is
// "this course has no mapping", the other is "we could not find out".
async function fetchOverpass(query, ms) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.elements)) return data.elements;
    } catch (e) {
      // try the next mirror
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// `out geom` is required — the default `out` gives node ids only, and every
// calculation here needs real coordinates. `meta` supplies the timestamp the
// duplicate-ref tiebreak falls back on.
const OUT = 'out geom tags meta;';

// Scoped to the course's own OSM area when we know it, which is exact, and
// to a radius otherwise. Both are tried in order: map_to_area fails outright
// if place_id refers to a node rather than a way or relation, and a course
// mapped as a single node is common.
export function buildQueries({ latitude, longitude, place_id } = {}) {
  const queries = [];
  const m = /^(way|relation|rel)\/(\d+)$/.exec(place_id || '');
  if (m) {
    const kind = m[1] === 'way' ? 'way' : 'rel';
    queries.push(
      `[out:json][timeout:25];${kind}(${m[2]});map_to_area->.c;`
      + '(nwr(area.c)["golf"="green"];nwr(area.c)["golf"="tee"];nwr(area.c)["golf"="hole"];);'
      + OUT
    );
  }
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const around = `around:${COURSE_FEATURE_RADIUS_M},${latitude},${longitude}`;
    queries.push(
      `[out:json][timeout:25];`
      + `(nwr(${around})["golf"="green"];nwr(${around})["golf"="tee"];nwr(${around})["golf"="hole"];);`
      + OUT
    );
  }
  return queries;
}

// Tries each query strategy across both mirrors. Returns
// `{ reachable, elements }` — `reachable: false` only when every strategy on
// every mirror failed, so the caller can say "lookup is unavailable" rather
// than "this course is not mapped" (§8).
//
// Worst case is slow on purpose: up to two strategies over two mirrors, so
// roughly 100 s before giving up. That is acceptable only because nothing
// waits on it — the result is cached forever on success, and a failure
// costs the golfer nothing but an unmapped course. Never await this on a
// path that renders something.
export async function fetchCourseElements(course, { timeoutMs = 25000 } = {}) {
  const queries = buildQueries(course);
  if (!queries.length) return { reachable: false, elements: [] };
  let reachedAny = false;
  for (const q of queries) {
    const elements = await fetchOverpass(q, timeoutMs);
    if (elements === null) continue;
    reachedAny = true;
    if (elements.length) return { reachable: true, elements };
  }
  // Reached the service but it had nothing — an unmapped course, which is
  // half of them (§14.12.1).
  return { reachable: reachedAny, elements: [] };
}

// ---------- Parsing ----------

function pointsOf(el) {
  if (Array.isArray(el.geometry)) {
    return el.geometry
      .filter((n) => n && Number.isFinite(n.lat) && Number.isFinite(n.lon))
      .map((n) => ({ lat: n.lat, lon: n.lon }));
  }
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return [{ lat: el.lat, lon: el.lon }];
  return [];
}

// The OSM metadata the duplicate-ref tiebreak needs, carried through to the
// normalized feature and on into the stored record so the choice stays
// auditable after the fact — "which of the two ref=1 features did we take,
// and how old was it?" is answerable from the cache alone.
//
// `out geom tags meta` supplies both. They are NOT interchangeable, and
// Oakmont proves it: the stale 2010 hole-1 area is version 5 while the
// correct 2026 line is version 1, because version counts edits to a single
// element and says nothing across two different ones. Timestamp is the only
// recency signal; version is kept for provenance and as a last deterministic
// tiebreak, never as "newer".
function baseFeature(el) {
  const points = pointsOf(el);
  if (!points.length) return null;
  return {
    osm_id: `${el.type}/${el.id}`,
    points,
    centroid: polygonCentroid(points),
    closed: isClosedWay(points),
    osm_timestamp: typeof el.timestamp === 'string' ? el.timestamp : null,
    osm_version: Number.isFinite(el.version) ? el.version : null,
  };
}

// Sorts OSM elements into the three feature kinds Course Mode uses. Anything
// else a trace carries — fairway, bunker, rough — is ignored: §14.11 puts
// hazard and layup distances out of scope, so there is nothing to do with
// them yet and storing them would only bloat the course record.
export function parseGolfElements(elements) {
  const greens = [];
  const tees = [];
  const holes = [];

  for (const el of elements || []) {
    const tags = el?.tags || {};
    const kind = tags.golf;
    if (kind !== 'green' && kind !== 'tee' && kind !== 'hole') continue;
    const f = baseFeature(el);
    if (!f) continue;

    if (kind === 'green') {
      greens.push({ ...f, span_m: polygonMaxSpanMeters(f.points) });
    } else if (kind === 'tee') {
      // `tee=<colour>` is how OSM names a tee set (§14.12.3). A tee with no
      // colour cannot join a named tee set, but it is still a tee and still
      // useful for orienting a hole line, so it is kept and simply excluded
      // from the per-colour yardages.
      tees.push({ ...f, colour: typeof tags.tee === 'string' ? tags.tee.toLowerCase() : null });
    } else {
      // A golf=hole feature without a ref cannot be tied to a hole number,
      // and guessing one from position would be exactly the proximity
      // reasoning §14.7 rules out. Oakmont carries one such feature.
      const ref = Number.parseInt(tags.ref, 10);
      if (!Number.isFinite(ref)) continue;
      const par = Number.parseInt(tags.par, 10);
      holes.push({ ...f, hole_number: ref, par: Number.isFinite(par) ? par : null });
    }
  }

  return { greens, tees, holes };
}

// ---------- Hole lines ----------

// OSM does not guarantee which way a hole line is drawn. Oakmont happens to
// be uniformly traced tee-to-green — its first nodes sit 0-3 m from a tee
// and its last 0-5 m from a green — so this is defensive rather than
// load-bearing for the fixture, but nothing in OSM enforces that and a
// reversed line would silently swap the roles of both endpoints, producing
// plausible but wrong yardages. The end nearer a tee is the start.
export function orientHoleLine(hole, tees) {
  const pts = hole.points;
  const start = pts[0];
  const end = pts[pts.length - 1];
  if (!tees.length || pts.length < 2) return { start, end };
  const ds = nearestTo(start, tees);
  const de = nearestTo(end, tees);
  if (ds && de && de.distance_m < ds.distance_m) return { start: end, end: start };
  return { start, end };
}

// Duplicate `ref` values are normal, not corrupt data, and are never
// surfaced to the golfer (§14.7). Oakmont hole 1 carries two: a 2010
// import area and a 2026 line. Deterministic tiebreak, in order:
//
//   1. a line beats a closed area — an area's "length" is its perimeter and
//      is meaningless as a hole;
//   2. then the better endpoint fit — start nearest a tee plus end nearest
//      a green;
//   3. then the most recently edited, by timestamp;
//   4. then the higher version, purely so the result is stable when two
//      features carry the same timestamp. This is a determinism tiebreak
//      and not a recency one — see baseFeature() for why version cannot be
//      compared across elements.
export function chooseHoleFeature(candidates, { tees = [], greens = [] } = {}) {
  if (!candidates || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const score = (h) => {
    if (h.closed) return Infinity;
    const { start, end } = orientHoleLine(h, tees);
    const t = nearestTo(start, tees);
    const g = nearestTo(end, greens);
    if (!t || !g) return Infinity;
    return t.distance_m + g.distance_m;
  };

  return candidates.slice().sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    const d = score(a) - score(b);
    if (d !== 0 && Number.isFinite(d)) return d;
    const byTime = String(b.osm_timestamp || '').localeCompare(String(a.osm_timestamp || ''));
    if (byTime !== 0) return byTime;
    return (b.osm_version || 0) - (a.osm_version || 0);
  })[0];
}

// ---------- Association and measurement (§14.7) ----------

// Association uses the hole line's endpoints, and only its endpoints.
// Measurement is a separate step that never touches the line.
//
// The line's LENGTH is never a yardage. A hole has exactly one line, so a
// line-derived distance is one number and cannot tell Blue from Red — which
// is the whole point of a tee set. It is unreliable on its own terms too:
// its value depends on where the mapper stopped drawing. Oakmont hole 3's
// line measures 184 yd against a true blue yardage of 178.
export function associateHole(hole, { greens, tees }) {
  const { start, end } = orientHoleLine(hole, tees);

  const g = nearestTo(end, greens);
  const green = g && g.distance_m <= GREEN_ASSOCIATION_MAX_M ? g.item : null;

  const colours = new Map();
  for (const tee of tees) {
    if (!tee.colour) continue;
    const d = haversineMeters(start, tee.centroid);
    if (d > TEE_ASSOCIATION_MAX_M) continue;
    const prev = colours.get(tee.colour);
    if (!prev || d < prev.distance_m) colours.set(tee.colour, { tee, distance_m: d });
  }

  return { start, end, green, tees: colours };
}

// One yardage per tee, each measured independently: tee centroid to green
// centroid. Two tees have two centroids and therefore two distances, which
// is the property line length can never have.
export function measureHole(association) {
  const { green, tees } = association;
  const out = [];
  if (!green || !isCoord(green.centroid)) return out;
  for (const [colour, { tee }] of tees) {
    if (!isCoord(tee.centroid)) continue;
    out.push({
      tee: colour,
      centroid: tee.centroid,
      osm_id: tee.osm_id,
      osm_timestamp: tee.osm_timestamp,
      osm_version: tee.osm_version,
      yards: Math.round(metersToYards(haversineMeters(tee.centroid, green.centroid))),
    });
  }
  out.sort((a, b) => b.yards - a.yards); // longest tee first, as a card reads
  return out;
}

// ---------- Whole-course mapping ----------

// Turns parsed features into the per-hole record the course caches.
//
// A course with greens and tees but NO hole lines degrades to centre-only:
// greens are still returned (they are what live yardage needs), and per-tee
// yardages are simply absent. §14.7 is explicit that guessing tee
// associations from proximity is wrong — a neighbouring hole's tee is often
// nearer than a hole's own, and doing it anyway produced Oakmont hole 8 as
// blue 59 / red 111, with blue shorter than red.
export function buildHoleMapping({ greens = [], tees = [], holes = [] } = {}) {
  const byRef = new Map();
  for (const h of holes) {
    if (!byRef.has(h.hole_number)) byRef.set(h.hole_number, []);
    byRef.get(h.hole_number).push(h);
  }

  const mapped = [];
  for (const [holeNumber, candidates] of [...byRef.entries()].sort((a, b) => a[0] - b[0])) {
    const hole = chooseHoleFeature(candidates, { tees, greens });
    if (!hole) continue;
    const assoc = associateHole(hole, { greens, tees });
    mapped.push({
      hole_number: holeNumber,
      par: hole.par,
      hole_osm_id: hole.osm_id,
      hole_osm_timestamp: hole.osm_timestamp,
      hole_osm_version: hole.osm_version,
      // How many features claimed this ref. Never shown to the golfer
      // (§14.7 forbids making a prompt of it), but it records that a choice
      // was made rather than that only one candidate existed.
      ref_candidates: candidates.length,
      green: assoc.green ? greenRecord(assoc.green) : null,
      tees: measureHole(assoc),
    });
  }
  return mapped;
}

function greenRecord(green) {
  return {
    osm_id: green.osm_id,
    osm_timestamp: green.osm_timestamp,
    osm_version: green.osm_version,
    centroid: green.centroid,
    // The full ring, because front/back are computed live from it on every
    // position update (§14.7 level A) and cannot be derived from the centre.
    polygon: distinctRing(green.points),
    span_m: Math.round(green.span_m * 10) / 10,
    source: 'osm',
  };
}

// The storable record for one course. Shape is deliberately flat and
// self-describing so a future provider can be added without reinterpreting
// what is already cached.
export function buildCourseGeometry(elements, { fetchedAt = new Date().toISOString() } = {}) {
  const parsed = parseGolfElements(elements);
  const holes = buildHoleMapping(parsed);
  const greens = parsed.greens.map(greenRecord);
  return {
    source: 'osm',
    fetched_at: fetchedAt,
    holes,
    // Every green on the property, including any that no hole line claimed.
    // A course with no hole lines has holes: [] and greens here, which is
    // exactly the centre-only degradation described above.
    greens,
    counts: {
      greens: parsed.greens.length,
      tees: parsed.tees.length,
      hole_lines: parsed.holes.length,
      holes_mapped: holes.length,
      holes_with_green: holes.filter((h) => h.green).length,
      holes_with_tee_yardage: holes.filter((h) => h.tees.length).length,
    },
  };
}

// The tee sets a course publishes, derived from what was measured
// (§14.12.3's recommended `tees: [{ tee_id, name, hole_yardages[] }]`).
// A colour only becomes a tee set if at least one hole measured it, so a
// stray tee polygon does not invent a tee nobody plays from.
export function teeSetsFromGeometry(geometry, holeCount) {
  const holes = geometry?.holes || [];
  const count = Number.isFinite(holeCount) && holeCount > 0
    ? holeCount
    : holes.reduce((m, h) => Math.max(m, h.hole_number), 0);
  if (!count) return [];

  const colours = new Set();
  for (const h of holes) for (const t of h.tees) colours.add(t.tee);

  return [...colours].map((colour) => {
    const yardages = new Array(count).fill(null);
    let total = 0;
    for (const h of holes) {
      const hit = h.tees.find((t) => t.tee === colour);
      if (!hit || h.hole_number < 1 || h.hole_number > count) continue;
      yardages[h.hole_number - 1] = hit.yards;
      total += hit.yards;
    }
    return {
      tee_id: colour,
      name: colour.charAt(0).toUpperCase() + colour.slice(1),
      hole_yardages: yardages,
      total_yards: total,
      // Never presented as a scorecard yardage (§14.12.3): these came from
      // polygons, not from a published card.
      measured: true,
    };
  }).sort((a, b) => b.total_yards - a.total_yards);
}

// One call for the whole job: fetch, parse, associate, measure. Never
// throws. Returns a status alongside the geometry so the caller can tell
// "unmapped" from "could not reach the service".
export async function loadCourseGeometry(course, opts = {}) {
  const { reachable, elements } = await fetchCourseElements(course, opts);
  if (!reachable) return { status: GEOMETRY_STATUS.UNREACHABLE, geometry: null };
  if (!elements.length) return { status: GEOMETRY_STATUS.NO_FEATURES, geometry: null };
  const geometry = buildCourseGeometry(elements, opts);
  if (!geometry.counts.greens && !geometry.counts.holes_mapped) {
    return { status: GEOMETRY_STATUS.NO_FEATURES, geometry: null };
  }
  return { status: GEOMETRY_STATUS.OK, geometry };
}

// ---------- Coverage (§14.7) ----------

// What a course can actually support, as four internal levels. The UI never
// shows these words — §14.7's own wording is "GPS map available" or nothing
// — but every screen decision (which stat cells appear, whether View Course
// Map exists, what the status row says) is made from one of them, so they
// are named rather than re-derived ad hoc at each call site.
export const COVERAGE = {
  // Greens AND per-tee yardages: the full Reference C experience.
  TRACED: 'traced',
  // Green coordinates but no tee yardages — live distances work, published
  // per-tee yardages do not. Also where a golfer-captured green lands
  // (§14.13), which is a single point and can never be more than this.
  GREENS_ONLY: 'greens_only',
  // Par and possibly yardages, no green coordinates. Everything except the
  // map works exactly as it did in V1.
  SCORECARD: 'scorecard',
  // Nothing beyond what the golfer typed. A manual course starts here and
  // is fully first-class (§14.7 D).
  UNMAPPED: 'unmapped',
};

// Pure over a stored course record — no db access, no network, so a caller
// can evaluate a course it has only just fetched.
//
// `hasMap` is deliberately its own flag rather than `level === TRACED`:
// §14.2 gates the GPS cell and the View Course Map row on "green
// coordinates exist for >= 1 hole", which is true at GREENS_ONLY too.
export function courseCoverage(course) {
  const geometry = course?.geometry || null;
  const holeCount = Number.isFinite(course?.hole_count) ? course.hole_count : 0;
  const holes = geometry?.holes || [];

  const greensAssociated = holes.filter((h) => h.green).length;
  // Greens that no hole line claimed still count. §14.7 rule 2: a course
  // with greens and no golf=hole features — Burke Lake has 18 of them — is
  // usable, because the green is resolved at play time from the golfer's
  // own position, which is reliable precisely because they are standing on
  // the hole they are playing. Capped at the hole count so the status row
  // can never read "18 of 9".
  const greensOnProperty = (geometry?.greens || []).length;
  const greensMapped = greensAssociated > 0
    ? greensAssociated
    : Math.min(greensOnProperty, holeCount || greensOnProperty);
  const holesWithTeeYardage = holes.filter((h) => h.tees && h.tees.length).length;
  const teeSets = Array.isArray(course?.tees) ? course.tees : [];

  // Yardage can exist without any geometry at all — a provider or the
  // golfer may have supplied per-hole yardages on hole_defs.
  const hasYardages = teeSets.length > 0
    || (course?.hole_defs || []).some((d) => d.yardage != null);

  let level;
  if (greensMapped > 0 && holesWithTeeYardage > 0) level = COVERAGE.TRACED;
  else if (greensMapped > 0) level = COVERAGE.GREENS_ONLY;
  else if (hasYardages) level = COVERAGE.SCORECARD;
  else level = COVERAGE.UNMAPPED;

  return {
    level,
    holeCount,
    greensMapped,
    greensAssociated,
    greensOnProperty,
    holesWithTeeYardage,
    hasYardages,
    teeSets,
    // The one gate §14.2 and §14.7 C actually use. Being in OSM is not the
    // question — having a green coordinate is.
    hasMap: greensMapped > 0,
    // Whether a lookup has already happened, so a caller can tell "no
    // mapping" from "not looked up yet" without re-querying.
    checked: !!course?.geometry_checked_at,
  };
}
