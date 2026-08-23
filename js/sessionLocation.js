// Glue layer between places.js/weather.js and db.js — decides WHEN to
// resolve a session's venue and persists the result. Deliberately NOT a
// recurring poller like sessionWeather.js: venue lookup happens at most
// ONCE per session (see db.js's location_source gate below), since a
// session's location should stay stable once known, and repeated
// nearby-place lookups would be wasted network calls for something that
// physically doesn't change mid-session. Every function here resolves
// without throwing — venue lookup can never block or break session/shot
// logging.

import * as db from './db.js';
import { getCurrentPosition, fetchLocationDetails } from './weather.js';
import { fetchNearbyGolfVenues, resolveVenueConfidence } from './places.js';

let resolvingSessionId = null;

function notify(sessionId) {
  window.dispatchEvent(new CustomEvent('rangelog:location-updated', { detail: { sessionId } }));
}

// The one place anything that needs "this session's coordinates, whatever
// it takes" should go through — used by both startLocationResolution below
// and locationSheet.js's manual-save flow. Returns the session's own
// latitude/longitude if already known (no network); otherwise fetches a
// fresh GPS fix and persists it onto the session before returning, so a
// caller that needs coordinates to remember a venue by (see db.js's
// rememberVenue) never silently comes up empty just because nothing had
// asked for a position yet. Returns null only if GPS itself is unavailable.
export async function ensureSessionPosition(session) {
  if (session.latitude != null && session.longitude != null) {
    return { latitude: session.latitude, longitude: session.longitude };
  }
  const pos = await getCurrentPosition();
  if (!pos) return null;
  db.updateSession(session.session_id, { latitude: pos.latitude, longitude: pos.longitude });
  return pos;
}

// Only 'unknown' (never resolved, including every session saved before
// this feature existed) is eligible — 'manual'/'gps_place'/'remembered'/
// 'reverse_geocode' are all treated as settled, per the "session location
// should stay stable" requirement. This is the single gate that makes
// startLocationResolution safe to call from every session-start/resume
// site without needing each call site to reason about whether it's
// appropriate right now.
function shouldResolve(session) {
  return db.sessionLocationSource(session) === 'unknown';
}

// Call whenever a session becomes the active one (created, resumed after a
// pause, or recovered on app boot) — same call sites as
// startWeatherTracking. No-ops instantly (no network) if the session
// already has ANY resolved location, or if a resolution is already in
// flight for it.
export async function startLocationResolution(sessionId) {
  const session = db.getSession(sessionId);
  if (!session || !shouldResolve(session)) return;
  if (resolvingSessionId === sessionId) return;
  resolvingSessionId = sessionId;

  try {
    // Also stamps latitude/longitude onto the session as a first-class fact
    // (see ensureSessionPosition above) — no longer dependent on weather.js
    // ever successfully fetching, which used to be the only thing that set
    // them (see db.js's addWeatherObservation mirroring).
    const pos = await ensureSessionPosition(session);
    if (!pos) return; // permission denied/unavailable — stays 'unknown', never blocks shot logging

    // Tier: remembered venue. Purely local, no network — this is what lets
    // a golfer's regular course keep working even fully offline.
    const remembered = db.findRememberedVenue(pos.latitude, pos.longitude);
    if (remembered) {
      db.setSessionLocation(sessionId, {
        location_name: remembered.location_name,
        location_city: remembered.location_city,
        location_state: remembered.location_state,
        location_source: 'remembered',
        location_place_id: remembered.location_place_id,
      });
      notify(sessionId);
      return;
    }

    // Tier: live lookup. Venue search and city/state geocode run together —
    // city/state is useful either way (secondary text under a venue name,
    // or the fallback name itself if no venue is found/confident).
    const [venues, geocode] = await Promise.all([
      fetchNearbyGolfVenues(pos.latitude, pos.longitude),
      fetchLocationDetails(pos.latitude, pos.longitude),
    ]);

    const result = resolveVenueConfidence(venues);
    if (result.decision === 'auto') {
      db.setSessionLocation(sessionId, {
        location_name: result.venue.name,
        location_city: geocode.city,
        location_state: geocode.state,
        location_source: 'gps_place',
        location_place_id: result.venue.place_id,
      });
      db.rememberVenue({
        latitude: pos.latitude, longitude: pos.longitude,
        location_name: result.venue.name, location_city: geocode.city, location_state: geocode.state,
        location_place_id: result.venue.place_id,
      });
    } else {
      // 'ambiguous' (multiple plausible venues) or 'none' (nothing nearby):
      // city/state is the best AUTOMATIC answer either way — venue lookup
      // only runs once per session (see shouldResolve above), so this is
      // the last automatic word on it, but 'ambiguous' candidates stay
      // available for the golfer to resolve manually any time via the
      // Location editor, which reads location_candidates independently of
      // location_source.
      if (geocode.combined) {
        db.setSessionLocation(sessionId, { location_name: geocode.combined, location_city: geocode.city, location_state: geocode.state, location_source: 'reverse_geocode' });
      }
      if (result.decision === 'ambiguous') db.setSessionLocationCandidates(sessionId, result.candidates);
    }

    const resolved = db.getSession(sessionId);
    if (resolved?.location_name) {
      db.updateSettings({ lastKnownLocation: { latitude: pos.latitude, longitude: pos.longitude, location_name: resolved.location_name } });
    }
    notify(sessionId);
  } catch (e) {
    // Swallow — session simply keeps whatever location (or lack of it) it already had.
  } finally {
    if (resolvingSessionId === sessionId) resolvingSessionId = null;
  }
}
