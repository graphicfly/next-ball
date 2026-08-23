// Storage layer. This is the ONLY module that touches localStorage — every
// screen goes through these functions so the backing store can later be
// swapped for IndexedDB or a synced backend without touching UI code.

export const STRIKE = ['solid', 'thin', 'topped', 'fat', 'shank', 'miss'];
export const DIRECTION = ['left', 'straight', 'right'];
export const HEIGHT = ['low', 'medium', 'high'];
export const SETUP = ['ground', 'tee'];
export const SURFACE = ['mat', 'grass'];
export const SWING = ['half', 'three-quarter', 'full'];
export const BALL_COUNT_PRESETS = [25, 30, 40, 50];
export const DEFAULT_BALL_COUNT = 50;
export const PRACTICE_FOCUS = ['Contact', 'Low Point', 'Grip', 'Rotation', 'Tempo', 'Distance', 'General Practice'];
export const DRILLS = ['Normal Swing', 'Low Point', 'Grip', 'Connection', 'Rotation', 'Tempo', 'Contact'];
export const DEFAULT_DRILL = 'Normal Swing';
export const CLUBS = [
  'Driver', '3W', '5W', '7W', 'Hybrid',
  '3i', '4i', '5i', '6i', '7i', '8i', '9i',
  'PW', 'GW', 'SW', 'LW', 'Putter',
];
export const DISTANCE_LABELS = ['50', '75', '100', '125', '150', '175', '200+'];
export const TARGET_DISTANCE_PRESETS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

// Distance-ladder presets keyed by swing_length — the Distance screen shows
// whichever list matches the shot's own swing length, so a Half-swing
// session doesn't force Enter Custom just to log a typical sub-50-yard
// shot. These are plain label strings, same format as DISTANCE_LABELS
// (full's own list, unchanged) — every value here is an ordinary number
// that round-trips through distanceLabelToYards/yardsToDistanceLabel
// exactly like 50-175 always have. Nothing about how distance_yards is
// stored changes; this only decides which numbers the UI offers as one-tap
// presets.
export const DISTANCE_PRESETS_BY_SWING = {
  half: ['10', '20', '30', '40', '50', '60', '75'],
  'three-quarter': ['25', '40', '50', '60', '75', '90', '100', '125'],
  full: DISTANCE_LABELS,
};

export function distancePresetsForSwing(swingLength) {
  return DISTANCE_PRESETS_BY_SWING[swingLength] || DISTANCE_PRESETS_BY_SWING.full;
}

// Training Aid answers "what physical tool was I using" — deliberately
// independent of Drill ("what was I practicing"). A shot can carry both a
// drill and a training aid at once (e.g. the Low Point drill while using a
// Connection Ball); neither one ever sets or clears the other. Modeled the
// same way as DRILLS/DEFAULT_DRILL (a real 'none' enum value, not null) —
// keeps this consistent with the project's other session-context fields
// rather than introducing a new nullable-field convention.
export const TRAINING_AIDS = ['none', 'connection_ball', 'strike_wedge', 'alignment_stick', 'divot_board', 'other'];
export const DEFAULT_TRAINING_AID = 'none';
export const TRAINING_AID_LABELS = {
  none: 'None',
  connection_ball: 'Connection Ball',
  strike_wedge: 'Strike Wedge',
  alignment_stick: 'Alignment Stick',
  divot_board: 'Divot Board',
  other: 'Other',
};

// Normalizes a shot's training_aid for display/analytics — shots saved
// before this field existed simply lack the key, and this is the one place
// that gap is papered over, same pattern as sessionDataSource() above.
export function shotTrainingAid(shot) {
  return shot?.training_aid || DEFAULT_TRAINING_AID;
}

// 'real' (an actual range session logged through the normal UI) or 'test'
// (a simulated/seeded session — only test/generator.js's persistGenerated()
// ever passes 'test' explicitly). Sessions saved before this field existed
// have no data_source key at all; sessionDataSource() below is the single
// place that normalizes that gap, so the fallback logic never has to be
// duplicated at each call site.
export const DATA_SOURCES = ['real', 'test'];

