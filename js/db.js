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
// rounds/courses arrived, 3 -> 4 when courses gained cached GPS geometry and
// tee sets (§14), and 4 -> 5 when lessons and the Active Swing Focus
// arrived (lesson-spec.md §2, §3), and 5 -> 6 when Swing Lab's video
// metadata arrived (swing-lab-spec.md §20.1).
function defaultIndex() {
  return {
    schemaVersion: 6,
    sessions: [],
    goals: [],
    rounds: [],
    courses: [],
    practice_plans: [],
    lessons: [],
    // Metadata only. The video bytes live in the media tier (js/media.js),
    // and this record deliberately outlives them — see deleteSwingVideo.
    swing_videos: [],
    // Derived from swing_videos and disposable — see createSwingAnalysis.
    swing_analyses: [],
    // active_swing_focus is a POINTER at a lesson's cue, not a copy of it —
    // see setActiveSwingFocus. Null when no focus is set, which is the
    // state every install starts in and the state a golfer can return to.
    settings: { lastClub: null, lastSetup: 'ground', lastSurface: 'mat', lastSwing: 'full', lastBallCount: DEFAULT_BALL_COUNT, lastKnownLocation: null, theme: 'dark', active_swing_focus: null },
  };
}

// Brings a raw index up to the shape every reader assumes, without
// rewriting storage — the normalize-on-load idiom this file has used since
// `goals` arrived. An index written by an older build, or restored from a
// backup made by one, simply gains the missing pieces on its next read.
//
// Shared by loadIndex() and importFullDB(): an import replaces `_index`
// wholesale and never passes back through the loader, so anything only done
// there would sit unapplied until the next reload.
function normalizeIndexShape(idx) {
  if (!Array.isArray(idx.sessions)) idx.sessions = [];
  // Older saved indexes (pre-goal-persistence) simply lack this key —
  // same normalize-on-load pattern as `sessions` above, so every caller
  // downstream can assume the array always exists.
  if (!Array.isArray(idx.goals)) idx.goals = [];
  // Same normalize-on-load treatment for Course Mode's collections — an
  // index written before Course Mode existed simply has no such keys, and
  // gains them here rather than through a migration step.
  if (!Array.isArray(idx.rounds)) idx.rounds = [];
  if (!Array.isArray(idx.courses)) idx.courses = [];
  if (!Array.isArray(idx.practice_plans)) idx.practice_plans = [];
  // Plans written before lessons existed have no `source` — every one of
  // them came from a round, which is exactly what the absent field means.
  for (const p of idx.practice_plans) {
    if (!p.source) p.source = 'round';
    if (p.lesson_id === undefined) p.lesson_id = null;
    if (p.round_id === undefined) p.round_id = null;
  }
  // Lessons arrive the same way every other collection did — an index
  // written before V4.2 simply gains the key on its next read.
  if (!Array.isArray(idx.lessons)) idx.lessons = [];
  // Every lesson this app writes has cues, drills, topics and video_ids,
  // because createLesson refuses anything less. A lesson that arrived
  // through importFullDB has whatever the file contained — and a record
  // missing `cues` threw inside History's renderer, taking down the app's
  // main list screen and with it the only route to the offending lesson.
  // Repaired here rather than guarded at each call site, so every reader
  // can rely on the shape. Nothing is invented: a lesson with no usable
  // cues gets an empty list and stays editable.
  for (const l of idx.lessons) {
    if (!Array.isArray(l.cues)) l.cues = normalizeLessonCues(l.cues);
    if (!Array.isArray(l.drills)) l.drills = normalizeLessonDrills(l.drills);
    if (!Array.isArray(l.topics)) l.topics = [];
    if (!Array.isArray(l.video_ids)) l.video_ids = [];
    if (typeof l.notes !== 'string') l.notes = '';
  }
  // Swing Lab metadata, added in V4.3. Same normalize-on-load treatment as
  // every collection before it.
  if (!Array.isArray(idx.swing_videos)) idx.swing_videos = [];
  if (!Array.isArray(idx.swing_analyses)) idx.swing_analyses = [];
  for (const v of idx.swing_videos) {
    if (!v.camera_view) v.camera_view = 'unknown';
    if (!v.media_state) v.media_state = 'present';
    // Videos written by V4.3 Phase 1 predate association entirely. A video
    // with a shot is linked; one without never had a shot coming.
    if (!v.association_state) v.association_state = v.shot_id ? 'linked' : 'unpaired';
    if (v.shot_id === undefined) v.shot_id = null;
  }
  if (!idx.settings || typeof idx.settings !== 'object') idx.settings = {};
  if (idx.settings.active_swing_focus === undefined) idx.settings.active_swing_focus = null;
  return idx;
}

