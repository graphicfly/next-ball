// Course discovery — the one place Course Mode talks to an external course
// source. Everything above this module works in terms of the plain Course
// shape below, so swapping or adding a provider later touches this file
// only.
//
// Both backing services are decided (docs/course-mode-spec.md §11.3, §11.4),
// free, and keyless: nearby lookup reuses the existing Overpass client in
// places.js, and search uses Nominatim. There are no credentials anywhere in
// Course Mode — nothing to configure, nothing to keep secret.
//
// Same never-throws contract as weather.js and places.js: every function
// here resolves, always. A denied permission, an unreachable service, an
// empty result and a malformed response are all just "no courses", because
// manual entry is always available and course selection must never be a
// dead end (§8).
//
// Nominatim's usage policy asks for a descriptive User-Agent or Referer and
// roughly one request per second. A browser cannot set User-Agent (it is a
// forbidden header name), so we satisfy this with the Referer the browser
// sends automatically, and with search being debounced and submit-driven
// rather than search-as-you-type (§11.4) — see courseSelect.js.

import { fetchNearbyGolfVenuesDetailed } from './places.js';
import { getCurrentPosition, fetchLocationDetails } from './weather.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 10;

// Why a lookup produced nothing. The UI needs to tell these apart — §8 gives
// each its own copy, and "location is off" must never read as "no courses
// exist near you".
export const LOOKUP_STATUS = {
  OK: 'ok',
  NO_PERMISSION: 'no_permission',
  NO_RESULTS: 'no_results',
  UNAVAILABLE: 'unavailable',
};

// The shape every origin produces, identical whether a course came from GPS,
// search, the local recents store, or the golfer's own typing (§4.2).
function toCourse({ name, city = null, state = null, latitude = null, longitude = null, place_id = null, source, distance_m = null }) {
  return {
    name,
    city,
    state,
    latitude,
    longitude,
    place_id,
    source,
    provider: place_id ? 'osm' : null,
    distance_m,
  };
}

// Nearby courses for a set of coordinates.
//
// Range Mode's own venue resolution stays unfiltered exactly as before; the
// `course` filter lives here, at the call site, so Course Mode never offers
// a driving range as somewhere to play a round (§11.3).
export async function nearbyCourses(latitude, longitude) {
  if (latitude == null || longitude == null) {
    return { status: LOOKUP_STATUS.UNAVAILABLE, courses: [] };
  }

  const [{ reachable, venues }, geocode] = await Promise.all([
    fetchNearbyGolfVenuesDetailed(latitude, longitude),
    // City/State for the area, so results can show "City, ST" the way a
    // remembered course does. Every candidate is by definition nearby, so
    // one geocode covers the whole list rather than one call per result.
    fetchLocationDetails(latitude, longitude),
  ]);

  // An unreachable service is not the same as an empty area — telling a
  // golfer standing on a course that no courses are nearby would be wrong
  // and would hide the fact that recents and manual entry still work (§8).
  if (!reachable) return { status: LOOKUP_STATUS.UNAVAILABLE, courses: [] };

  const courses = venues
    .filter((v) => v.venue_type === 'course')
    .map((v) => toCourse({
      name: v.name,
      city: geocode?.city ?? null,
      state: geocode?.state ?? null,
      latitude: v.latitude,
      longitude: v.longitude,
      place_id: v.place_id,
      source: 'gps_place',
      distance_m: v.distance_m,
    }));

  return {
    status: courses.length ? LOOKUP_STATUS.OK : LOOKUP_STATUS.NO_RESULTS,
    courses,
  };
}

// Resolves the device position and looks up nearby courses in one step,
// distinguishing "location is off" from "nothing found" so the UI can say
// the right thing (§8).
export async function nearbyCoursesFromDevice() {
  const pos = await getCurrentPosition();
  if (!pos) return { status: LOOKUP_STATUS.NO_PERMISSION, courses: [] };
  return nearbyCourses(pos.latitude, pos.longitude);
}

// Nominatim returns a lot of things named "golf"; only an actual course is a
// place you can play a round.
function isGolfCourseResult(r) {
  return r?.class === 'leisure' && r?.type === 'golf_course';
}

// Nominatim's address object names the settlement differently depending on
// what kind of place it is.
function cityFromAddress(address) {
  if (!address) return null;
  return address.city || address.town || address.village || address.hamlet || address.suburb || null;
}

// Free-text course search by name or city (§11.4).
//
// Submit-driven and debounced by the caller, never search-as-you-type.
export async function searchCourses(query) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return { status: LOOKUP_STATUS.NO_RESULTS, courses: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=${SEARCH_LIMIT}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { status: LOOKUP_STATUS.UNAVAILABLE, courses: [] };

    const data = await res.json();
    if (!Array.isArray(data)) return { status: LOOKUP_STATUS.UNAVAILABLE, courses: [] };

    const courses = data
      .filter(isGolfCourseResult)
      .map((r) => toCourse({
        // Nominatim's display_name is a full postal path; the first segment
        // is the venue's own name.
        name: r.name || String(r.display_name || '').split(',')[0].trim(),
        city: cityFromAddress(r.address),
        state: r.address?.state ?? null,
        latitude: Number(r.lat),
        longitude: Number(r.lon),
        // Same "type/id" convention Overpass uses, so a course found by
        // search and the same course found by GPS are one record.
        place_id: r.osm_type && r.osm_id != null ? `${r.osm_type}/${r.osm_id}` : null,
        source: 'search',
      }))
      .filter((c) => c.name);

    return {
      status: courses.length ? LOOKUP_STATUS.OK : LOOKUP_STATUS.NO_RESULTS,
      courses,
    };
  } catch (e) {
    // Offline, aborted, DNS failure, malformed JSON — all the same to the
    // golfer, who still has recents and manual entry.
    return { status: LOOKUP_STATUS.UNAVAILABLE, courses: [] };
  } finally {
    clearTimeout(timer);
  }
}

// A course the golfer typed themselves. Deliberately not a lesser option and
// never presented as a fallback (§4.2) — it produces exactly the same record
// as every other origin, minus the provider identity it genuinely lacks.
export function manualCourse({ name, city = null, state = null }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return null;
  return toCourse({
    name: trimmed,
    city: city?.trim() || null,
    state: state?.trim() || null,
    source: 'manual',
  });
}