export function sessionDataSource(session) {
  return session?.data_source === 'test' ? 'test' : 'real';
}

// Which tier of the location-resolution hierarchy produced a session's
// location_name (see sessionLocation.js). 'unknown' is the default for a
// session location resolution hasn't finished (or ever ran) for — including
// every session saved before this feature existed, which simply lack the
// field entirely.
export const LOCATION_SOURCES = ['gps_place', 'remembered', 'manual', 'reverse_geocode', 'unknown'];

export function sessionLocationSource(session) {
  return session?.location_source && LOCATION_SOURCES.includes(session.location_source) ? session.location_source : 'unknown';
}

// Primary/secondary display pair used consistently by History, Session
// Summary, and Session Details — primary is whatever's currently the best
// available name (venue or city/state or null); secondary is the city/state
// line shown UNDER a venue name, but only when it adds information a reader
// doesn't already have (skipped if there's no venue, or if location_name IS
// already just the city/state string).
export function sessionLocationDisplay(session) {
  const primary = session?.location_name || null;
  const cityState = session?.location_city && session?.location_state
    ? `${session.location_city}, ${session.location_state}`
    : session?.location_city || session?.location_state || null;
  const hasVenue = primary && cityState && primary !== cityState;
  return { primary, secondary: hasVenue ? cityState : null };
}

export function distanceLabelToYards(label) {
  if (label === 'Unknown') return null;
  if (label === '<40') return 39;
  if (label === '180+') return 181;
  if (label === '200+') return 201;
  const n = Number(label);
  return Number.isFinite(n) ? n : null;
}

// yards is always a raw stored number — either a discrete ladder tap
// (50/75/.../175, or the 201 sentinel for "200+"), a free-typed custom
// value from Enter Custom, or one of the two legacy sentinels (39 for the
// old picker's "<40", 181 for its "180+") from shots logged before this
// screen existed. Only the known sentinels collapse to a bucket label —
// everything else (including any custom-typed value like 185) round-trips
// as its own exact number, so history/CSV never loses precision.
export function yardsToDistanceLabel(yards) {
  if (yards === null || yards === undefined) return 'Unknown';
  // Only the exact legacy sentinel collapses to a bucket label — a custom
  // value that happens to also be under 40 (e.g. a chunked wedge shot typed
  // as "12") must round-trip as its own precise number, not get swallowed
  // into the same "<40" bucket as genuinely-unknown legacy data.
  if (yards === 39) return '<40';
  if (yards === 181) return '180+';
  if (yards === 201) return '200+';
  return String(yards);
}

// ---------- Storage ----------
//
// Data lives in TWO kinds of localStorage entries rather than one giant
// blob:
//   - INDEX_KEY: session metadata + settings ONLY (no shots embedded).
//     Small, and stays small regardless of how many shots a golfer has
//     ever logged — it only grows with session COUNT, not shot count.
//   - one shotsKeyFor(sessionId) entry per session, holding just that
//     session's own shots.
//
// Why: the original single-blob design re-serialized EVERY shot ever
// logged on every single addShot()/updateShot() call, so logging a shot
// got slower forever as a golfer's total history grew — measured at ~190
// seconds to log a session once total lifetime shots reached 25,000. With
// chunking, logging a shot only ever touches that one session's (bounded,
// ~50-200 shot) chunk, so it stays fast regardless of history size.
//
// The public shape (getDB()/exportFullDB() returning {sessions, shots,
// settings}, and importFullDB() accepting that same shape) is unchanged —
// only this internal representation differs — so every caller outside this
// file, and the JSON backup format, stay exactly the same.
const INDEX_KEY = 'rangelog_index_v1';
const shotsKeyFor = (sessionId) => `rangelog_shots_v1_${sessionId}`;