function loadIndex() {
  if (_index) return _index;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    _index = normalizeIndexShape(raw ? JSON.parse(raw) : defaultIndex());
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
    lessons: index.lessons,
    // Metadata only — a JSON backup never carries video bytes. A restore on
    // another device therefore produces records whose media is absent,
    // which media_state already describes.
    swing_videos: index.swing_videos,
    swing_analyses: index.swing_analyses,
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
    // The Active Swing Focus as it stood when this session was played — a
    // COPY, never a pointer (lesson-spec.md §5.2). Correcting a lesson's
    // wording three weeks from now must not silently re-label the sessions
    // already practised under the old wording. Null when no focus was set.
    //
    // Written even though nothing reads it yet: it costs nothing now, and
    // it is the one field here that cannot be backfilled later.
    swing_focus: fields.swing_focus !== undefined ? fields.swing_focus : swingFocusSnapshot(),
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
  // A swing still waiting for a shot that will never come is not lost — it
  // becomes an unpaired session swing (§17). Settled here rather than in the
  // UI so every way a session ends is covered.
  settlePendingSwingVideos(sessionId);
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
// `allowInProgress` exists for the one caller that means it: History's
// delete, reached through a named confirmation sheet. Everywhere else an
// in-progress session is protected from a stray call.
export function deleteSession(sessionId, { allowInProgress = false } = {}) {
  const index = loadIndex();
  const idx = index.sessions.findIndex((s) => s.session_id === sessionId);
  if (idx === -1) return null;

  const removedSession = index.sessions[idx];
  if (!allowInProgress && (removedSession.status === 'active' || removedSession.status === 'paused')) {
    throw Object.assign(new Error('Cannot delete an in-progress session'), { code: 'active_session' });
  }

  const shots = getShotsForSession(sessionId); // snapshot before removal, for the caller's undo/records
  // A goal this session produced has no meaning once its source session is
  // gone — removed alongside it (and restored alongside it on Undo, see
  // restoreSession) rather than left as an orphaned reference to a
  // session_id that no longer exists.
  const goalIdx = index.goals.findIndex((g) => g.session_id === sessionId);
  const removedGoal = goalIdx !== -1 ? index.goals[goalIdx] : null;

  // A practice plan outlives the session that ran it — it belongs to the
  // round that produced it — but its pointer to that session must not. A
  // plan left 'started' against a deleted session reads as permanently in
  // progress and can never be completed. Unlinking returns it to 'saved',
  // which is the truth: it is waiting to be practiced again.
  const relinkedPlans = index.practice_plans
    .filter((p) => p.started_session_id === sessionId)
    .map((p) => ({ plan_id: p.plan_id, started_session_id: p.started_session_id, status: p.status }));
  for (const p of index.practice_plans) {
    if (p.started_session_id !== sessionId) continue;
    p.started_session_id = null;
    if (p.status === 'started') p.status = 'saved';
  }

  index.sessions.splice(idx, 1);
  if (removedGoal) index.goals.splice(goalIdx, 1);
  if (!saveIndex()) {
    index.sessions.splice(idx, 0, removedSession); // roll back the in-memory removal — nothing was actually persisted
    if (removedGoal) index.goals.splice(goalIdx, 0, removedGoal);
    for (const snap of relinkedPlans) {
      const p = index.practice_plans.find((x) => x.plan_id === snap.plan_id);
      if (p) { p.started_session_id = snap.started_session_id; p.status = snap.status; }
    }
    throw Object.assign(new Error('Failed to delete session'), { code: 'storage_error' });
  }

  try {
    localStorage.removeItem(shotsKeyFor(sessionId));
  } catch (e) {
    console.error('Next Ball: session deleted, but failed to clean up its shot data (harmless orphaned key)', e);
  }
  _shotsCache.delete(sessionId);

  // `plans` carries the plan links this delete had to break, so Undo can put
  // them back exactly as they were.
  return { session: removedSession, shots, goal: removedGoal, plans: relinkedPlans };
}

// Re-inserts a session and its shots exactly as returned by deleteSession(),
// for the brief Undo window after a delete. Not a general "recreate a
// session" API — trusts the caller to pass back exactly what was removed.
// Returns false (without throwing) if a session with that id already exists
// again (nothing to do) or if the write fails, so the caller can show a
// simple "Couldn't undo" message rather than crash. `goal` is optional
// (deleteSession's result may carry null) so every existing 2-arg caller
// keeps working unchanged, and `plans` — the plan links the delete had to
// break — is optional for the same reason.
export function restoreSession(session, shots, goal = null, plans = []) {
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

  // Re-point any plan that was running this session, so an undone delete
  // leaves the plan exactly as it was rather than silently demoted to
  // 'saved'. Skipped where another plan has since become outstanding, which
  // would break the one-outstanding-plan invariant (§7.3).
  let relinked = false;
  for (const snap of plans) {
    const p = index.practice_plans.find((x) => x.plan_id === snap.plan_id);
    if (!p || p.started_session_id) continue;
    const outstanding = getActivePlan();
    if (snap.status === 'started' && outstanding && outstanding.plan_id !== p.plan_id) continue;
    p.started_session_id = snap.started_session_id;
    p.status = snap.status;
    relinked = true;
  }
  if (relinked) saveIndex();

  return true;
}

// Deletes every session whose data_source is strictly 'test' (never by
// date, name, shot count, or any other heuristic) and their shots. Sessions
// with no data_source at all, or any value other than exactly 'test', are
// real and are never touched. Per-session failures are collected rather
// than aborting the whole batch, so one bad write can't leave the rest
// undeleted.
// Removes every session AND every round marked as test data. Rounds were
// missing here, which left generated test rounds sitting in History and in
// round-to-round comparisons with no way to remove them short of erasing
// everything. Counted and reported together, since to the golfer they are
// one pile of fake data rather than two.
export function deleteAllTestSessions() {
  const index = loadIndex();
  const sessionIds = index.sessions.filter((s) => sessionDataSource(s) === 'test').map((s) => s.session_id);
  const roundIds = index.rounds.filter((r) => sessionDataSource(r) === 'test').map((r) => r.round_id);

  let deleted = 0;
  const failed = [];
  for (const id of sessionIds) {
    try {
      if (deleteSession(id, { allowInProgress: true })) deleted++;
    } catch (e) {
      failed.push(id);
    }
  }
  for (const id of roundIds) {
    try {
      if (deleteRound(id, { allowInProgress: true })) deleted++;
    } catch (e) {
      failed.push(id);
    }
  }
  return { deleted, failed, total: sessionIds.length + roundIds.length };
}

// ---------- Shots ----------

export function addShot(sessionId, fields) {
  // Strike is what every analysis in the app counts, and a write that
  // carries none — a caller using the wrong field names, say — used to be
  // stored silently as a shot with undefined values, reading afterwards as
  // 0% solid rather than as the mistake it was.
  //
  // Direction is required with it, except on a miss: a whiff has no ball
  // flight, so shot entry skips direction, height and distance entirely and
  // stores nulls for all three.
  const isMiss = fields?.strike === 'miss';
  if (!STRIKE.includes(fields?.strike) || (!isMiss && !DIRECTION.includes(fields?.direction))) {
    console.error('Next Ball: refused a shot with no recognized strike/direction', fields);
    return null;
  }

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
  // A swing recorded since the last shot belongs to THIS shot. Linking here
  // rather than in the UI means every path that logs a shot gets it, and no
  // screen has to remember to ask.
  linkPendingSwingVideoToShot(sessionId, shot.shot_id);
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
  // The footage outlives the outcome (§19).
  unpairSwingVideosForShots([...idSet]);
  return removedCount;
}

export function deleteLastShot(sessionId) {
  const shotsForSession = loadShotsChunk(sessionId);
  if (shotsForSession.length === 0) return null;
  let last = shotsForSession[0];
  for (const s of shotsForSession) if (s.shot_number > last.shot_number) last = s;
  _shotsCache.set(sessionId, shotsForSession.filter((s) => s.shot_id !== last.shot_id));
  saveShotsChunk(sessionId);
  // Undo removes the outcome, not the swing.
  unpairSwingVideosForShots([last.shot_id]);
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

// ----- Cached course geometry (docs/course-mode-spec.md §14) -----
//
// Course geometry is fetched from Overpass once and cached permanently on
// the course record. Greens and tees do not move, the service is
// unreliable under load (§14.12.1), and a golfer standing on the first tee
// must never wait on a network call — so a course is looked up at most once
// and every later round reads this.
//
// Stored coordinates use `{ lat, lon }` throughout, unlike the course's own
// single `latitude`/`longitude` venue point: a green is a 20-50 vertex ring
// and the long key names roughly double what that costs in localStorage.

// Normalize-on-load for a single course, same idiom as loadIndex()'s arrays:
// a course saved before §14 simply gains these keys on read rather than
// through a migration.
function normalizeCourseGeometry(course) {
  if (!course) return course;
  if (course.geometry === undefined) course.geometry = null;
  if (!Array.isArray(course.tees)) course.tees = [];
  if (course.selected_tee_id === undefined) course.selected_tee_id = null;
  // A lookup that found nothing is worth remembering too — otherwise every
  // visit to an unmapped course re-queries a service that already answered.
  if (course.geometry_checked_at === undefined) course.geometry_checked_at = null;
  // When the golfer last authored this course's pars, by playing a round
  // here or editing them. Null means hole_defs still holds the template
  // floor, which is indistinguishable from a real par by value alone —
  // normalizeHoleDefs fills every hole whether or not anyone chose it. A
  // traced par may pre-fill only while this is null (§14.7).
  if (course.pars_set_at === undefined) course.pars_set_at = null;
  return course;
}

export function getCourseGeometry(courseId) {
  const course = getCourse(courseId);
  if (!course) return null;
  return normalizeCourseGeometry(course).geometry;
}

// Records the result of a geometry lookup. `geometry` may be null, which is
// the honest record of "we asked and this course has no mapping" — that is
// half of all courses (§14.12.1) and must not trigger a re-fetch every time.
// Pass `tees` (from teeSetsFromGeometry) to publish measured tee sets.
export function setCourseGeometry(courseId, geometry, tees = null) {
  const course = getCourse(courseId);
  if (!course) return null;
  normalizeCourseGeometry(course);

  course.geometry = geometry || null;
  course.geometry_checked_at = nowISO();
  if (Array.isArray(tees)) {
    course.tees = tees;
    // First measured tee set becomes the default, shortest first — §14.3's
    // "first visit defaults to the course's shortest published tee, which is
    // the safest assumption and always changeable."
    if (!course.selected_tee_id && tees.length) {
      course.selected_tee_id = tees.reduce((a, b) => (b.total_yards < a.total_yards ? b : a)).tee_id;
    }
  }
  course.updated_at = nowISO();
  saveIndex();
  return course;
}

// Whether this course has already been asked about, so a caller can skip a
// repeat lookup. Separate from "has geometry" precisely because a negative
// answer is still an answer.
export function courseGeometryChecked(courseId) {
  const course = getCourse(courseId);
  return !!course && !!normalizeCourseGeometry(course).geometry_checked_at;
}

export function getCourseTees(courseId) {
  const course = getCourse(courseId);
  return course ? normalizeCourseGeometry(course).tees : [];
}

// §14.3: the most recently selected tee for a course is remembered and
// pre-selected on return. Rejects an unknown id rather than storing a
// dangling reference.
export function setSelectedTee(courseId, teeId) {
  const course = getCourse(courseId);
  if (!course) return null;
  normalizeCourseGeometry(course);
  if (teeId !== null && !course.tees.some((t) => t.tee_id === teeId)) return course;
  course.selected_tee_id = teeId;
  course.updated_at = nowISO();
  saveIndex();
  return course;
}

export function getSelectedTee(courseId) {
  const course = getCourse(courseId);
  if (!course) return null;
  normalizeCourseGeometry(course);
  return course.tees.find((t) => t.tee_id === course.selected_tee_id) || null;
}

// The green a hole can measure to, from either source. Provider geometry and
// a green the golfer captured are deliberately distinguishable by `source`
// (§14.13.5) — never present a captured point as surveyed data.
// The hole definitions a round should snapshot: par from what the golfer has
// set (or the template floor, §11.5), yardage from the selected tee.
//
// §14.12.3 keeps the round's shape unchanged — one `hole_defs` array with a
// single yardage — so §6, §9 and roundAnalysis.js see exactly what they
// always have. Selecting a tee chooses which set of numbers is copied in;
// it never reaches the round's structure, and never touches green geometry.
//
// Yardage precedence, per §14.12.3 ("a golfer-entered yardage always wins
// over a computed one"):
//   1. the course's own hole_defs yardage, where one exists
//   2. the selected tee's measured yardage
//   3. null — never invented, so display omits it rather than showing "— yd"
export function resolveHoleDefs(courseId, { holeCount, teeId } = {}) {
  const course = getCourse(courseId);
  const count = normalizeHoleCount(holeCount ?? course?.hole_count);
  const template = defaultHoleDefs(count);
  if (!course) return template;

  normalizeCourseGeometry(course);
  const tee = teeId != null
    ? course.tees.find((t) => t.tee_id === teeId)
    : course.tees.find((t) => t.tee_id === course.selected_tee_id);

  // A traced par pre-fills ONLY while the golfer has not set their own.
  // §14.7: par from a trace is an enhancement, never a replacement for
  // §11.5's golfer-entered floor. Once pars_set_at exists they win, because
  // the golfer stood on the hole and OSM did not.
  const tracedPars = course.pars_set_at ? null : course.geometry?.holes;

  return template.map((d, i) => {
    const own = course.hole_defs?.find((c) => c.hole_number === d.hole_number);
    const traced = tracedPars?.find((h) => h.hole_number === d.hole_number)?.par;
    const teeYardage = tee?.hole_yardages?.[i];
    return {
      hole_number: d.hole_number,
      par: course.pars_set_at ? (own?.par ?? d.par) : (Number.isFinite(traced) ? traced : (own?.par ?? d.par)),
      yardage: own?.yardage ?? (Number.isFinite(teeYardage) ? teeYardage : null),
    };
  });
}

// Edit Course Info's save. Distinct from upsertCourse because it records
// that these pars are the golfer's, which is what stops a traced par from
// pre-filling over them afterwards.
export function setCoursePars(courseId, { name, hole_count, hole_defs } = {}) {
  const course = getCourse(courseId);
  if (!course) return null;
  normalizeCourseGeometry(course);
  if (typeof name === 'string' && name.trim()) course.name = name.trim();
  if (hole_count !== undefined) course.hole_count = normalizeHoleCount(hole_count);
  if (hole_defs !== undefined) {
    course.hole_defs = normalizeHoleDefs(hole_defs, course.hole_count);
    course.pars_set_at = nowISO();
  }
  course.updated_at = nowISO();
  saveIndex();
  return course;
}

// Total published yardage for a tee, over the holes actually being played.
// Returns null when nothing is known, so the Total Yards cell is omitted
// rather than rendered as "— yd" (§14.2).
export function totalYardsForTee(courseId, { holeCount, teeId } = {}) {
  const defs = resolveHoleDefs(courseId, { holeCount, teeId });
  const known = defs.filter((d) => Number.isFinite(d.yardage));
  if (!known.length) return null;
  return known.reduce((t, d) => t + d.yardage, 0);
}

export function getGreenForHole(courseId, holeNumber) {
  const geometry = getCourseGeometry(courseId);
  const hole = geometry?.holes?.find((h) => h.hole_number === holeNumber);
  return hole?.green || null;
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
  if (hole_defs !== undefined) {
    course.hole_defs = normalizeHoleDefs(hole_defs, course.hole_count);
    // Played with these pars, so they are the golfer's from here on and a
    // later trace must not overwrite them.
    normalizeCourseGeometry(course).pars_set_at = nowISO();
  }
  course.play_count = (course.play_count || 0) + 1;
  course.last_played_at = nowISO();
  course.updated_at = nowISO();
  saveIndex();
  return course;
}


// ----- Swing videos (docs/swing-lab-spec.md §20.1) -----
//
// METADATA ONLY. The bytes live in the media tier (js/media.js); this record
// holds a `media_ref` pointing at them.
//
// The separation is the point. Browser storage is evictable, so the bytes
// can disappear without warning — and when they do, the record survives and
// says so (`media_state`) rather than becoming a reference to nothing
// (lesson-spec.md §7.2). It is also what lets a future backend swap a local
// key for a remote object reference without touching anything else
// (backend-readiness.md §18).

export const CAMERA_VIEWS = ['face_on', 'down_the_line', 'unknown'];

// 'present'  bytes are in the media tier
// 'missing'  the record exists, the bytes do not — eviction, a failed save,
//            or a backup restored onto a different device
export const MEDIA_STATES = ['present', 'missing'];

// 'unpaired' is the default rather than an error: a swing with no shot is a
// complete record that simply has no outcome to compare against.
export const ASSOCIATION_STATES = ['pending', 'linked', 'unpaired'];

function normalizeView(view) {
  return CAMERA_VIEWS.includes(view) ? view : 'unknown';
}

// `media_ref` is required: a SwingVideo that names no media is not a video.
// Everything else is optional, because at import time most of it is either
// unknown or none of the app's business yet.
// The id may be supplied. Import needs it BEFORE the record exists, because
// the media key is built from it — see js/swingMedia.js.
export function newSwingVideoId() { return uuid(); }

export function createSwingVideo(fields = {}) {
  if (!fields.media_ref) return null;
  const index = loadIndex();
  const ts = nowISO();
  const record = {
    swing_video_id: fields.swing_video_id || uuid(),
    // When the swing was filmed, where that is knowable, falling back to
    // when it entered the app. A golfer importing last week's range session
    // is recording something that already happened.
    captured_at: fields.captured_at || ts,
    imported_at: ts,
    club: fields.club || null,
    camera_view: normalizeView(fields.camera_view),
    original_filename: fields.original_filename || null,

    // What the file is. Every one of these may be null, and null means
    // UNKNOWN — never a default. §3.1 is explicit that 30 fps must not be
    // assumed, and that applies to every field here.
    duration_ms: fields.duration_ms ?? null,
    // Container dimensions and presentation dimensions are both kept
    // because they disagree on ordinary iPhone footage: the container
    // stores 1920x1080 plus a rotation, the decoder hands back 1080x1920.
    width: fields.width ?? null,
    height: fields.height ?? null,
    display_width: fields.display_width ?? null,
    display_height: fields.display_height ?? null,
    rotation_deg: fields.rotation_deg ?? null,
    fps: fields.fps ?? null,
    // iPhone records variable frame rate, so an average fps can be a number
    // that lies. Recording the fact protects anything computed from timing.
    variable_frame_rate: fields.variable_frame_rate ?? null,
    frame_count: fields.frame_count ?? null,
    size_bytes: fields.size_bytes ?? null,
    container: fields.container || null,
    codec: fields.codec || null,
    mime: fields.mime || null,

    media_ref: fields.media_ref,
    media_state: 'present',
    thumb_ref: fields.thumb_ref || null,

    // How this swing relates to a logged Shot.
    //
    //   'pending'   recorded, waiting for the NEXT shot to be logged
    //   'linked'    attached to a shot, which carries the outcome
    //   'unpaired'  no shot, and none is coming — a complete record, not
    //               a failure (§17). The golfer filmed a swing and did not
    //               log its result, which is an ordinary thing to do.
    //
    // A video and a shot are independently durable: either may exist
    // without the other, and deleting one never deletes the other.
    association_state: ASSOCIATION_STATES.includes(fields.association_state) ? fields.association_state : 'unpaired',
    shot_id: fields.shot_id || null,

    // Association only. Deleting a video must never cascade into these, and
    // deleting one of these must never cascade into the video.
    lesson_id: fields.lesson_id || null,
    range_session_id: fields.range_session_id || null,
    // A COPY of the Active Swing Focus, never a pointer (lesson-spec.md
    // §5.2) — so correcting a lesson's wording later cannot rewrite what
    // this swing was filmed under.
    active_focus_snapshot: fields.active_focus_snapshot ?? null,
    // Everything else that was true of the practice when this was filmed —
    // club, drill, training aid, target. Also a copy, for the same reason:
    // session defaults move during a session and history must not move
    // with them (§10, §20).
    practice_context: fields.practice_context ?? null,

    created_at: ts,
    updated_at: ts,
  };
  index.swing_videos.push(record);
  if (!saveIndex()) {
    index.swing_videos.pop();
    return null;
  }
  return record;
}

export function getSwingVideo(id) {
  return loadIndex().swing_videos.find((v) => v.swing_video_id === id) || null;
}

// Newest first, by when the swing was filmed rather than when it was
// imported — the same ordering History uses for lessons.
export function listSwingVideos() {
  return loadIndex().swing_videos.slice().sort((a, b) => {
    const byCaptured = String(b.captured_at).localeCompare(String(a.captured_at));
    return byCaptured !== 0 ? byCaptured : String(b.created_at).localeCompare(String(a.created_at));
  });
}

export function updateSwingVideo(id, patch = {}) {
  const record = getSwingVideo(id);
  if (!record) return null;
  const allowed = ['club', 'camera_view', 'lesson_id', 'range_session_id', 'media_state', 'thumb_ref', 'captured_at', 'practice_context'];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === 'camera_view') record.camera_view = normalizeView(patch.camera_view);
    else if (key === 'media_state') record.media_state = MEDIA_STATES.includes(patch.media_state) ? patch.media_state : record.media_state;
    else record[key] = patch[key];
  }
  record.updated_at = nowISO();
  saveIndex();
  return record;
}

