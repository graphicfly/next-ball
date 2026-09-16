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
// Course Mode rounds reuse the identical split (see the Course Mode section
// below): round metadata in the index, each round's played holes in their
// own chunk.
const holesKeyFor = (roundId) => `rangelog_holes_v1_${roundId}`;

let _index = null; // { schemaVersion, sessions: [...], rounds: [...], courses: [...], settings: {} }
const _shotsCache = new Map(); // session_id -> shots array, lazily loaded from its own key
const _holesCache = new Map(); // round_id -> holes array, same lazy-load pattern as _shotsCache

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

// schemaVersion is provenance only — nothing in this codebase branches on
// it. Forward compatibility is handled by normalize-on-load in loadIndex()
// below (the same way `goals` was added), so an index written by an older
// version simply gains the missing arrays on its next read and no data is
// ever rewritten or migrated in place. Bumped 2 -> 3 when Course Mode's
// rounds/courses arrived.
function defaultIndex() {
  return {
    schemaVersion: 3,
    sessions: [],
    goals: [],
    rounds: [],
    courses: [],
    practice_plans: [],
    settings: { lastClub: null, lastSetup: 'ground', lastSurface: 'mat', lastSwing: 'full', lastBallCount: DEFAULT_BALL_COUNT, lastKnownLocation: null, theme: 'dark' },
  };
}

function loadIndex() {
  if (_index) return _index;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    _index = raw ? JSON.parse(raw) : defaultIndex();
    if (!Array.isArray(_index.sessions)) _index.sessions = [];
    // Older saved indexes (pre-goal-persistence) simply lack this key —
    // same normalize-on-load pattern as `sessions` above, so every caller
    // downstream can assume the array always exists.
    if (!Array.isArray(_index.goals)) _index.goals = [];
    // Same normalize-on-load treatment for Course Mode's collections — an
    // index written before Course Mode existed simply has no such keys, and
    // gains them here rather than through a migration step.
    if (!Array.isArray(_index.rounds)) _index.rounds = [];
    if (!Array.isArray(_index.courses)) _index.courses = [];
    if (!Array.isArray(_index.practice_plans)) _index.practice_plans = [];
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

function loadHolesChunk(roundId) {
  if (_holesCache.has(roundId)) return _holesCache.get(roundId);
  let holes = [];
  try {
    const raw = localStorage.getItem(holesKeyFor(roundId));
    holes = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(holes)) holes = [];
  } catch (e) {
    console.error('Next Ball: failed to load holes for a round, starting that round empty', e);
    holes = [];
  }
  _holesCache.set(roundId, holes);
  return holes;
}