let _index = null; // { schemaVersion, sessions: [...], settings: {} }
const _shotsCache = new Map(); // session_id -> shots array, lazily loaded from its own key

function nowISO() {
  return new Date().toISOString();
}

// Full ISO-8601 datetime with the local timezone offset (e.g.
// "2026-08-17T14:23:01.456-04:00") rather than UTC, so a shot's recorded
// time reads correctly for the golfer's own clock.
function formatISOLocal(d) {
  const pad = (n, len = 2) => String(Math.abs(n)).padStart(len, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offM = pad(Math.abs(offsetMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${offH}:${offM}`
  );
}

function nowISOLocal() {
  return formatISOLocal(new Date());
}

// Guarantees each shot's timestamp is strictly later than the previous shot
// in the same session, even if two addShot() calls land in the same
// millisecond (real one-handed UI taps never do — the "Saved" flash alone
// takes 380ms — but a bulk import/seed path could). Nudges forward by 1ms
// rather than reusing the wall clock when needed.
function nextShotTimestamp(previousShotTimestamp) {
  const now = new Date();
  if (!previousShotTimestamp) return formatISOLocal(now);
  const prevMs = new Date(previousShotTimestamp).getTime();
  if (!Number.isFinite(prevMs) || now.getTime() > prevMs) return formatISOLocal(now);
  return formatISOLocal(new Date(prevMs + 1));
}

function uuid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function defaultIndex() {
  return {
    schemaVersion: 2,
    sessions: [],
    settings: { lastClub: null, lastSetup: 'ground', lastSurface: 'mat', lastSwing: 'full', lastBallCount: DEFAULT_BALL_COUNT, lastKnownLocation: null, theme: 'dark' },
  };
}

function loadIndex() {
  if (_index) return _index;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    _index = raw ? JSON.parse(raw) : defaultIndex();
    if (!Array.isArray(_index.sessions)) _index.sessions = [];
    if (!_index.settings || typeof _index.settings !== 'object') _index.settings = {};
  } catch (e) {
    console.error('Next Ball: failed to load local data, starting fresh', e);
    _index = defaultIndex();
  }
  return _index;
}

// Returns whether the write actually succeeded — callers that need to know
// (delete/restore, where silently pretending success would misreport a
// destructive action) check this; every pre-existing caller ignores the
// return value exactly as before, so this is a non-breaking addition.
function saveIndex() {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(_index));
    return true;
  } catch (e) {
    console.error('Next Ball: failed to save local data', e);
    return false;
  }
}

// Lazily loads (and caches in memory) one session's shots from its own
// localStorage key — never the whole database. A session with no shots yet
// (or that doesn't exist) simply yields an empty array.
function loadShotsChunk(sessionId) {
  if (_shotsCache.has(sessionId)) return _shotsCache.get(sessionId);
  let shots = [];
  try {
    const raw = localStorage.getItem(shotsKeyFor(sessionId));
    shots = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(shots)) shots = [];
  } catch (e) {
    console.error('Next Ball: failed to load shots for a session, starting that session empty', e);
    shots = [];
  }
  _shotsCache.set(sessionId, shots);
  return shots;
}

function saveShotsChunk(sessionId) {
  try {
    localStorage.setItem(shotsKeyFor(sessionId), JSON.stringify(_shotsCache.get(sessionId) || []));
    return true;
  } catch (e) {
    console.error('Next Ball: failed to save shots for a session', e);
    return false;
  }
}

// Test-only seam: loadIndex()/loadShotsChunk() cache in module scope for the
// process lifetime, so clearing localStorage alone doesn't isolate tests
// from each other. This forces the next load to re-read from (cleared)
// storage. Not called anywhere in the app itself — has zero effect on any
// existing function's behavior.
export function __resetForTests() {
  _index = null;
  _shotsCache.clear();
}

// Reassembles the old flat {sessions, shots, settings} shape from the index
// + every session's chunk. Only used by the Settings screen's storage-stats
// display and exportFullDB() — both rare, not-time-critical reads, so
// loading everything here is an acceptable, deliberate trade-off.
export function getDB() {
  const index = loadIndex();
  const shots = [];
  for (const s of index.sessions) shots.push(...loadShotsChunk(s.session_id));
  return { schemaVersion: index.schemaVersion, sessions: index.sessions, shots, settings: index.settings };
}

// ---------- Sessions ----------

export function createSession(fields) {
  const index = loadIndex();
  const ts = nowISO();
  const session = {
    session_id: uuid(),
    date: fields.date,
    start_time: fields.start_time,
    end_time: null,
    // Weather is never known at creation time — it's fetched in the
    // background right after the session starts (see sessionWeather.js) and
    // patched in via addWeatherObservation(). Every field here stays
    // nullable so a failed/denied lookup never breaks anything downstream.
    latitude: null,
    longitude: null,
    // location_name is the best available display name — a venue name once
    // resolved, or a "City, ST" fallback string, or null. location_city/
    // location_state are kept separately so a venue name and its city/state
    // can both be shown at once (see sessionLocationDisplay()) — the same
    // fetch that resolves either fills all three. location_source records
    // WHICH of the location-resolution hierarchy's tiers actually produced
    // location_name, so once it's anything but 'unknown' it's never
    // silently overwritten by GPS drift or a later background refresh (see
    // sessionLocation.js). location_place_id is an OSM "type/id" string when
    // the venue came from a live lookup — purely informational, nothing
    // else in the app requires it to function. location_candidates holds a
    // pending multi-venue choice (see sessionLocation.js) until the golfer
    // resolves it or it's superseded; empty once resolved.
    location_name: null,
    location_city: null,
    location_state: null,
    location_source: 'unknown',
    location_place_id: null,
    location_candidates: [],
    weather_timestamp: null,
    temperature_f: null,
    feels_like_f: null,
    humidity_percent: null,
    weather_condition: null,
    precipitation: null,
    cloud_cover_percent: null,
    wind_speed_mph: null,
    wind_gust_mph: null,
    wind_direction_degrees: null,
    wind_direction_cardinal: null,
    // Full history of observations for this session, oldest first — the
    // flat fields above always mirror the newest entry for fast access.
    weather_observations: [],
    target_ball_count: fields.target_ball_count,
    default_club: fields.default_club,
    default_setup: fields.default_setup,
    default_surface: fields.default_surface,
    default_swing: fields.default_swing,
    // Tracks the club/setup/surface/swing to apply to the *next* shot — starts
    // equal to the defaults above but can change mid-session without rewriting them.
    current_club: fields.default_club,
    current_setup: fields.default_setup,
    current_surface: fields.default_surface,
    current_swing: fields.default_swing,
    // Drill has no "starting" picker on the Start Session screen — every
    // session simply begins on the default drill until changed mid-session.
    current_drill: DEFAULT_DRILL,
    // Same idea as current_drill — no starting picker, begins off until set
    // via the Active screen's Training Aid chip. Independent of current_drill:
    // changing one never touches the other.
    current_training_aid: DEFAULT_TRAINING_AID,
    // Optional, off by default — set via the Active screen's Target chip.
    // While set, it's stamped onto every new shot just like club/setup/drill.
    current_target_distance: null,
    practice_focus: fields.practice_focus ?? [],
    session_notes: fields.session_notes ?? '',
    // End-of-session check-in — optional, filled in (or skipped) on the
    // Session Check-In screen right after Finish Session.
    fatigue_rating: null,
    hand_discomfort_rating: null,
    elbow_discomfort_rating: null,
    status: 'active',
    // Automatic — the real UI never passes this, so every session created
    // through the normal range-session flow is 'real' with no user action.
    // Only the test-fixture generator explicitly opts into 'test'.
    data_source: fields.data_source === 'test' ? 'test' : 'real',
    created_at: ts,
    updated_at: ts,
  };
  index.sessions.push(session);
  saveIndex();
  return session;
}

export function updateSession(sessionId, patch) {
  const index = loadIndex();
  const s = index.sessions.find((s) => s.session_id === sessionId);
  if (!s) return null;
  Object.assign(s, patch, { updated_at: nowISO() });
  saveIndex();
  return s;
}

// location_name deliberately excluded — venue/location resolution is now
// its own one-shot pipeline (see sessionLocation.js) so a session's
// resolved location never gets silently overwritten by a later recurring
// weather refresh. latitude/longitude stay mirrored here since each fresh
// weather reading is still a perfectly good "device's current position"
// update in its own right.
const WEATHER_MIRROR_FIELDS = [
  'latitude', 'longitude',
  'temperature_f', 'feels_like_f', 'humidity_percent', 'weather_condition', 'precipitation', 'cloud_cover_percent',
  'wind_speed_mph', 'wind_gust_mph', 'wind_direction_degrees', 'wind_direction_cardinal',
];

// Appends a weather observation (see sessionWeather.js for the shape) and
// mirrors it onto the session's flat fields for fast/CSV access, while
// keeping every prior observation (including the original session-start
// one) in weather_observations for later analysis.
//
// A failed refresh attempt (one that found nothing at all — e.g. offline)
// is still recorded in the history, but never blanks out a previously
// successful reading: the flat display fields only advance when the new
// observation actually contains at least some data.
export function addWeatherObservation(sessionId, observation) {
  const index = loadIndex();
  const s = index.sessions.find((s) => s.session_id === sessionId);
  if (!s) return null;
  if (!Array.isArray(s.weather_observations)) s.weather_observations = [];
  s.weather_observations.push(observation);

  const hasAnyData = WEATHER_MIRROR_FIELDS.some((f) => observation[f] !== null && observation[f] !== undefined);
  if (hasAnyData) {
    for (const f of WEATHER_MIRROR_FIELDS) {
      if (observation[f] !== null && observation[f] !== undefined) s[f] = observation[f];
    }
    s.weather_timestamp = observation.timestamp ?? s.weather_timestamp ?? null;
  }
  s.updated_at = nowISO();
  saveIndex();
  return s;
}

// Sets a session's resolved location — the ONLY function that should write
// location_name/location_city/location_state/location_source/
// location_place_id (see sessionLocation.js, which is the sole caller other
// than the Location-editor sheets). Always clears location_candidates,
// since a resolution (of any source, including a fresh candidate list
// itself — see setSessionLocationCandidates) supersedes whatever was
// pending. Does NOT check location_source before overwriting — callers are
// responsible for the "already resolved, don't touch it again" guard (see
// sessionLocation.js's shouldResolveLocation), since a MANUAL correction
// must always be allowed through regardless of the current source.
export function setSessionLocation(sessionId, { location_name = null, location_city = null, location_state = null, location_source = 'unknown', location_place_id = null } = {}) {
  return updateSession(sessionId, {
    location_name, location_city, location_state, location_source, location_place_id,
    location_candidates: [],
  });
}

// A pending multi-venue choice — never a resolution on its own. The golfer
// stays fully unblocked either way (see sessionLocation.js); this only
// feeds the Location-editor sheet's candidate list next time it's opened.
export function setSessionLocationCandidates(sessionId, candidates) {
  return updateSession(sessionId, { location_candidates: Array.isArray(candidates) ? candidates : [] });
}

// ---------- Remembered venues ----------
// A small local list of venues the golfer has actually confirmed being at
// (auto-selected with high confidence, or manually chosen) — lets a return
// visit skip a fresh network lookup entirely (see sessionLocation.js) and
// keeps working offline. Capped to the most recent N so this can't grow
// unbounded over a season; matching is by GPS proximity, never by exact
// coordinates, since "dozens of feet" of drift between visits is normal.
const MAX_REMEMBERED_VENUES = 25;
const REMEMBER_RADIUS_M = 400;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getRememberedVenues() {
  const list = getSettings().rememberedVenues;
  return Array.isArray(list) ? list : [];
}

// Upserts by name (case-insensitive) within remembering radius of the given
// coordinates, so re-confirming the same venue on a later visit updates its
// remembered coordinates/name rather than piling up duplicate entries.
export function rememberVenue({ latitude, longitude, location_name, location_city, location_state, location_place_id }) {
  if (latitude == null || longitude == null || !location_name) return;
  const list = getRememberedVenues();
  const existingIdx = list.findIndex((v) =>
    v.location_name.toLowerCase() === location_name.toLowerCase() &&
    haversineMeters(v.latitude, v.longitude, latitude, longitude) <= REMEMBER_RADIUS_M
  );
  const entry = { latitude, longitude, location_name, location_city: location_city ?? null, location_state: location_state ?? null, location_place_id: location_place_id ?? null, remembered_at: nowISO() };
  let next;
  if (existingIdx !== -1) {
    next = [...list];
    next[existingIdx] = entry;
  } else {
    next = [entry, ...list].slice(0, MAX_REMEMBERED_VENUES);
  }
  updateSettings({ rememberedVenues: next });
}

// Nearest remembered venue within range, or null. Pure local lookup — no
// network — so this is what keeps a returning golfer's regular course
// working offline (see section 34 of the spec this implements).
export function findRememberedVenue(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  const list = getRememberedVenues();
  let best = null;
  let bestDist = Infinity;
  for (const v of list) {
    const d = haversineMeters(v.latitude, v.longitude, latitude, longitude);
    if (d <= REMEMBER_RADIUS_M && d < bestDist) { best = v; bestDist = d; }
  }
  return best;
}

export function finishSession(sessionId) {
  return updateSession(sessionId, { status: 'finished', end_time: new Date().toTimeString().slice(0, 5) });
}

// Session Check-In — each rating is independently optional; pass null/undefined to leave unset.
export function setSessionCheckIn(sessionId, { fatigue_rating, hand_discomfort_rating, elbow_discomfort_rating }) {
  return updateSession(sessionId, {
    fatigue_rating: fatigue_rating ?? null,
    hand_discomfort_rating: hand_discomfort_rating ?? null,
    elbow_discomfort_rating: elbow_discomfort_rating ?? null,
  });
}

export function pauseSession(sessionId) {
  return updateSession(sessionId, { status: 'paused' });
}

export function resumeSession(sessionId) {
  return updateSession(sessionId, { status: 'active' });
}

export function getSession(id) {
  return loadIndex().sessions.find((s) => s.session_id === id) || null;
}

export function getActiveSession() {
  return loadIndex().sessions.find((s) => s.status === 'active' || s.status === 'paused') || null;
}

// Newest-first by created_at. Ties (created_at has only millisecond
// resolution, so a burst of sessions created in rapid succession — e.g. a
// test fixture loop, or a bulk import — can genuinely collide) break by
// original array position rather than left arbitrary: sessions is only ever
// appended to, so a later index is always the truly-later creation.
export function listSessions() {
  const arr = loadIndex().sessions;
  return arr
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.created_at || '').localeCompare(a.s.created_at || '') || b.i - a.i)
    .map((x) => x.s);
}

export function listFinishedSessions() {
  return listSessions().filter((s) => s.status === 'finished');
}

// Permanently deletes one session and every shot belonging to it, keyed
// strictly by session_id (never by date or shot number, since neither is
// unique). Returns null if the session doesn't exist. Throws an Error with
// a `.code` on failure so callers can distinguish and react per case:
//   - 'active_session': refuses to delete an in-progress session — this
//     feature is for completed history only. The UI never offers delete for
//     a non-finished session, so this is a defensive backstop, not a normal
//     path.
//   - 'storage_error': the index write itself failed. Nothing is touched —
//     see the ordering note below — so the session and its shots are still
//     fully intact and the caller should show a failure state, not remove
//     anything from the UI.
//
// Ordering: the index (session record) is removed and saved FIRST. Only
// once that succeeds is the shot chunk removed. This means the only
// possible partial-failure outcome is an orphaned shots-chunk key lingering
// in localStorage after a successful session removal — harmless, since
// getDB()/getAllShots()/getShotsForSession() only ever reach a session's
// chunk by walking the index, so an orphaned chunk with no index entry is
// simply never read by anything. The reverse order would risk the opposite,
// user-visible failure: a session that still appears in History but shows
// zero shots.
export function deleteSession(sessionId) {
  const index = loadIndex();
  const idx = index.sessions.findIndex((s) => s.session_id === sessionId);
  if (idx === -1) return null;

  const removedSession = index.sessions[idx];
  if (removedSession.status === 'active' || removedSession.status === 'paused') {
    throw Object.assign(new Error('Cannot delete an in-progress session'), { code: 'active_session' });
  }

  const shots = getShotsForSession(sessionId); // snapshot before removal, for the caller's undo/records

  index.sessions.splice(idx, 1);
  if (!saveIndex()) {
    index.sessions.splice(idx, 0, removedSession); // roll back the in-memory removal — nothing was actually persisted
    throw Object.assign(new Error('Failed to delete session'), { code: 'storage_error' });
  }

  try {
    localStorage.removeItem(shotsKeyFor(sessionId));
  } catch (e) {
    console.error('Next Ball: session deleted, but failed to clean up its shot data (harmless orphaned key)', e);
  }
  _shotsCache.delete(sessionId);

  return { session: removedSession, shots };
}

// Re-inserts a session and its shots exactly as returned by deleteSession(),
// for the brief Undo window after a delete. Not a general "recreate a
// session" API — trusts the caller to pass back exactly what was removed.
// Returns false (without throwing) if a session with that id already exists
// again (nothing to do) or if the write fails, so the caller can show a
// simple "Couldn't undo" message rather than crash.
export function restoreSession(session, shots) {
  const index = loadIndex();
  if (index.sessions.some((s) => s.session_id === session.session_id)) return false;

  index.sessions.push(session);
  if (!saveIndex()) {
    index.sessions.pop();
    return false;
  }

  _shotsCache.set(session.session_id, shots);
  saveShotsChunk(session.session_id);
  return true;
}

// Deletes every session whose data_source is strictly 'test' (never by
// date, name, shot count, or any other heuristic) and their shots. Sessions
// with no data_source at all, or any value other than exactly 'test', are
// real and are never touched. Per-session failures are collected rather
// than aborting the whole batch, so one bad write can't leave the rest
// undeleted.
export function deleteAllTestSessions() {
  const targets = loadIndex().sessions.filter((s) => sessionDataSource(s) === 'test').map((s) => s.session_id);
  let deleted = 0;
  const failed = [];
  for (const id of targets) {
    try {
      if (deleteSession(id)) deleted++;
    } catch (e) {
      failed.push(id);
    }
  }
  return { deleted, failed, total: targets.length };
}

// ---------- Shots ----------

export function addShot(sessionId, fields) {
  const shotsForSession = loadShotsChunk(sessionId);
  const shot_number = shotsForSession.length + 1;
  const ts = nowISO();
  // Shots are always appended to this list in increasing shot_number order
  // (never reordered), so the last entry is always the most recent shot.
  const previousShotTimestamp = shotsForSession.length ? shotsForSession[shotsForSession.length - 1].shot_timestamp : null;
  const shot = {
    shot_id: uuid(),
    session_id: sessionId,
    shot_number,
    // Recorded automatically the instant the completed shot is saved — never
    // touched again by an edit, and never something the UI passes in.
    shot_timestamp: nextShotTimestamp(previousShotTimestamp),
    club: fields.club,
    setup: fields.setup,
    surface: fields.surface,
    swing_length: fields.swing_length,
    drill: fields.drill ?? null,
    target_distance_yards: fields.target_distance_yards ?? null,
    training_aid: fields.training_aid ?? DEFAULT_TRAINING_AID,
    strike: fields.strike,
    direction: fields.direction,
    height: fields.height,
    distance_yards: fields.distance_yards,
    shot_note: fields.shot_note ?? '',
    created_at: ts,
    updated_at: ts,
  };
  shotsForSession.push(shot);
  saveShotsChunk(sessionId);
  return shot;
}

// sessionId is required so only that one session's chunk needs to be
// loaded/saved — every caller already has it on hand from the shot object
// it's editing (shot.session_id).
export function updateShot(sessionId, shotId, patch) {
  const shots = loadShotsChunk(sessionId);
  const sh = shots.find((s) => s.shot_id === shotId);
  if (!sh) return null;
  Object.assign(sh, patch, { updated_at: nowISO() });
  saveShotsChunk(sessionId);
  return sh;
}

export function deleteLastShot(sessionId) {
  const shotsForSession = loadShotsChunk(sessionId);
  if (shotsForSession.length === 0) return null;
  let last = shotsForSession[0];
  for (const s of shotsForSession) if (s.shot_number > last.shot_number) last = s;
  _shotsCache.set(sessionId, shotsForSession.filter((s) => s.shot_id !== last.shot_id));
  saveShotsChunk(sessionId);
  return last;
}

export function getShotsForSession(sessionId) {
  const shots = loadShotsChunk(sessionId);
  return [...shots].sort((a, b) => a.shot_number - b.shot_number);
}

export function getLastShot(sessionId) {
  const shots = getShotsForSession(sessionId);
  return shots.length ? shots[shots.length - 1] : null;
}

// Loads every session's chunk — a genuinely O(total history) read, used
// only by Trends (club list, unfiltered chart) and CSV export, neither of
// which run on the shot-logging hot path.
export function getAllShots() {
  const index = loadIndex();
  const shots = [];
  for (const s of index.sessions) shots.push(...loadShotsChunk(s.session_id));
  return shots;
}

// ---------- Settings ----------

export function getSettings() {
  return loadIndex().settings;
}

export function updateSettings(patch) {
  const index = loadIndex();
  index.settings = { ...index.settings, ...patch };
  saveIndex();
  return index.settings;
}

// ---------- Backup / restore ----------

export function exportFullDB() {
  return JSON.parse(JSON.stringify(getDB()));
}

export function importFullDB(obj) {
  if (!obj || !Array.isArray(obj.sessions) || !Array.isArray(obj.shots)) {
    throw new Error('That file does not look like a Next Ball backup.');
  }
  // Clear out chunks for any session that won't exist after this import
  // (e.g. importing an older/smaller backup) so nothing orphaned lingers.
  const incomingIds = new Set(obj.sessions.map((s) => s.session_id));
  for (const s of loadIndex().sessions) {
    if (!incomingIds.has(s.session_id)) {
      try { localStorage.removeItem(shotsKeyFor(s.session_id)); } catch (e) { /* best-effort cleanup */ }
    }
  }

  _index = {
    schemaVersion: obj.schemaVersion || 1,
    sessions: obj.sessions,
    settings: obj.settings || defaultIndex().settings,
  };
  _shotsCache.clear();
  saveIndex();

  const shotsBySession = new Map();
  for (const sh of obj.shots) {
    let list = shotsBySession.get(sh.session_id);
    if (!list) { list = []; shotsBySession.set(sh.session_id, list); }
    list.push(sh);
  }
  for (const s of obj.sessions) {
    _shotsCache.set(s.session_id, shotsBySession.get(s.session_id) || []);
    saveShotsChunk(s.session_id);
  }

  return getDB();
}