// Marks the bytes gone while keeping the record. Called when a read finds
// nothing, which is how eviction is discovered — there is no event for it.
export function markSwingVideoMissing(id) {
  return updateSwingVideo(id, { media_state: 'missing' });
}

// Removes the RECORD and returns the media keys the caller must now delete.
//
// Records first, bytes second, deliberately. A crash between the two leaves
// orphaned bytes, which are invisible and swept later (media.sweepOrphans);
// the other order would leave a record pointing at nothing, which is a bug
// the golfer can see. See js/swingMedia.js for the orchestration.
export function deleteSwingVideo(id) {
  const index = loadIndex();
  const i = index.swing_videos.findIndex((v) => v.swing_video_id === id);
  if (i === -1) return null;

  const [removed] = index.swing_videos.splice(i, 1);
  if (!saveIndex()) {
    index.swing_videos.splice(i, 0, removed);
    throw Object.assign(new Error('Failed to delete swing video'), { code: 'storage_error' });
  }
  // Analyses are meaningless without the video that produced them, and are
  // recomputable if it ever returns. The Shot is untouched (§19).
  deleteSwingAnalysesForVideo(id);
  return {
    record: removed,
    mediaRefs: [removed.media_ref, removed.thumb_ref].filter(Boolean),
  };
}

