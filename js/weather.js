// Pure location + weather API client. Deliberately has NO dependency on
// db.js or any Next Ball concept — it just answers "where am I" and "what's
// the weather there," so the provider can be swapped later (or a
// serverless proxy inserted in front of it) without touching the rest of
// the app. See sessionWeather.js for how Next Ball wires this into sessions.
//
// Every exported function resolves (never throws/rejects) so a permissions
// denial, a slow/unreachable API, or being offline can NEVER block or break
// session/shot logging.

const WMO_CONDITIONS = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
  80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

// Centralizing the unit choice here means adding a future Celsius/km-h
// option only touches this object and the query string below — the
// observation shape and the rest of the app stay the same either way.
const UNITS = { temperature: 'fahrenheit', wind: 'mph', precipitation: 'inch' };

const CACHE_TTL_MS = 10 * 60 * 1000; // avoid re-fetching the same spot back-to-back
const _weatherCache = new Map(); // "lat,lon" (rounded) -> { at, data }
const _geocodeCache = new Map();

function cacheKeyFor(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          // ~11m precision — "reasonable precision" without excess false detail.
          latitude: Math.round(pos.coords.latitude * 10000) / 10000,
          longitude: Math.round(pos.coords.longitude * 10000) / 10000,
        }),
        () => resolve(null), // denied, unavailable, or timed out
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
      );
    } catch (e) {
      resolve(null);
    }
  });
}

async function fetchJSON(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    // Must run on every path, not just success — a rejected fetch (offline,
    // DNS failure) previously skipped this entirely, leaving the timer
    // pending for the full timeout window for no reason.
    clearTimeout(t);
  }
}

function cardinalFromDegrees(deg) {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// Returns a plain observation object (all fields nullable) or null if the
// lookup failed outright. Never throws.
export async function fetchWeatherObservation(lat, lon) {
  const key = cacheKeyFor(lat, lon);
  const cached = _weatherCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m` +
    `&temperature_unit=${UNITS.temperature}&wind_speed_unit=${UNITS.wind}&precipitation_unit=${UNITS.precipitation}`;
  const data = await fetchJSON(url, 7000);
  if (!data || !data.current) return null;
  const c = data.current;

  const observation = {
    temperature_f: typeof c.temperature_2m === 'number' ? Math.round(c.temperature_2m) : null,
    feels_like_f: typeof c.apparent_temperature === 'number' ? Math.round(c.apparent_temperature) : null,
    humidity_percent: typeof c.relative_humidity_2m === 'number' ? Math.round(c.relative_humidity_2m) : null,
    weather_condition: WMO_CONDITIONS[c.weather_code] || null,
    precipitation: typeof c.precipitation === 'number' ? c.precipitation : null,
    cloud_cover_percent: typeof c.cloud_cover === 'number' ? Math.round(c.cloud_cover) : null,
    wind_speed_mph: typeof c.wind_speed_10m === 'number' ? Math.round(c.wind_speed_10m) : null,
    // Store null rather than 0 when the API simply didn't return a gust value.
    wind_gust_mph: typeof c.wind_gusts_10m === 'number' ? Math.round(c.wind_gusts_10m) : null,
    wind_direction_degrees: typeof c.wind_direction_10m === 'number' ? Math.round(c.wind_direction_10m) : null,
    wind_direction_cardinal: cardinalFromDegrees(c.wind_direction_10m),
  };
  _weatherCache.set(key, { at: Date.now(), data: observation });
  return observation;
}

// City/state reverse geocoding — administrative-boundary lookup only, never
// venue/POI names (that's places.js's job, a fundamentally different kind
// of API). Returns { city, state, combined } so callers needing venue-name
// + city/state together (sessionLocation.js) can use city/state as
// secondary text, while callers only wanting the old single-string
// behavior can just use .combined.
export async function fetchLocationDetails(lat, lon) {
  const key = cacheKeyFor(lat, lon);
  const cached = _geocodeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const data = await fetchJSON(url, 6000);
  if (!data) return { city: null, state: null, combined: null };
  const city = data.city || data.locality || null;
  const state = data.principalSubdivisionCode ? data.principalSubdivisionCode.split('-').pop() : data.principalSubdivision || null;
  const combined = city && state ? `${city}, ${state}` : city || state || null;
  const result = { city, state, combined };
  _geocodeCache.set(key, { at: Date.now(), data: result });
  return result;
}
