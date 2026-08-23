// Glue layer between the pure weather.js API client and db.js: decides
// WHEN to fetch weather for the active session (immediately in the
// background on start, roughly every 45 minutes after that, or on manual
// request) and persists the result. Isolated from the UI — screens just
// call startWeatherTracking/stopWeatherTracking/refreshWeatherNow and
// listen for the 'rangelog:weather-updated' window event to know when to
// re-render. Every function here resolves without throwing.

import * as db from './db.js';
import { getCurrentPosition, fetchWeatherObservation } from './weather.js';

const AUTO_REFRESH_MS = 45 * 60 * 1000; // long sessions get a fresh reading periodically
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // how often we check whether a refresh is due

let trackedSessionId = null;
let checkTimer = null;
let fetching = false;

export function isFetchingWeather() {
  return fetching;
}

function notify(sessionId) {
  window.dispatchEvent(new CustomEvent('rangelog:weather-updated', { detail: { sessionId } }));
}

async function fetchAndSave(sessionId) {
  if (fetching) return;
  fetching = true;
  notify(sessionId);
  try {
    const pos = await getCurrentPosition();
    if (!pos) return; // permission denied / unavailable — session just stays without weather

    const observation = await fetchWeatherObservation(pos.latitude, pos.longitude);

    db.addWeatherObservation(sessionId, {
      timestamp: new Date().toISOString(),
      latitude: pos.latitude,
      longitude: pos.longitude,
      temperature_f: observation?.temperature_f ?? null,
      feels_like_f: observation?.feels_like_f ?? null,
      humidity_percent: observation?.humidity_percent ?? null,
      weather_condition: observation?.weather_condition ?? null,
      precipitation: observation?.precipitation ?? null,
      cloud_cover_percent: observation?.cloud_cover_percent ?? null,
      wind_speed_mph: observation?.wind_speed_mph ?? null,
      wind_gust_mph: observation?.wind_gust_mph ?? null,
      wind_direction_degrees: observation?.wind_direction_degrees ?? null,
      wind_direction_cardinal: observation?.wind_direction_cardinal ?? null,
    });
  } catch (e) {
    // Swallow — the session simply keeps whatever weather (or lack of it) it already had.
  } finally {
    fetching = false;
    notify(sessionId);
  }
}

function dueForRefresh(session) {
  if (!session.weather_timestamp) return true;
  const last = new Date(session.weather_timestamp).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= AUTO_REFRESH_MS;
}

// Call when a session becomes the active one (created, or resumed after a
// pause, or recovered on app boot). Fetches immediately only if there's no
// weather yet or the existing reading is stale; otherwise just arms the
// periodic check so a long session still gets refreshed roughly hourly.
export function startWeatherTracking(sessionId) {
  trackedSessionId = sessionId;

  const session = db.getSession(sessionId);
  if (session && dueForRefresh(session)) fetchAndSave(sessionId);

  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    if (!trackedSessionId) return;
    const s = db.getSession(trackedSessionId);
    if (s && dueForRefresh(s)) fetchAndSave(trackedSessionId);
  }, CHECK_INTERVAL_MS);
}

// Call when the session is paused or finished — no point polling weather
// for a session nobody is actively hitting balls in.
export function stopWeatherTracking() {
  trackedSessionId = null;
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

// User-initiated "Refresh Weather" — always fetches fresh, ignoring the
// auto-refresh throttle.
export function refreshWeatherNow(sessionId) {
  return fetchAndSave(sessionId);
}