// Every media key any record still points at. The input to orphan sweeping.
export function allSwingMediaRefs() {
  const refs = [];
  for (const v of loadIndex().swing_videos) {
    if (v.media_ref) refs.push(v.media_ref);
    if (v.thumb_ref) refs.push(v.thumb_ref);
  }
  return refs;
}

// ----- Swing video <-> shot association (swing-lab-spec.md; V4.3) -----
//
// The Shot stays the primary object of a range session. A SwingVideo
// ENRICHES a shot when both describe the same swing, and neither depends on
// the other existing:
//
//   a shot with no video    ordinary — most shots, for most golfers
//   a video with no shot    ordinary — filmed a swing, did not log it
//
// Association is automatic and never asked about. A recorded swing is
// PENDING until the next shot is logged, at which point it links to THAT
// shot — never the previous one, which was a different swing.

// At most one video per session may be waiting for the next shot. A second
// recording does not queue behind the first; see setPendingSwingVideo.
export function getPendingSwingVideo(sessionId) {
  if (!sessionId) return null;
  return loadIndex().swing_videos.find(
    (v) => v.range_session_id === sessionId && v.association_state === 'pending',
  ) || null;
}

// Makes a video the one waiting for the next shot, demoting any previous
// pending video to unpaired.
//
// §18: recording twice before logging a shot must not delete either video
// and must not stop to ask. The older swing was still really swung — it
// simply never got an outcome, which is exactly what 'unpaired' means.
export function setPendingSwingVideo(swingVideoId) {
  const index = loadIndex();
  const video = index.swing_videos.find((v) => v.swing_video_id === swingVideoId);
  if (!video) return null;

  let demoted = null;
  const previous = getPendingSwingVideo(video.range_session_id);
  if (previous && previous.swing_video_id !== swingVideoId) {
    previous.association_state = 'unpaired';
    previous.updated_at = nowISO();
    demoted = previous;
  }

  video.association_state = 'pending';
  video.shot_id = null;
  video.updated_at = nowISO();
  saveIndex();
  return { pending: video, demoted };
}

