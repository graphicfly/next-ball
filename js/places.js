// Pure golf-venue lookup client — OpenStreetMap's Overpass API. Free, no
// API key, no billing account, matching the same "no secrets, no backend"
// footing as weather.js's Open-Meteo/BigDataCloud calls. Same never-throws
// contract as weather.js: a slow/unreachable/empty response can never block
// or break session/shot logging, it just yields no candidates.
//
// Two public mirrors are tried in order (Overpass instances are shared
// community infrastructure, not a paid SLA) so one being briefly overloaded
// doesn't mean venue lookup fails outright for that session.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Radius chosen to cover a large course's clubhouse/range/parking area
// without pulling in a genuinely different facility a mile+ away — see
// db.js's REMEMBER_RADIUS_M for the separate (tighter) "is this the same
// visit as last time" radius. 1600m (not a tighter, more "precise"-looking
// value) because Overpass's around-filter tests a course's whole polygon,
// not just its centroid — verified live against Reston National Golf
// Course's real OSM data: a real full-size course spans a wide bounding
// box, and a genuinely different course's polygon can graze the edge of
// that same radius from certain points on the property without actually
// being a mix-up risk (STRONG_MATCH_M below is what actually protects
// against that).
const SEARCH_RADIUS_M = 1600;

// Below this, a single candidate is confidently "the" venue regardless of
// how many others are in range. Above it (but still one candidate), it's
// still auto-selected — nothing else nearby to be confused with — but a
// SECOND candidate within this same distance makes it genuinely ambiguous.
// 500m (not the tighter 300m a single point-of-interest would warrant)
// because this app is specifically for driving-range practice, and a
// range is typically sited at a course's edge, not its geometric center —
// verified live against Reston National: Overpass/Nominatim's own reported
// "center" for that one course differed by ~500m depending on which tool
// computed it, so a driving-range golfer's real distance-to-centroid can
// easily clear a tighter threshold even though there is exactly one real
// venue there.
const STRONG_MATCH_M = 500;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOverpass(query, ms) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.elements)) return data.elements;
    } catch (e) {
      // try the next mirror
    } finally {
      // Must run on every path — a rejected fetch (offline, DNS failure)
      // previously skipped this, leaving the timer pending for no reason.
      clearTimeout(t);
    }
  }
  return [];
}

// Returns [{ name, latitude, longitude, distance_m, place_id }], sorted
// nearest-first, deduped by name (OSM sometimes tags the same real-world
// facility as both a golf_course way and a separate driving_range way).
// Never throws — an unreachable/empty response just yields [].
export async function fetchNearbyGolfVenues(lat, lon) {
  const query = `[out:json][timeout:10];(nwr(around:${SEARCH_RADIUS_M},${lat},${lon})["leisure"="golf_course"];nwr(around:${SEARCH_RADIUS_M},${lat},${lon})["golf"="driving_range"];nwr(around:${SEARCH_RADIUS_M},${lat},${lon})["golf"="range"];);out center tags;`;
  const elements = await fetchOverpass(query, 9000);

  const candidates = [];
  for (const el of elements) {
    const name = el.tags?.name;
    if (!name) continue; // an unnamed feature isn't a useful venue candidate
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;
    candidates.push({
      name,
      latitude: elLat,
      longitude: elLon,
      distance_m: Math.round(haversineMeters(lat, lon, elLat, elLon)),
      place_id: `${el.type}/${el.id}`,
    });
  }

  candidates.sort((a, b) => a.distance_m - b.distance_m);

  const deduped = [];
  for (const c of candidates) {
    const dupe = deduped.find((d) => d.name.toLowerCase() === c.name.toLowerCase());
    if (!dupe) deduped.push(c);
  }
  return deduped;
}

// Confidence decision over a candidate list — see places.test.js for the
// exact matrix this implements. Returns one of:
//   { decision: 'none' }                         — nothing nearby, fall back
//   { decision: 'auto', venue }                   — confidently one venue
//   { decision: 'ambiguous', candidates }          — let the golfer pick
export function resolveVenueConfidence(candidates) {
  if (!candidates.length) return { decision: 'none' };
  const [first, second] = candidates;
  if (!second) return { decision: 'auto', venue: first };
  if (first.distance_m <= STRONG_MATCH_M && second.distance_m > STRONG_MATCH_M) {
    return { decision: 'auto', venue: first };
  }
  return { decision: 'ambiguous', candidates: candidates.slice(0, 4) };
}
