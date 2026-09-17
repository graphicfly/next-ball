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

// Distances, in meters along the ray, at which the ray from `from` through
// `towards` crosses the boundary of `ring`.
//
// The ray is cast in the local metric frame centred on `from`, so a returned
// value IS the distance from the golfer to that crossing point. Only forward
// crossings are returned; a crossing behind the golfer is not somewhere they
// can aim.
//
// Segments exactly parallel to the ray are skipped: they contribute no
// single crossing point, and a boundary edge lying precisely along the line
// of play is a measure-zero case that the adjacent segments already bracket.
export function rayRingCrossings(from, ring, towards) {
  const pts = distinctRing(ring);
  if (!isCoord(from) || !isCoord(towards) || pts.length < 3) return [];

  const frame = localFrame(from);
  const t = frame.to(towards);
  const len = Math.hypot(t.x, t.y);
  if (len < 1e-9) return [];
  const d = { x: t.x / len, y: t.y / len };

  const local = pts.map((p) => frame.to(p));
  const cross = (px, py, qx, qy) => px * qy - py * qx;

  const hits = [];
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;

    // Solving  s * d = a + u * e  for the ray parameter s and the segment
    // parameter u, with the origin at the golfer.
    const denom = cross(d.x, d.y, ex, ey);
    if (Math.abs(denom) < 1e-12) continue; // parallel
    const s = cross(a.x, a.y, ex, ey) / denom;
    const u = cross(a.x, a.y, d.x, d.y) / denom;
    if (s < 0) continue;            // behind the golfer
    if (u < 0 || u > 1) continue;   // outside this edge
    hits.push(s);
  }
  return hits.sort((x, y) => x - y);
}

// Front / centre / back distances to a green, in meters, from wherever the
// golfer is standing.
//
// §14.7 level A: a green is one polygon, not three stored points. The line
// of play runs from the golfer's position through the green's centre; front
// and back are where that line crosses the green's BOUNDARY, nearest and
// farthest from the golfer. They change as the golfer walks and as the
// approach angle changes, which is why they are computed live and never
// stored.
//
// These are true edge intersections, not the nearest and farthest vertices.
// A vertex approximation is wrong in two ways: it reports a corner the line
// of play never crosses, and it can only ever land on a vertex, so it
// systematically overstates depth on a green whose boundary between vertices
// is what the ball actually flies over.
//
// Returns null when there is nothing to measure: no polygon (a captured
// green is a single point — coverage level B, centre only), the golfer
// standing exactly on the centre, or a ray that misses the ring entirely,
// which a strongly concave green can produce when its vertex mean falls
// outside its own boundary.
export function greenEdgeDistances(from, polygon, centroid) {
  if (!isCoord(from)) return null;
  const ring = distinctRing(polygon);
  const centre = isCoord(centroid) ? centroid : polygonCentroid(ring);
  if (!isCoord(centre) || ring.length < 3) return null;

  const hits = rayRingCrossings(from, ring, centre);
  if (!hits.length) return null;

  // An odd number of forward crossings means the golfer is standing inside
  // the green: the boundary ahead is the back edge and the front edge is
  // behind them, so there is no positive distance to a front edge to report.
  const inside = hits.length % 2 === 1;

  return {
    front_m: inside ? 0 : hits[0],
    center_m: haversineMeters(from, centre),
    back_m: hits[hits.length - 1],
    inside_green: inside,
  };
}

// The same three distances in whole yards, ready for display (§14.6).
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