// Attaches the session's pending video to a shot. Called from addShot, so
// the golfer is never asked "attach this swing?" — by the time there is a
// question to ask, the answer is already known.
export function linkPendingSwingVideoToShot(sessionId, shotId) {
  const pending = getPendingSwingVideo(sessionId);
  if (!pending || !shotId) return null;

  const index = loadIndex();
  pending.association_state = 'linked';
  pending.shot_id = shotId;
  pending.updated_at = nowISO();

  // The shot carries the reverse reference, and only the reference — never
  // the video itself. A shot chunk holds hundreds of rows and must stay
  // small enough to load on every session open.
  const shots = loadShotsChunk(sessionId);
  const shot = shots.find((s) => s.shot_id === shotId);
  if (shot) {
    shot.swing_video_id = pending.swing_video_id;
    saveShotsChunk(sessionId);
  }
  // An analysis made before the shot existed gains its context without
  // recomputing anything (§17).
  enrichSwingAnalysisWithShot(pending.swing_video_id, shotId);
  saveIndex();
  void index;
  return pending;
}

// Everything filmed during one session, newest first — linked, pending and
// unpaired alike.
export function listSwingVideosForSession(sessionId) {
  if (!sessionId) return [];
  return loadIndex().swing_videos
    .filter((v) => v.range_session_id === sessionId)
    .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}

export function getSwingVideoForShot(shotId) {
  if (!shotId) return null;
  return loadIndex().swing_videos.find((v) => v.shot_id === shotId) || null;
}

// A video whose shot has gone becomes unpaired rather than being deleted.
//
// §19: the two are independently durable. Deleting a shot removes an
// outcome; it does not un-swing the swing, and the footage is often the
// more valuable half.
export function unpairSwingVideosForShots(shotIds) {
  const ids = new Set((shotIds || []).filter(Boolean));
  if (!ids.size) return 0;
  const index = loadIndex();
  let changed = 0;
  for (const v of index.swing_videos) {
    if (v.shot_id && ids.has(v.shot_id)) {
      v.shot_id = null;
      v.association_state = 'unpaired';
      v.updated_at = nowISO();
      changed += 1;
    }
  }
  if (changed) saveIndex();
  return changed;
}

// Called when a session ends: a swing still waiting for a shot that will
// never come is not lost, it is simply unpaired (§17).
export function settlePendingSwingVideos(sessionId) {
  const index = loadIndex();
  let settled = 0;
  for (const v of index.swing_videos) {
    if (v.range_session_id === sessionId && v.association_state === 'pending') {
      v.association_state = 'unpaired';
      v.updated_at = nowISO();
      settled += 1;
    }
  }
  if (settled) saveIndex();
  return settled;
}

// ----- Swing analyses (swing-lab-spec.md §20.2, §20.4) -----
//
// Derived, versioned, and disposable. The VIDEO is the user's media and is
// immutable; an analysis is what one version of the engine made of it, and
// a better engine may supersede it later.
//
// Re-analysis therefore ADDS a record rather than overwriting one (§16).
// Provenance is never silently lost: every analysis names the engine,
// model and rules that produced it, so two numbers can always be compared
// knowing whether they came from the same detector.

export function createSwingAnalysis(fields = {}) {
  if (!fields.swing_video_id) return null;
  const index = loadIndex();
  const ts = nowISO();
  const record = {
    swing_analysis_id: uuid(),
    swing_video_id: fields.swing_video_id,

    // Provenance. One integer for the pipeline, plus the components, so a
    // comparison across versions can be flagged rather than silently mixed.
    analysis_version: fields.analysis_version ?? 1,
    pose_model: fields.pose_model ?? null,
    pose_model_version: fields.pose_model_version ?? null,
    measurement_version: fields.measurement_version ?? 1,

    // What was actually analysed: the dense window inside the source clip.
    swing_window: fields.swing_window ?? null,
    camera_view: fields.camera_view ?? 'unknown',
    source: fields.source ?? null,

    video_quality: fields.video_quality ?? null,
    capability: fields.capability ?? null,

    detected_phases: fields.detected_phases ?? [],
    measurements: fields.measurements ?? [],
    observations: fields.observations ?? [],
    signals: fields.signals ?? null,
    // A downsampled skeleton for the overlay — see buildPoseFrames. The
    // full series is large and recomputable, so it is not stored.
    pose_frames: fields.pose_frames ?? [],

    // Context is carried for provenance and for the future interpretation
    // layer. It never influenced a measurement: pose is computed from the
    // video alone, and a fat shot must not make the engine go looking for
    // a fault (§18, §19).
    shot_id: fields.shot_id ?? null,
    range_session_id: fields.range_session_id ?? null,
    active_focus_snapshot: fields.active_focus_snapshot ?? null,
    lesson_id: fields.lesson_id ?? null,

    timing: fields.timing ?? null,
    status: fields.status ?? 'complete',
    created_at: ts,
  };
  index.swing_analyses.push(record);
  if (!saveIndex()) { index.swing_analyses.pop(); return null; }
  return record;
}

export function getSwingAnalysis(id) {
  return loadIndex().swing_analyses.find((a) => a.swing_analysis_id === id) || null;
}

// Every analysis of one video, newest first — the history, not just the
// latest. The UI may show only the newest; the record keeps the rest.
export function listSwingAnalyses(swingVideoId) {
  const all = loadIndex().swing_analyses;
  // Insertion order is the tie-break, and it is load-bearing: two analyses
  // of the same video can be created inside one millisecond, and comparing
  // created_at alone then returns them in storage order — which made
  // getLatestSwingAnalysis hand back the OLDEST result after a re-analysis.
  return all
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.swing_video_id === swingVideoId)
    .sort((x, y) => String(y.a.created_at).localeCompare(String(x.a.created_at)) || (y.i - x.i))
    .map(({ a }) => a);
}