// Unlike saveShotsChunk's callers, upsertHole() propagates this return value
// to ITS caller: docs/course-mode-spec.md §8 requires a failed write to be
// surfaced immediately on the hole screen, because silent data loss during a
// round is the worst failure mode in the feature.
function saveHolesChunk(roundId) {
  try {
    localStorage.setItem(holesKeyFor(roundId), JSON.stringify(_holesCache.get(roundId) || []));
    return true;
  } catch (e) {
    console.error('Next Ball: failed to save holes for a round', e);
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
  _holesCache.clear();
}

// Reassembles the old flat {sessions, shots, settings} shape from the index
// + every session's chunk. Only used by the Settings screen's storage-stats
// display and exportFullDB() — both rare, not-time-critical reads, so
// loading everything here is an acceptable, deliberate trade-off.
export function getDB() {
  const index = loadIndex();
  const shots = [];
  for (const s of index.sessions) shots.push(...loadShotsChunk(s.session_id));
  // Rounds' holes are flattened here exactly like sessions' shots, so a JSON
  // backup stays one self-describing document rather than one document plus
  // N opaque chunk keys.
  const holes = [];
  for (const r of index.rounds) holes.push(...loadHolesChunk(r.round_id));
  return {
    schemaVersion: index.schemaVersion,
    sessions: index.sessions,
    shots,
    goals: index.goals,
    rounds: index.rounds,
    courses: index.courses,
    holes,
    practice_plans: index.practice_plans,
    settings: index.settings,
  };
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

// ---------- Next Goal persistence ----------
// A goal is the structured object sessionStory.js's getNextGoal() computes
// at the end of a session — title/detail/metric/target/current/shotsAway/
// context — wrapped here with its own identity, source session, and
// lifecycle status. Storage-only: this module never calls getNextGoal()
// itself or decides WHEN a goal is created/resolved — see
// sessionAnalysis.js's finalizeSessionGoal, the single call site for that,
// triggered once per session at the moment it finishes. Kept in the index
// (not its own chunked key) since goals are small and bounded by session
// count, exactly like `sessions` itself.
//
// 'met' / 'partially_met' / 'not_met' are real evaluation outcomes, not
// implemented yet (no code path assigns them) — the enum exists now so a
// future evaluation feature doesn't need a migration to add a status value.
export const GOAL_STATUSES = ['active', 'met', 'partially_met', 'not_met', 'superseded'];

function loadGoals() {
  return loadIndex().goals;
}

export function getGoals() {
  return loadGoals();
}

// At most one goal is ever 'active' at a time (see createGoal, which always
// supersedes whatever was active before adding a new one) — .find() rather
// than a dedicated pointer field keeps that invariant self-evident from the
// data itself instead of a second source of truth that could drift from it.
export function getActiveGoal() {
  return loadGoals().find((g) => g.status === 'active') || null;
}

// The goal a specific session produced (if any) — a past session's Session
// Summary reads this to show exactly what it generated, regardless of that
// goal's current lifecycle status.
export function getGoalForSession(sessionId) {
  return loadGoals().find((g) => g.session_id === sessionId) || null;
}

// Creates a new 'active' goal from the structured object getNextGoal()
// returns. Does NOT itself resolve whatever was previously active — see
// finalizeSessionGoal, which calls resolveGoal() first so there is never a
// moment with two simultaneously-active goals.
export function createGoal(sessionId, goal) {
  const goals = loadGoals();
  const ts = nowISO();
  const record = {
    goal_id: uuid(),
    session_id: sessionId,
    created_at: ts,
    resolved_at: null,
    status: 'active',
    superseded_by: null,
    // Filled in later by recordGoalEvaluationAttempt/resolveGoal once (if
    // ever) a later session provides enough comparable data to check this
    // goal — see sessionStory.js's evaluateGoal for the shape.
    evaluation: null,
    ...goal,
  };
  goals.push(record);
  saveIndex();
  return record;
}

// Moves a goal out of 'active' into a terminal (or superseding) status.
// `supersededBy` records the replacement goal's id when status is
// 'superseded', so the chain from one goal to the next is traceable without
// a separate history table. `evaluation` (see evaluateGoal's return shape)
// is attached at the same time for a conclusive (met/partially_met/
// not_met) result — the one write that both resolves the goal and records
// why.
export function resolveGoal(goalId, status, { supersededBy = null, evaluation = null } = {}) {
  const goals = loadGoals();
  const g = goals.find((x) => x.goal_id === goalId);
  if (!g) return null;
  g.status = status;
  g.resolved_at = nowISO();
  if (supersededBy) g.superseded_by = supersededBy;
  if (evaluation) g.evaluation = evaluation;
  saveIndex();
  return g;
}

// Records an EVALUATION ATTEMPT that did not produce enough comparable data
// to actually resolve the goal — the goal's status is deliberately left
// untouched (still 'active'). Distinct from resolveGoal(): this never
// changes status/resolved_at, only leaves a trail of "a later session
// checked this and here's why it couldn't tell yet," so Session Summary can
// explain the "still active" state instead of showing nothing.
export function recordGoalEvaluationAttempt(goalId, evaluation) {
  const goals = loadGoals();
  const g = goals.find((x) => x.goal_id === goalId);
  if (!g) return null;
  g.evaluation = evaluation;
  saveIndex();
  return g;
}

// Puts a resolved goal back into 'active' status — the "Continue This
// Goal" action after an evaluation. Guards the single-active-goal
// invariant exactly like restoreSession's own reactivation path: if a
// different goal is somehow already active, it's superseded first rather
// than allowing two simultaneously-active goals.
export function reactivateGoal(goalId) {
  const goals = loadGoals();
  const g = goals.find((x) => x.goal_id === goalId);
  if (!g) return null;
  const currentActive = getActiveGoal();
  if (currentActive && currentActive.goal_id !== goalId) {
    currentActive.status = 'superseded';
    currentActive.resolved_at = nowISO();
    currentActive.superseded_by = goalId;
  }
  g.status = 'active';
  g.resolved_at = null;
  g.superseded_by = null;
  saveIndex();
  return g;
}

// Marks an already-resolved goal's evaluation as dismissed — the "Dismiss
// For Now" action. Purely a UI-acknowledgment flag (see summary.js): it
// changes nothing about the goal's status, it just tells Session Summary
// not to keep offering the Continue/Set New Goal/Dismiss choice on repeat
// visits to this same session's recap.
export function dismissGoalEvaluation(goalId) {
  const goals = loadGoals();
  const g = goals.find((x) => x.goal_id === goalId);
  if (!g || !g.evaluation) return null;
  g.evaluation = { ...g.evaluation, dismissed: true };
  saveIndex();
  return g;
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
  // A goal this session produced has no meaning once its source session is
  // gone — removed alongside it (and restored alongside it on Undo, see
  // restoreSession) rather than left as an orphaned reference to a
  // session_id that no longer exists.
  const goalIdx = index.goals.findIndex((g) => g.session_id === sessionId);
  const removedGoal = goalIdx !== -1 ? index.goals[goalIdx] : null;

  index.sessions.splice(idx, 1);
  if (removedGoal) index.goals.splice(goalIdx, 1);
  if (!saveIndex()) {
    index.sessions.splice(idx, 0, removedSession); // roll back the in-memory removal — nothing was actually persisted
    if (removedGoal) index.goals.splice(goalIdx, 0, removedGoal);
    throw Object.assign(new Error('Failed to delete session'), { code: 'storage_error' });
  }

  try {
    localStorage.removeItem(shotsKeyFor(sessionId));
  } catch (e) {
    console.error('Next Ball: session deleted, but failed to clean up its shot data (harmless orphaned key)', e);
  }
  _shotsCache.delete(sessionId);

  return { session: removedSession, shots, goal: removedGoal };
}

// Re-inserts a session and its shots exactly as returned by deleteSession(),
// for the brief Undo window after a delete. Not a general "recreate a
// session" API — trusts the caller to pass back exactly what was removed.
// Returns false (without throwing) if a session with that id already exists
// again (nothing to do) or if the write fails, so the caller can show a
// simple "Couldn't undo" message rather than crash. `goal` is optional
// (deleteSession's result may carry null) so every existing 2-arg caller
// keeps working unchanged.
export function restoreSession(session, shots, goal = null) {
  const index = loadIndex();
  if (index.sessions.some((s) => s.session_id === session.session_id)) return false;

  index.sessions.push(session);
  if (!saveIndex()) {
    index.sessions.pop();
    return false;
  }

  _shotsCache.set(session.session_id, shots);
  saveShotsChunk(session.session_id);

  if (goal && !index.goals.some((g) => g.goal_id === goal.goal_id)) {
    // Guards the single-active-goal invariant: if a different session
    // finished (and created its own active goal) during the delete/undo
    // window, the restored goal rejoins history as superseded rather than
    // creating a second simultaneously-active goal.
    const restored = { ...goal };
    const currentActive = getActiveGoal();
    if (restored.status === 'active' && currentActive && currentActive.goal_id !== restored.goal_id) {
      restored.status = 'superseded';
      restored.resolved_at = nowISO();
      restored.superseded_by = currentActive.goal_id;
    }
    index.goals.push(restored);
    saveIndex();
  }

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

// Applies the same patch to every shot in shotIds within one session, in a
// single save — used by History Detail's batch-edit action bar (see
// docs/ux-spec.md §3.10). Deliberately a single write rather than N calls to
// updateShot(), since a batch operation is exactly the "many shots, one
// change" case that chunked storage exists to make cheap. shot_number and
// shot_timestamp are never among the patched fields (the caller only ever
// passes one of the seven context fields), so history stays otherwise
// untouched. Returns how many shots actually matched.
export function updateShots(sessionId, shotIds, patch) {
  const idSet = new Set(shotIds);
  const shots = loadShotsChunk(sessionId);
  const ts = nowISO();
  let count = 0;
  for (const sh of shots) {
    if (idSet.has(sh.shot_id)) {
      Object.assign(sh, patch, { updated_at: ts });
      count++;
    }
  }
  saveShotsChunk(sessionId);
  return count;
}

// Permanently removes a set of shots from a session, keyed by shot_id.
// Unlike deleteLastShot (which only ever removes the highest shot_number),
// this can remove shots from anywhere in the list — batch delete's whole
// point. Deliberately does NOT renumber the shots that remain: shot_number
// is an immutable historical fact (see the shot-context-snapshot tests), so
// a deletion here simply leaves a gap, exactly like an undone/edited shot
// already can. Every stats.js calculator sorts by shot_number and walks it
// positionally, so a gap changes nothing about correctness. Returns how
// many shots were actually removed.
export function deleteShots(sessionId, shotIds) {
  const idSet = new Set(shotIds);
  const shots = loadShotsChunk(sessionId);
  const remaining = shots.filter((s) => !idSet.has(s.shot_id));
  const removedCount = shots.length - remaining.length;
  _shotsCache.set(sessionId, remaining);
  saveShotsChunk(sessionId);
  return removedCount;
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

// ---------- Course Mode: courses, rounds, holes ----------
//
// A round is a SEPARATE entity from a session, never a session variant (see
// docs/course-mode-spec.md §11.1). createSession() is deeply range-specific
// — target_ball_count, default_/current_ club/setup/surface/swing, drill,
// training aid, target distance — and reusing it would leave half those
// fields permanently null while forcing every range analytic (stats.js,
// listFinishedSessions(), History, Trends, Groove Score) to branch on type
// forever. Keeping rounds separate means the range path needs no type guards
// at all, and Course Mode cannot regress range logging.
//
// Storage mirrors the sessions/shots split exactly (§6): round metadata in
// the index, each round's PLAYED holes in their own
// rangelog_holes_v1_{roundId} chunk, so a long history of rounds never slows
// hole entry.

export const COURSE_SOURCES = ['gps_place', 'search', 'remembered', 'manual'];
export const HOLE_COUNTS = [9, 18];
export const DEFAULT_HOLE_COUNT = 9;
export const ROUND_STATUSES = ['active', 'paused', 'finished'];

// A standard 9 (par 35); an 18 is two of these (par 70). This is a starting
// point the golfer edits on Round Setup (§4.3) — never a claim about the
// real course, which is why a course's actual pars are remembered only once
// a round has been played there.
export const PAR_TEMPLATE_9 = [4, 4, 3, 4, 5, 4, 3, 4, 4];

function normalizeHoleCount(holeCount) {
  return HOLE_COUNTS.includes(holeCount) ? holeCount : DEFAULT_HOLE_COUNT;
}

function todayLocalDateString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowLocalTimeString() {
  return new Date().toTimeString().slice(0, 5);
}

// Deliberately permissive: any positive integer, or null for unknown. §6
// documents par as "3-5", which describes what Round Setup's tap-to-cycle
// control offers — clamping here would silently rewrite a legitimately
// entered par 6, and §5.4's principle is to record what the golfer said
// rather than what the app prefers.
function normalizePar(par, fallback = null) {
  if (par === null || par === undefined) return fallback;
  const n = Math.round(Number(par));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function normalizeYardage(yardage) {
  if (yardage === null || yardage === undefined) return null;
  const n = Math.round(Number(yardage));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function clampCount(value, min, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n;
}

// A hole's club set is unordered, de-duplicated, and carries no counts — it
// records only WHICH clubs appeared on the hole (§4.4). The putter is
// excluded because putts are counted in their own field: keeping it would
// double-record the same strokes and imply the per-shot club tracking the
// feature explicitly does not do (§6, §7.4).
function normalizeClubsUsed(clubs) {
  if (!Array.isArray(clubs)) return [];
  const seen = new Set();
  const out = [];
  for (const c of clubs) {
    if (typeof c !== 'string') continue;
    const name = c.trim();
    if (!name || name.toLowerCase() === 'putter') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// One definition per hole for a given course/round — par and, where a source
// actually provides it, yardage. Yardage is never invented: unknown stays
// null so display can omit it entirely rather than rendering "— yd" (§8).
export function defaultHoleDefs(holeCount) {
  const n = normalizeHoleCount(holeCount);
  return Array.from({ length: n }, (_, i) => ({
    hole_number: i + 1,
    par: PAR_TEMPLATE_9[i % 9],
    yardage: null,
  }));
}

// Always returns exactly holeCount definitions numbered 1..holeCount, with
// anything the caller supplied merged over the template — so a partial or
// malformed list (an older round, a provider returning only a few holes)
// still yields a complete, immediately playable set.
function normalizeHoleDefs(defs, holeCount) {
  const base = defaultHoleDefs(holeCount);
  if (!Array.isArray(defs)) return base;
  const byNumber = new Map();
  for (const d of defs) {
    if (!d || typeof d !== 'object') continue;
    const num = Math.round(Number(d.hole_number));
    if (Number.isFinite(num)) byNumber.set(num, d);
  }
  return base.map((def) => {
    const incoming = byNumber.get(def.hole_number);
    if (!incoming) return def;
    return {
      hole_number: def.hole_number,
      par: normalizePar(incoming.par, def.par),
      yardage: normalizeYardage(incoming.yardage),
    };
  });
}

// ----- Courses -----
// A course is the reusable, remembered record behind "Recent Course" and
// Round Setup's pre-filled pars (§4.2/§4.3). It is deliberately NOT what a
// round reads for display: a round snapshots its own course fields at
// creation (see createRound), so editing or deleting a course can never
// rewrite the history of a round already played there.

export function isProviderBackedCourse(course) {
  return !!course && course.source !== 'manual' && !!course.place_id;
}

export function getCourse(courseId) {
  return loadIndex().courses.find((c) => c.course_id === courseId) || null;
}

export function findCourseByPlaceId(placeId) {
  if (!placeId) return null;
  return loadIndex().courses.find((c) => c.place_id === placeId) || null;
}

// Most recently played first; never-played courses fall back to creation
// order, so a course added manually but not yet played is still reachable.
export function listCourses() {
  const arr = loadIndex().courses;
  return arr
    .map((c, i) => ({ c, i }))
    .sort((a, b) =>
      (b.c.last_played_at || '').localeCompare(a.c.last_played_at || '')
      || (b.c.created_at || '').localeCompare(a.c.created_at || '')
      || b.i - a.i)
    .map((x) => x.c);
}

// §4.2: Select a Course shows exactly ONE recent course, never a list.
// Courses that have never been played are not "recent" and are excluded.
export function getRecentCourse() {
  return listCourses().find((c) => !!c.last_played_at) || null;
}

// Creates or updates a course. Identity is place_id when the course is
// provider-backed, otherwise name + city (case-insensitively) — so playing
// the same manually-typed course twice updates one record rather than
// accumulating near-duplicates, exactly as rememberVenue() already does for
// range venues.
export function upsertCourse(fields = {}) {
  const index = loadIndex();
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (!name) return null;

  const city = fields.city ? String(fields.city).trim() : null;
  const state = fields.state ? String(fields.state).trim() : null;
  const placeId = fields.place_id || null;
  const source = COURSE_SOURCES.includes(fields.source) ? fields.source : 'manual';
  const holeCount = normalizeHoleCount(fields.hole_count);

  const existing = placeId
    ? index.courses.find((c) => c.place_id === placeId)
    : index.courses.find((c) =>
      !c.place_id
      && c.name.toLowerCase() === name.toLowerCase()
      && (c.city || '').toLowerCase() === (city || '').toLowerCase());

  const ts = nowISO();
  if (existing) {
    existing.name = name;
    if (city !== null) existing.city = city;
    if (state !== null) existing.state = state;
    if (fields.latitude != null) existing.latitude = fields.latitude;
    if (fields.longitude != null) existing.longitude = fields.longitude;
    if (placeId) existing.place_id = placeId;
    if (fields.hole_count !== undefined) existing.hole_count = holeCount;
    if (fields.hole_defs !== undefined) existing.hole_defs = normalizeHoleDefs(fields.hole_defs, existing.hole_count);
    existing.updated_at = ts;
    saveIndex();
    return existing;
  }

  const course = {
    course_id: uuid(),
    name,
    city,
    state,
    latitude: fields.latitude ?? null,
    longitude: fields.longitude ?? null,
    // OSM "type/id" when a provider supplied this course; null for manual.
    place_id: placeId,
    source,
    // Which external system place_id belongs to — null for a manually typed
    // course. Stored rather than inferred so a second provider could be
    // added later without re-interpreting existing records.
    provider: fields.provider ?? (placeId ? 'osm' : null),
    hole_count: holeCount,
    // Remembered after the first round here (§4.3) so a returning golfer's
    // Round Setup is pre-filled correctly.
    hole_defs: normalizeHoleDefs(fields.hole_defs, holeCount),
    last_played_at: null,
    play_count: 0,
    created_at: ts,
    updated_at: ts,
  };
  index.courses.push(course);
  saveIndex();
  return course;
}

// Records that a round was played at this course, remembering the hole
// count and pars that round actually used (§4.3). Called when a round is
// created, so the next round at the same course starts pre-filled.
export function recordCoursePlayed(courseId, { hole_count, hole_defs } = {}) {
  const course = getCourse(courseId);
  if (!course) return null;
  if (hole_count !== undefined) course.hole_count = normalizeHoleCount(hole_count);
  if (hole_defs !== undefined) course.hole_defs = normalizeHoleDefs(hole_defs, course.hole_count);
  course.play_count = (course.play_count || 0) + 1;
  course.last_played_at = nowISO();
  course.updated_at = nowISO();
  saveIndex();
  return course;
}

// ----- Rounds -----

export function createRound(fields = {}) {
  const index = loadIndex();
  const ts = nowISO();
  const holeCount = normalizeHoleCount(fields.hole_count);
  const round = {
    round_id: uuid(),
    // Optional link to the reusable course record. Display NEVER reads
    // through this — see the snapshot fields below — it exists only for
    // "have I played here before" comparisons (§4.5).
    course_id: fields.course_id ?? null,
    // Course snapshot (§6). Denormalized on purpose: a finished round must
    // stay fully readable even if its course record is later edited,
    // renamed, or removed — the same reason a shot snapshots its own club
    // and setup rather than reading the session's current values.
    course_name: typeof fields.course_name === 'string' ? fields.course_name.trim() : '',
    course_city: fields.course_city ?? null,
    course_state: fields.course_state ?? null,
    course_place_id: fields.course_place_id ?? null,
    course_source: COURSE_SOURCES.includes(fields.course_source) ? fields.course_source : 'manual',
    latitude: fields.latitude ?? null,
    longitude: fields.longitude ?? null,
    hole_count: holeCount,
    // Per-hole par/yardage for THIS round, snapshotted from the course (or
    // the template) at setup and editable for this round alone. Par must be
    // known before a hole is played, since the score stepper opens at par
    // (§4.4) — that is why it lives here rather than only on played holes.
    hole_defs: normalizeHoleDefs(fields.hole_defs, holeCount),
    date: fields.date || todayLocalDateString(),
    start_time: fields.start_time || nowLocalTimeString(),
    end_time: null,
    status: 'active',
    // Full-precision finish timestamp. end_time above matches the session
    // convention (local HH:MM) but loses the date, which is ambiguous for a
    // round that ends after midnight; both are kept rather than changing the
    // established session convention.
    completed_at: null,
    data_source: fields.data_source === 'test' ? 'test' : 'real',
    created_at: ts,
    updated_at: ts,
  };
  index.rounds.push(round);
  saveIndex();
  return round;
}

export function updateRound(roundId, patch) {
  const index = loadIndex();
  const r = index.rounds.find((r) => r.round_id === roundId);
  if (!r) return null;
  Object.assign(r, patch, { updated_at: nowISO() });
  saveIndex();
  return r;
}

export function getRound(roundId) {
  return loadIndex().rounds.find((r) => r.round_id === roundId) || null;
}

// Mirrors getActiveSession(). The "only one activity at a time" rule (§4.1)
// is a UI policy enforced on Home, not here — the data layer only answers
// what is currently in progress.
export function getActiveRound() {
  return loadIndex().rounds.find((r) => r.status === 'active' || r.status === 'paused') || null;
}

export function listRounds() {
  const arr = loadIndex().rounds;
  return arr
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.created_at || '').localeCompare(a.r.created_at || '') || b.i - a.i)
    .map((x) => x.r);
}

export function listFinishedRounds() {
  return listRounds().filter((r) => r.status === 'finished');
}

export function pauseRound(roundId) {
  return updateRound(roundId, { status: 'paused' });
}

export function resumeRound(roundId) {
  return updateRound(roundId, { status: 'active' });
}

// Ends a round, recording only the holes actually played — unplayed holes
// were never written and are never backfilled as 0 (§5.6).
//
// A round finished with zero holes should be DISCARDED rather than kept as
// an empty record (§8); that is a UI decision made once, at the single place
// a round is ended, and deliberately not enforced here — the same division
// of responsibility as finishSession()/deleteSession().
export function finishRound(roundId) {
  return updateRound(roundId, {
    status: 'finished',
    end_time: nowLocalTimeString(),
    completed_at: nowISO(),
  });
}

// Same contract and the same index-first ordering as deleteSession(): the
// worst possible partial failure is an orphaned holes chunk, which nothing
// ever reads because every read reaches a round's holes by walking the
// index.
export function deleteRound(roundId) {
  const index = loadIndex();
  const idx = index.rounds.findIndex((r) => r.round_id === roundId);
  if (idx === -1) return null;

  const removedRound = index.rounds[idx];
  if (removedRound.status === 'active' || removedRound.status === 'paused') {
    throw Object.assign(new Error('Cannot delete an in-progress round'), { code: 'active_round' });
  }

  const holes = getHolesForRound(roundId);
  // A practice plan has no meaning once the round that produced it is gone —
  // it exists to answer "why am I practicing this?" — so it goes with it,
  // exactly as a session's goal does.
  const planIdx = index.practice_plans.findIndex((p) => p.round_id === roundId);
  const removedPlan = planIdx !== -1 ? index.practice_plans[planIdx] : null;

  index.rounds.splice(idx, 1);
  if (removedPlan) index.practice_plans.splice(planIdx, 1);
  if (!saveIndex()) {
    index.rounds.splice(idx, 0, removedRound);
    if (removedPlan) index.practice_plans.splice(planIdx, 0, removedPlan);
    throw Object.assign(new Error('Failed to delete round'), { code: 'storage_error' });
  }

  try {
    localStorage.removeItem(holesKeyFor(roundId));
  } catch (e) {
    console.error('Next Ball: round deleted, but failed to clean up its hole data (harmless orphaned key)', e);
  }
  _holesCache.delete(roundId);

  return { round: removedRound, holes, plan: removedPlan };
}

// Re-inserts a round, its holes, and the practice plan it produced, exactly
// as deleteRound() returned them — the counterpart to History's brief Undo
// window. Not a general "recreate a round" API: it trusts the caller to
// pass back precisely what was removed. Returns false rather than throwing
// if the round already exists again or the write fails, so the caller can
// show "couldn't undo" instead of crashing.
export function restoreRound(round, holes, plan = null) {
  const index = loadIndex();
  if (index.rounds.some((r) => r.round_id === round.round_id)) return false;

  index.rounds.push(round);
  if (!saveIndex()) {
    index.rounds.pop();
    return false;
  }

  _holesCache.set(round.round_id, holes);
  saveHolesChunk(round.round_id);

  if (plan && !index.practice_plans.some((p) => p.plan_id === plan.plan_id)) {
    // Guards the one-outstanding-plan invariant the same way restoreSession
    // guards the single-active-goal one: if another plan became outstanding
    // during the undo window, the restored plan rejoins as superseded rather
    // than creating a second outstanding plan.
    const restored = { ...plan };
    const outstanding = getActivePlan();
    const wasOutstanding = restored.status === 'saved' || restored.status === 'started';
    if (wasOutstanding && outstanding && outstanding.plan_id !== restored.plan_id) {
      restored.status = 'superseded';
      restored.resolved_at = nowISO();
      restored.superseded_by = outstanding.plan_id;
    }
    index.practice_plans.push(restored);
    saveIndex();
  }

  return true;
}

// ----- Holes -----

export function getHolesForRound(roundId) {
  return [...loadHolesChunk(roundId)].sort((a, b) => a.hole_number - b.hole_number);
}

export function getHole(roundId, holeNumber) {
  return loadHolesChunk(roundId).find((h) => h.hole_number === holeNumber) || null;
}

// How many holes were actually played — derived from the stored holes, never
// a denormalized counter that could drift out of step with them (§5.6, §8).
export function roundHolesPlayed(roundId) {
  return loadHolesChunk(roundId).length;
}

// Creates or updates one hole and persists immediately, so a round survives
// a backgrounded app, a dead battery, or a mid-round phone call with every
// completed hole intact (§4.4, §5.3).
//
// Returns { hole, saved }. `saved` is the actual storage write result, which
// the caller MUST surface rather than ignore — §8 names silent data loss
// during a round the worst failure mode in this feature.
//
// Cross-field validation is deliberately absent: short_game_strokes + putts
// may legitimately exceed strokes and is stored exactly as entered (§5.4).
// Advising the golfer about that is the hole screen's job, not storage's.
export function upsertHole(roundId, holeNumber, patch = {}) {
  const round = getRound(roundId);
  if (!round) return { hole: null, saved: false };

  const num = Math.round(Number(holeNumber));
  if (!Number.isFinite(num) || num < 1 || num > round.hole_count) return { hole: null, saved: false };

  const holes = loadHolesChunk(roundId);
  const existing = holes.find((h) => h.hole_number === num) || null;
  const def = round.hole_defs.find((d) => d.hole_number === num) || null;
  const ts = nowISO();

  // A played hole distinguishes "not supplied" (keep/inherit) from an
  // explicit null, which per §6 is a real value meaning the par is unknown.
  // normalizeHoleDefs deliberately resolves the same input differently: a
  // definition must always yield a playable par for the score stepper to
  // open on (§4.4), so there a missing par falls back to the template.
  const patchedPar = (value, fallback) => (value === null ? null : normalizePar(value, fallback));

  let hole;
  if (existing) {
    hole = existing;
    if (patch.par !== undefined) hole.par = patchedPar(patch.par, hole.par);
    if (patch.yardage !== undefined) hole.yardage = normalizeYardage(patch.yardage);
    if (patch.strokes !== undefined) hole.strokes = clampCount(patch.strokes, 1, hole.strokes);
    if (patch.clubs_used !== undefined) hole.clubs_used = normalizeClubsUsed(patch.clubs_used);
    if (patch.short_game_strokes !== undefined) hole.short_game_strokes = clampCount(patch.short_game_strokes, 0, hole.short_game_strokes);
    if (patch.putts !== undefined) hole.putts = clampCount(patch.putts, 0, hole.putts);
    hole.updated_at = ts;
  } else {
    // Par and yardage default from this round's own hole definitions, so a
    // played hole carries its own copy and stays truthful even if the
    // round's definitions are edited afterwards.
    const par = patch.par !== undefined ? patchedPar(patch.par, def?.par ?? null) : (def?.par ?? null);
    hole = {
      round_id: roundId,
      hole_number: num,
      par,
      yardage: patch.yardage !== undefined ? normalizeYardage(patch.yardage) : (def?.yardage ?? null),
      // A hole record only exists once it has been played, and strokes is
      // required (§6) — a write that omits it starts at par, the same value
      // the score stepper opens on (§4.4).
      strokes: clampCount(patch.strokes, 1, par ?? 1),
      clubs_used: normalizeClubsUsed(patch.clubs_used),
      short_game_strokes: clampCount(patch.short_game_strokes, 0, 0),
      putts: clampCount(patch.putts, 0, 0),
      created_at: ts,
      updated_at: ts,
    };
    holes.push(hole);
  }

  const saved = saveHolesChunk(roundId);
  return { hole, saved };
}

// ---------- Practice plans ----------
//
// A plan is the structured practice focus roundAnalysis.js generates from a
// finished round, wrapped here with its own identity, its source round, and
// a lifecycle status. Storage-only: this module never generates a plan and
// never decides when one is saved or resolved.
//
// Deliberately modelled on the goals collection above, which already solves
// exactly this problem — an artifact generated from one session, persisted
// with a status lifecycle, resolved later (§7.3). Plans live in the index
// for the same reason goals do: they are small and bounded by round count.
//
// 'started' and 'completed' have no writer yet. Connecting a saved plan to
// a range session is a later phase; the statuses exist now so that phase
// needs no migration.
export const PLAN_STATUSES = ['saved', 'started', 'completed', 'dismissed', 'superseded'];

function loadPlans() {
  return loadIndex().practice_plans;
}

export function getPlans() {
  return loadPlans();
}

// The plan a specific round produced, whatever its current status — this is
// what makes "why am I practicing this?" permanently answerable (§7.2), and
// what stops a second visit to the same round's Next Practice screen from
// creating a duplicate.
export function getPlanForRound(roundId) {
  return loadPlans().find((p) => p.round_id === roundId) || null;
}

export function getPlan(planId) {
  return loadPlans().find((p) => p.plan_id === planId) || null;
}

// At most one plan is ever outstanding. 'saved' (waiting to be practiced)
// and 'started' (a range session is running it) both count as outstanding;
// everything else is concluded (§7.1). Only an outstanding plan is ever
// surfaced anywhere in the app.
export function getActivePlan() {
  return loadPlans().find((p) => p.status === 'saved' || p.status === 'started') || null;
}

// The plan a given range session is running, if any. The link lives on the
// plan rather than the session so that sessions keep exactly the shape they
// have always had — nothing in the range path needs to know plans exist.
export function getPlanForSession(sessionId) {
  if (!sessionId) return null;
  return loadPlans().find((p) => p.started_session_id === sessionId) || null;
}

// Creates a saved plan from the focus object roundAnalysis.js produced.
//
// Unlike createGoal — whose superseding is done a layer up in
// sessionAnalysis.js — this supersedes any outstanding plan itself, because
// saving is a single user action with a single call site and the
// one-outstanding-plan invariant (§7.3) should not depend on every future
// caller remembering to resolve the previous one first.
export function createPlan(roundId, focus) {
  if (!roundId || !focus) return null;
  const plans = loadPlans();
  const ts = nowISO();

  const record = {
    plan_id: uuid(),
    // Never null — a plan without its source round could not explain itself.
    round_id: roundId,
    created_at: ts,
    resolved_at: null,
    status: 'saved',
    superseded_by: null,
    // The range session that ran this plan, once that connection exists.
    started_session_id: null,
    // Which rule in roundAnalysis.js produced this focus (putting, short
    // game, full swing, a named club, or maintenance).
    focus_type: focus.signal ?? null,
    // The club a `club` focus names. Not in §7.3's table, but §7.8 requires
    // Session Setup to pre-fill the club "where the plan names one" — which
    // is only possible if the plan carries it. Null for every other focus
    // type, where no club is named and none is guessed.
    focus_club: focus.club ?? null,
    focus_title: focus.focus_title,
    focus_rationale: focus.focus_rationale,
    goal_text: focus.goal_text,
    steps: Array.isArray(focus.steps) ? focus.steps.map((s) => ({ ...s })) : [],
  };

  const outstanding = getActivePlan();
  if (outstanding) {
    outstanding.status = 'superseded';
    outstanding.resolved_at = ts;
    outstanding.superseded_by = record.plan_id;
  }

  plans.push(record);
  saveIndex();
  return record;
}

// Returns a started plan to 'saved' and forgets the session that was
// running it — for a session abandoned with nothing logged. The plan was
// never practiced, so it must not be left claiming to be in progress, and
// must not be marked completed either.
export function reopenPlan(planId) {
  const plans = loadPlans();
  const p = plans.find((x) => x.plan_id === planId);
  if (!p) return null;
  p.status = 'saved';
  p.resolved_at = null;
  p.started_session_id = null;
  saveIndex();
  return p;
}

// Moves a plan out of 'saved'/'started' into a terminal (or superseding)
// status, recording the range session that ran it where there is one.
export function resolvePlan(planId, status, { startedSessionId = null, supersededBy = null } = {}) {
  const plans = loadPlans();
  const p = plans.find((x) => x.plan_id === planId);
  if (!p || !PLAN_STATUSES.includes(status)) return null;
  p.status = status;
  p.resolved_at = status === 'started' ? null : nowISO();
  if (startedSessionId) p.started_session_id = startedSessionId;
  if (supersededBy) p.superseded_by = supersededBy;
  saveIndex();
  return p;
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
  // Identical cleanup for rounds' hole chunks. A pre-Course-Mode backup has
  // no `rounds` key at all, so restoring one correctly removes every round
  // and its holes — the same way it already removes sessions absent from the
  // file, and the same path Settings' "Erase All Data" takes.
  const incomingRoundIds = new Set(Array.isArray(obj.rounds) ? obj.rounds.map((r) => r.round_id) : []);
  for (const r of loadIndex().rounds) {
    if (!incomingRoundIds.has(r.round_id)) {
      try { localStorage.removeItem(holesKeyFor(r.round_id)); } catch (e) { /* best-effort cleanup */ }
    }
  }

  _index = {
    schemaVersion: obj.schemaVersion || 1,
    sessions: obj.sessions,
    // Older backups (pre-goal-persistence) simply have no `goals` key —
    // that's not a corrupt file, just data from before this existed.
    goals: Array.isArray(obj.goals) ? obj.goals : [],
    // Same for pre-Course-Mode backups and their rounds/courses/plans.
    rounds: Array.isArray(obj.rounds) ? obj.rounds : [],
    courses: Array.isArray(obj.courses) ? obj.courses : [],
    practice_plans: Array.isArray(obj.practice_plans) ? obj.practice_plans : [],
    // Merged (not `obj.settings || defaultIndex().settings`) so an empty or
    // partial settings object — e.g. Settings' "Erase All Data" passing
    // `{}` deliberately — still ends up with every default field rather
    // than one that's merely truthy, which every reader here already
    // assumes exists via its own `||` fallback.
    settings: { ...defaultIndex().settings, ...(obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) },
  };
  _shotsCache.clear();
  _holesCache.clear();
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

  const holesByRound = new Map();
  for (const h of (Array.isArray(obj.holes) ? obj.holes : [])) {
    let list = holesByRound.get(h.round_id);
    if (!list) { list = []; holesByRound.set(h.round_id, list); }
    list.push(h);
  }
  for (const r of _index.rounds) {
    _holesCache.set(r.round_id, holesByRound.get(r.round_id) || []);
    saveHolesChunk(r.round_id);
  }

  return getDB();
}
