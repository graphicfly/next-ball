// Pure geodesic geometry for Course Mode's GPS features
// (docs/course-mode-spec.md §14). No network, no storage, no DOM — every
// function here is deterministic and unit-tested against the real Oakmont
// trace recorded in test/fixtures-oakmont-osm.json.
//
// Coordinates are `{ lat, lon }` in decimal degrees, unrounded. The short
// key names are deliberate: a green is a 20-50 point polygon and these
// records are persisted to localStorage, where `latitude`/`longitude` on
// every vertex costs roughly twice the bytes for no added clarity. The
// course record's own single venue point keeps the long form it has always
// had — see db.js.

export const EARTH_RADIUS_M = 6371000;
export const METERS_PER_YARD = 0.9144;

const DEG_TO_RAD = Math.PI / 180;
// Meters per degree of latitude, and of longitude at the equator. Used by
// the local planar frame below.
const M_PER_DEG = DEG_TO_RAD * EARTH_RADIUS_M;

export function metersToYards(m) {
  return m / METERS_PER_YARD;
}

// Whole yards. §14.6: live yardages are never shown with decimals, because
// a decimal implies a precision GPS does not have.
export function yardsBetween(a, b) {
  return Math.round(metersToYards(haversineMeters(a, b)));
}

export function haversineMeters(a, b) {
  if (!isCoord(a) || !isCoord(b)) return NaN;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isCoord(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lon);
}

// A closed OSM way repeats its first node as its last. Every calculation
// here wants the distinct ring, so the repeat is dropped once, here.
export function distinctRing(points) {
  const p = (points || []).filter(isCoord);
  if (p.length > 1 && p[0].lat === p[p.length - 1].lat && p[0].lon === p[p.length - 1].lon) {
    return p.slice(0, -1);
  }
  return p;
}

export function isClosedWay(points) {
  const p = (points || []).filter(isCoord);
  return p.length > 2 && p[0].lat === p[p.length - 1].lat && p[0].lon === p[p.length - 1].lon;
}

// The centre of a green — the mean of its distinct vertices.
//
// This is deliberately the vertex mean and NOT the area (shoelace) centroid.
// Two reasons, both established against the real trace:
//
//  1. It is the value the spec publishes. §14.14 records Oakmont hole 2's
//     green centroid as 38.8782468,-77.3161370; the vertex mean lands 0.6 m
//     from it and reproduces all nine holes' authoritative yardages exactly
//     (§14.14's 1374/1105 totals). An area centroid shifts several holes by
//     1-3 yd and no longer matches.
//  2. OSM greens are densely and fairly evenly sampled closed ways, so for
//     this shape the two definitions agree to about a metre anyway — well
//     inside GPS noise — while the mean cannot be destabilised by a
//     self-intersecting or badly-wound ring.
//
// A warning worth keeping, because it cost real time: a shoelace centroid
// computed on raw lat/lon degrees is catastrophically wrong for a polygon
// this small. The cross product x1*y2 - x2*y1 subtracts two numbers of
// magnitude ~77 that differ in the 4th decimal, and the cancellation threw
// the result 46 m outside a green only 24 m across. Any future area-centroid
// work must project to a local metric frame first, as localFrame() does.
export function polygonCentroid(points) {
  const ring = distinctRing(points);
  if (!ring.length) return null;
  let lat = 0;
  let lon = 0;
  for (const p of ring) { lat += p.lat; lon += p.lon; }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

// The widest distance between any two vertices — a green's "span" (§14.14
// reports 28.3 m for Oakmont hole 2). O(n^2) over at most ~50 points.
export function polygonMaxSpanMeters(points) {
  const ring = distinctRing(points);
  if (ring.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = haversineMeters(ring[i], ring[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

// A local planar frame in meters, centred on `origin`. Accurate to well
// under a metre over the few hundred metres a hole spans, and — unlike raw
// degrees — numerically stable, because every coordinate is a small offset
// rather than a small difference between two large numbers.
export function localFrame(origin) {
  const k = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    to(p) {
      return { x: (p.lon - origin.lon) * k * M_PER_DEG, y: (p.lat - origin.lat) * M_PER_DEG };
    },
    from(v) {
      return { lat: origin.lat + v.y / M_PER_DEG, lon: origin.lon + v.x / (k * M_PER_DEG) };
    },
  };
}

// Front / centre / back distances to a green, in meters, from wherever the
// golfer is standing.
//
// §14.7 level A: a green is one polygon, not three stored points. Front and
// back are the nearest and farthest points of that polygon measured ALONG
// the line from the current position to the centre — so they change as the
// golfer walks and as the approach angle changes. That is why they are
// computed live and never stored.
//
// Each vertex is projected onto the unit vector pointing at the centre, so
// the returned values are distances along the line of play rather than
// straight-line distances to off-axis vertices. front <= center <= back
// therefore holds by construction, and back - front is the green's depth on
// that line rather than its widest span.
//
// Returns null when there is nothing to measure: no polygon (a captured
// green is a single point — coverage level B, centre only), or the golfer
// standing exactly on the centre, where the line has no direction.
export function greenEdgeDistances(from, polygon, centroid) {
  if (!isCoord(from)) return null;
  const ring = distinctRing(polygon);
  const centre = isCoord(centroid) ? centroid : polygonCentroid(ring);
  if (!isCoord(centre) || ring.length < 3) return null;

  const frame = localFrame(from);
  const c = frame.to(centre);
  const len = Math.hypot(c.x, c.y);
  if (len < 1e-6) return null;
  const ux = c.x / len;
  const uy = c.y / len;

  let front = Infinity;
  let back = -Infinity;
  for (const p of ring) {
    const v = frame.to(p);
    const t = v.x * ux + v.y * uy; // projection onto the line of play
    if (t < front) front = t;
    if (t > back) back = t;
  }

  return {
    front_m: front,
    center_m: haversineMeters(from, centre),
    back_m: back,
  };
}

// The same three distances in whole yards, ready for display (§14.6).
// Negative projections are possible when the golfer has walked past the
// front edge; they are clamped at zero rather than shown as a negative
// distance, which would be meaningless on a chip reading "front".
export function greenEdgeYards(from, polygon, centroid) {
  const d = greenEdgeDistances(from, polygon, centroid);
  if (!d) return null;
  return {
    front: Math.max(0, Math.round(metersToYards(d.front_m))),
    center: Math.max(0, Math.round(metersToYards(d.center_m))),
    back: Math.max(0, Math.round(metersToYards(d.back_m))),
  };
}

// Nearest entry of `list` to `point`, by the coordinate `pick` returns.
// Returns null for an empty list so callers branch explicitly rather than
// silently measuring against undefined.
export function nearestTo(point, list, pick = (x) => x.centroid) {
  let best = null;
  let bestD = Infinity;
  for (const item of list || []) {
    const c = pick(item);
    if (!isCoord(c)) continue;
    const d = haversineMeters(point, c);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best === null ? null : { item: best, distance_m: bestD };
}