export function getLatestSwingAnalysis(swingVideoId) {
  return listSwingAnalyses(swingVideoId)[0] || null;
}

// Attaches a shot to an analysis made BEFORE the shot existed.
//
// §17: deterministic pose measurements do not change because an outcome
// arrived — the movement was the movement. Only the context is enriched, so
// nothing is recomputed and nothing is thrown away.
export function enrichSwingAnalysisWithShot(swingVideoId, shotId) {
  const index = loadIndex();
  let changed = 0;
  for (const a of index.swing_analyses) {
    if (a.swing_video_id === swingVideoId && !a.shot_id) { a.shot_id = shotId; changed += 1; }
  }
  if (changed) saveIndex();
  return changed;
}

export function deleteSwingAnalysesForVideo(swingVideoId) {
  const index = loadIndex();
  const before = index.swing_analyses.length;
  index.swing_analyses = index.swing_analyses.filter((a) => a.swing_video_id !== swingVideoId);
  const removed = before - index.swing_analyses.length;
  if (removed) saveIndex();
  return removed;
}

// ----- Lessons (docs/lesson-spec.md §2) -----
//
// A record of formal instruction, and the only place in the app whose text
// the app is forbidden to touch. §2.2: cue and note text is stored and shown
// exactly as entered — never summarised, rephrased, corrected or expanded.
// A coach's phrasing carries meaning the app cannot see, so it is verbatim
// or absent. Nothing here trims case, fixes grammar or expands shorthand;
// the only normalisation is whitespace at the ends, which is typing noise
// rather than phrasing.

// §2.1: the cap is the feature, not a guardrail. A lesson that accepts ten
// cues becomes a journal, and a journal is not carried onto a range mat.
export const MAX_LESSON_CUES = 3;

export const LESSON_STATUSES = ['active', 'archived'];

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Cues and drills share a shape deliberately: both are short ordered lines
// of the instructor's own words, and one editor serves both. `order` is
// 1-based and reassigned on every write so it always matches position —
// the Active Swing Focus points at a cue by order, so a gap would break it.
function normalizeOrderedText(list, { max = Infinity } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === 'string' ? { text: item } : item))
    .map((item) => cleanText(item?.text))
    .filter((text) => text.length > 0)
    .slice(0, max)
    .map((text, i) => ({ order: i + 1, text }));
}

// Drills carry no cap. The three-cue limit exists because a golfer cannot
// hold more than one swing thought on the mat; drills are what they DO,
// closer to a plan's steps than to a cue, and a lesson may legitimately
// come with several.
export function normalizeLessonCues(cues) {
  return normalizeOrderedText(cues, { max: MAX_LESSON_CUES });
}

export function normalizeLessonDrills(drills) {
  return normalizeOrderedText(drills);
}

// §2.1: nothing is required except a date and one cue. A one-cue lesson is
// a complete lesson, and the model says so by refusing everything else.
export function createLesson(fields = {}) {
  const index = loadIndex();
  const cues = normalizeLessonCues(fields.cues);
  const date = cleanText(fields.date);
  if (!date || !cues.length) return null;

  const ts = nowISO();
  const lesson = {
    lesson_id: uuid(),
    // The lesson date, not the entry date — a golfer typing this up on the
    // drive home is recording something that already happened.
    date,
    instructor_name: cleanText(fields.instructor_name) || null,
    // Venue fields match a session's, so the same resolution and display
    // helpers work on both rather than a second location shape existing.
    location_name: cleanText(fields.location_name) || null,
    location_city: cleanText(fields.location_city) || null,
    location_state: cleanText(fields.location_state) || null,
    location_place_id: fields.location_place_id || null,
    topics: Array.isArray(fields.topics) ? fields.topics.map(cleanText).filter(Boolean) : [],
    cues,
    drills: normalizeLessonDrills(fields.drills),
    notes: typeof fields.notes === 'string' ? fields.notes.trim() : '',
    // §7: empty until video ships. Present from the first record so phase
    // two adds no field to existing lessons.
    video_ids: [],
    status: LESSON_STATUSES.includes(fields.status) ? fields.status : 'active',
    data_source: fields.data_source === 'test' ? 'test' : 'real',
    created_at: ts,
    updated_at: ts,
  };
  index.lessons.push(lesson);
  saveIndex();
  return lesson;
}

export function getLesson(lessonId) {
  return loadIndex().lessons.find((l) => l.lesson_id === lessonId) || null;
}

// Newest lesson first, by the lesson's own date and then by entry order, so
// two lessons on one day stay in the order they were recorded.
export function listLessons() {
  return loadIndex().lessons.slice().sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    return byDate !== 0 ? byDate : String(b.created_at).localeCompare(String(a.created_at));
  });
}

// §2.3: every field is editable, created_at is preserved, updated_at tracks
// the edit, and editing is not versioned — the current text is the text.
//
// Editing deliberately does NOT reach into anything downstream. Past
// sessions hold their own snapshot (§5.2) and plans hold their own copy of
// the text (§4.4), so a correction here changes the present and nothing
// else. The Active Swing Focus follows, because it is a pointer — that is
// a correction to the present, not to the past.
export function updateLesson(lessonId, patch = {}) {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;

  if (patch.date !== undefined) {
    const date = cleanText(patch.date);
    if (date) lesson.date = date;
  }
  if (patch.instructor_name !== undefined) lesson.instructor_name = cleanText(patch.instructor_name) || null;
  if (patch.location_name !== undefined) lesson.location_name = cleanText(patch.location_name) || null;
  if (patch.location_city !== undefined) lesson.location_city = cleanText(patch.location_city) || null;
  if (patch.location_state !== undefined) lesson.location_state = cleanText(patch.location_state) || null;
  if (patch.location_place_id !== undefined) lesson.location_place_id = patch.location_place_id || null;
  if (patch.topics !== undefined) {
    lesson.topics = Array.isArray(patch.topics) ? patch.topics.map(cleanText).filter(Boolean) : [];
  }
  if (patch.cues !== undefined) {
    const cues = normalizeLessonCues(patch.cues);
    // A lesson with no cues is not a lesson (§2.1), so an edit that would
    // empty them is refused rather than applied — the golfer keeps what
    // they had instead of losing the record to a mistake.
    if (cues.length) lesson.cues = cues;
  }
  if (patch.drills !== undefined) lesson.drills = normalizeLessonDrills(patch.drills);
  if (patch.notes !== undefined) lesson.notes = typeof patch.notes === 'string' ? patch.notes.trim() : '';
  if (patch.status !== undefined && LESSON_STATUSES.includes(patch.status)) lesson.status = patch.status;

  lesson.updated_at = nowISO();
  saveIndex();

  // If the focus pointed at a cue that no longer exists — the golfer
  // deleted the third cue while it was the focus — fall back to the first
  // rather than leaving a pointer into nothing.
  reconcileActiveSwingFocus();
  return lesson;
}

// §2.4: offered on the next lesson, using the same deterministic
// frequency-plus-recency shape as club quick picks (ux-spec.md §3.7). Test
// lessons never influence it, exactly as test sessions never influence
// club picks.
export function recentInstructorNames(limit = 3) {
  const counts = new Map();
  for (const l of loadIndex().lessons) {
    if (sessionDataSource(l) === 'test') continue;
    const name = cleanText(l.instructor_name);
    if (!name) continue;
    const prev = counts.get(name) || { name, count: 0, last: '' };
    prev.count += 1;
    if (String(l.date) > prev.last) prev.last = String(l.date);
    counts.set(name, prev);
  }
  return [...counts.values()]
    .sort((a, b) => (b.count - a.count) || String(b.last).localeCompare(String(a.last)))
    .slice(0, limit)
    .map((e) => e.name);
}

// Removing a lesson takes the artifacts that cannot outlive it: the Active
// Swing Focus if it pointed here, and any practice plan this lesson
// produced — the same rule deleteRound() applies to a round's plans, for
// the same reason. A plan whose source is gone could not explain itself.
//
// Past SESSIONS are deliberately untouched: they hold a snapshot, not a
// reference, so a session practised under this lesson keeps its cue text
// and stays truthful after the lesson is gone (§5.2).
export function deleteLesson(lessonId) {
  const index = loadIndex();
  const idx = index.lessons.findIndex((l) => l.lesson_id === lessonId);
  if (idx === -1) return null;

  const removedLesson = index.lessons[idx];
  const removedPlans = index.practice_plans.filter((p) => p.lesson_id === lessonId);
  const focus = index.settings.active_swing_focus;
  const removedFocus = focus && focus.lesson_id === lessonId ? { ...focus } : null;

  index.lessons.splice(idx, 1);
  if (removedPlans.length) {
    index.practice_plans = index.practice_plans.filter((p) => p.lesson_id !== lessonId);
  }
  if (removedFocus) index.settings.active_swing_focus = null;

  if (!saveIndex()) {
    index.lessons.splice(idx, 0, removedLesson);
    if (removedPlans.length) index.practice_plans.push(...removedPlans);
    if (removedFocus) index.settings.active_swing_focus = removedFocus;
    throw Object.assign(new Error('Failed to delete lesson'), { code: 'storage_error' });
  }
  return { lesson: removedLesson, plans: removedPlans, focus: removedFocus };
}

// The counterpart to deleteLesson, for a brief Undo window — same contract
// as restoreRound(): it trusts the caller to pass back exactly what was
// removed, and returns false rather than throwing.
export function restoreLesson(lesson, plans = [], focus = null) {
  const index = loadIndex();
  if (!lesson || index.lessons.some((l) => l.lesson_id === lesson.lesson_id)) return false;

  index.lessons.push(lesson);
  for (const p of plans) {
    if (!index.practice_plans.some((x) => x.plan_id === p.plan_id)) index.practice_plans.push(p);
  }
  // Only restored if the golfer has not set a different focus meanwhile —
  // undoing a delete must not yank away a focus they chose since.
  if (focus && !index.settings.active_swing_focus) index.settings.active_swing_focus = focus;
  return saveIndex();
}

// ----- Active Swing Focus (docs/lesson-spec.md §3) -----
//
// One focus, app-wide, at a time. Stored as a POINTER — {lesson_id,
// cue_order} — so that correcting a lesson's wording corrects the focus
// too. Everything that records history stores a COPY instead (see
// createSession's swing_focus), which is what keeps a correction to the
// present from rewriting the past.
//
// It never expires. A golfer who has not practised in a month still has the
// same swing thought, and §9.7 forbids the app clearing the instructor's
// guidance on its own initiative. Only a newer lesson's focus or an
// explicit clear replaces it.

export function setActiveSwingFocus(lessonId, cueOrder = 1) {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;
  const cue = lesson.cues.find((c) => c.order === cueOrder) || lesson.cues[0];
  if (!cue) return null;

  const index = loadIndex();
  index.settings.active_swing_focus = {
    lesson_id: lesson.lesson_id,
    cue_order: cue.order,
    set_at: nowISO(),
  };
  saveIndex();
  return getActiveSwingFocus();
}

// Resolves the pointer against the CURRENT lesson, so an edited cue is
// reflected immediately. Returns null when nothing is set, and self-heals
// when the lesson behind it has gone.
export function getActiveSwingFocus() {
  const focus = loadIndex().settings.active_swing_focus;
  if (!focus) return null;
  const lesson = getLesson(focus.lesson_id);
  if (!lesson) { clearActiveSwingFocus(); return null; }
  const cue = lesson.cues.find((c) => c.order === focus.cue_order) || lesson.cues[0];
  if (!cue) { clearActiveSwingFocus(); return null; }
  return {
    lesson_id: lesson.lesson_id,
    cue_order: cue.order,
    cue_text: cue.text,
    instructor_name: lesson.instructor_name,
    lesson_date: lesson.date,
    set_at: focus.set_at,
    // The other cues from the same lesson. Never shown on Home (§3) — the
    // point of the feature is to carry ONE swing thought — but the Lesson
    // Summary shows them, one deliberate tap away.
    supporting_cues: lesson.cues.filter((c) => c.order !== cue.order),
  };
}

// §11.2, decided: the golfer can always clear it; the app never does on its
// own. Clearing does not touch the lesson.
export function clearActiveSwingFocus() {
  const index = loadIndex();
  if (!index.settings.active_swing_focus) return null;
  index.settings.active_swing_focus = null;
  saveIndex();
  return null;
}

// Keeps the pointer valid after an edit removed the cue it named. Silent by
// design: falling back to the lesson's first cue is closer to the golfer's
// intent than clearing their focus because they deleted a line.
function reconcileActiveSwingFocus() {
  const index = loadIndex();
  const focus = index.settings.active_swing_focus;
  if (!focus) return;
  const lesson = getLesson(focus.lesson_id);
  if (!lesson || !lesson.cues.length) { index.settings.active_swing_focus = null; saveIndex(); return; }
  if (!lesson.cues.some((c) => c.order === focus.cue_order)) {
    focus.cue_order = lesson.cues[0].order;
    saveIndex();
  }
}

// The snapshot a session stores at creation (§5.2). A copy, never a
// reference: an earlier draft of the spec stored an id, under which
// correcting a typo three weeks later would silently re-label every past
// session that pointed at it. Editing a lesson is a routine action, so a
// reference is a latent data-integrity bug rather than a shortcut.
export function swingFocusSnapshot() {
  const focus = getActiveSwingFocus();
  if (!focus) return null;
  return {
    lesson_id: focus.lesson_id,   // provenance and linking only
    cue_order: focus.cue_order,
    cue_text: focus.cue_text,     // the wording AS PRACTISED
    instructor_name: focus.instructor_name,
    lesson_date: focus.lesson_date,
    captured_at: nowISO(),
  };
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
    // Which tee the snapshotted yardages came from (§14.3). Recorded on the
    // round, not read back through the course, so History and Explore Round
    // can still say what a round was played off after the course has been
    // re-fetched, renamed, or its tee sets replaced. Null for a course that
    // publishes no tees, which is most of them.
    tee_id: fields.tee_id ?? null,
    tee_name: fields.tee_name ?? null,
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
// Idempotent: finishing a round that is already finished returns it
// untouched rather than stamping a fresh completed_at, which would move a
// round in History every time a stale screen or a double tap reached this.
export function finishRound(roundId) {
  const existing = getRound(roundId);
  if (!existing) return null;
  if (existing.status === 'finished') return existing;

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
// `allowInProgress` exists for the one caller that means it: History's
// delete, reached through a named confirmation sheet. Everywhere else an
// in-progress round is protected, so no stray call can remove a round that
// is currently being played.
export function deleteRound(roundId, { allowInProgress = false } = {}) {
  const index = loadIndex();
  const idx = index.rounds.findIndex((r) => r.round_id === roundId);
  if (idx === -1) return null;

  const removedRound = index.rounds[idx];
  if (!allowInProgress && (removedRound.status === 'active' || removedRound.status === 'paused')) {
    throw Object.assign(new Error('Cannot delete an in-progress round'), { code: 'active_round' });
  }

  const holes = getHolesForRound(roundId);
  // A practice plan has no meaning once the round that produced it is gone —
  // it exists to answer "why am I practicing this?" — so it goes with it,
  // exactly as a session's goal does. Every plan for the round goes, not just
  // the first: saving a plan twice supersedes rather than replaces, so a
  // round can own several records and removing one would strand the rest.
  const removedPlans = index.practice_plans.filter((p) => p.round_id === roundId);

  index.rounds.splice(idx, 1);
  if (removedPlans.length) {
    index.practice_plans = index.practice_plans.filter((p) => p.round_id !== roundId);
  }
  if (!saveIndex()) {
    index.rounds.splice(idx, 0, removedRound);
    if (removedPlans.length) index.practice_plans.push(...removedPlans);
    throw Object.assign(new Error('Failed to delete round'), { code: 'storage_error' });
  }

  try {
    localStorage.removeItem(holesKeyFor(roundId));
  } catch (e) {
    console.error('Next Ball: round deleted, but failed to clean up its hole data (harmless orphaned key)', e);
  }
  _holesCache.delete(roundId);

  // `plan` stays in the shape callers already destructure; `plans` carries
  // the full set so Undo can put every one of them back.
  return { round: removedRound, holes, plan: removedPlans[0] ?? null, plans: removedPlans };
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

  // Accepts either the single plan deleteRound has always returned or the
  // full `plans` array, so a round that owns several records comes back whole.
  for (const one of Array.isArray(plan) ? plan : [plan]) restorePlan(one);

  return true;

  function restorePlan(one) {
    if (!one || index.practice_plans.some((p) => p.plan_id === one.plan_id)) return;
    // Guards the one-outstanding-plan invariant the same way restoreSession
    // guards the single-active-goal one: if another plan became outstanding
    // during the undo window, the restored plan rejoins as superseded rather
    // than creating a second outstanding plan.
    const restored = { ...one };
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
  // A finished round's card is closed. Without this a stale hole screen or a
  // late tap could still mutate a completed scorecard — and its summary,
  // plan and comparisons were all computed from the card as it stood at
  // finish time.
  if (round.status === 'finished') return { hole: null, saved: false };

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
//
// A round can hold more than one plan record, because saving again supersedes
// the previous one rather than editing it in place. Taking the first match in
// storage order therefore returned a superseded record, and Round Summary
// announced "Replaced by a newer plan" for a plan nothing had replaced. An
// outstanding plan is always the answer where one exists; otherwise the most
// recently created concluded plan is the round's current story. Ties fall
// back to storage order, since two plans saved in the same millisecond carry
// identical created_at values.
export function getPlanForRound(roundId) {
  if (!roundId) return null;
  const mine = loadPlans().filter((p) => p.round_id === roundId);
  if (!mine.length) return null;
  return mine.find((p) => p.status === 'saved' || p.status === 'started')
    || mine.reduce((latest, p) => (p.created_at >= latest.created_at ? p : latest));
}

// The lesson counterpart to getPlanForRound, with identical tie-breaking —
// outstanding first, then the most recent concluded plan.
export function getPlanForLesson(lessonId) {
  if (!lessonId) return null;
  const mine = loadPlans().filter((p) => p.lesson_id === lessonId);
  if (!mine.length) return null;
  return mine.find((p) => p.status === 'saved' || p.status === 'started')
    || mine.reduce((latest, p) => (p.created_at >= latest.created_at ? p : latest));
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
// A plan's origin (lesson-spec.md §4.1). A round-derived plan and a
// lesson-derived plan are the same object with a different source: save,
// supersede, dismiss, start-as-range-session, the Home row and the
// one-outstanding-plan rule are all identical, so they share one type
// rather than forking into two that would duplicate every one of those.
export const PLAN_SOURCES = ['round', 'lesson'];

// Accepts either a round id — the original signature, which every existing
// caller still uses — or {source, roundId, lessonId}.
function normalizePlanOrigin(origin) {
  if (typeof origin === 'string') return origin ? { source: 'round', round_id: origin, lesson_id: null } : null;
  if (!origin || typeof origin !== 'object') return null;
  const source = PLAN_SOURCES.includes(origin.source) ? origin.source : (origin.lessonId ? 'lesson' : 'round');
  const round_id = origin.roundId ?? origin.round_id ?? null;
  const lesson_id = origin.lessonId ?? origin.lesson_id ?? null;
  // A plan always names its source. §7.3 used to say round_id is never
  // null; with two possible origins the invariant moves up a level, but it
  // is no weaker — a plan that could not explain where it came from is
  // still refused here.
  if (source === 'round' && !round_id) return null;
  if (source === 'lesson' && !lesson_id) return null;
  return { source, round_id: source === 'round' ? round_id : null, lesson_id: source === 'lesson' ? lesson_id : null };
}

export function createPlan(origin, focus) {
  const from = normalizePlanOrigin(origin);
  if (!from || !focus) return null;
  const plans = loadPlans();
  const ts = nowISO();

  const record = {
    plan_id: uuid(),
    source: from.source,
    round_id: from.round_id,
    lesson_id: from.lesson_id,
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
    // Pre-V4.2 backups have no `lessons` key. Same treatment as every
    // collection added before it: absent means empty, not corrupt.
    lessons: Array.isArray(obj.lessons) ? obj.lessons : [],
    swing_videos: Array.isArray(obj.swing_videos) ? obj.swing_videos : [],
    swing_analyses: Array.isArray(obj.swing_analyses) ? obj.swing_analyses : [],
    // Merged (not `obj.settings || defaultIndex().settings`) so an empty or
    // partial settings object — e.g. Settings' "Erase All Data" passing
    // `{}` deliberately — still ends up with every default field rather
    // than one that's merely truthy, which every reader here already
    // assumes exists via its own `||` fallback.
    settings: { ...defaultIndex().settings, ...(obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) },
  };
  // A backup is the one source of records this app did not write itself, so
  // it gets exactly the same repair a stored index gets on load.
  normalizeIndexShape(_index);
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
