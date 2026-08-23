// Deterministic, seeded session/shot generator for testing. Given the same
// seed, always produces the exact same session — so a failing randomized
// test can be reproduced exactly by re-running with its seed.
//
// Produces PLAIN objects shaped exactly like db.js's session/shot records
// (same field names/types) but does NOT touch localStorage/db.js itself —
// callers pass the resulting shots straight into stats.js functions, or use
// persistGenerated() below to actually store them via db.js when a test
// needs real persistence behavior.

// mulberry32 — small, fast, deterministic PRNG. No external dependency.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(rng, mix) {
  const entries = Object.entries(mix).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) throw new Error('weightedPick: mix has no positive weight');
  let r = rng() * total;
  for (const [k, w] of entries) {
    if (r < w) return k;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

// Approximate normal-ish noise via averaged uniforms (Irwin-Hall-ish), so
// distances cluster around baseDistance rather than being flat-uniform.
function noisyInt(rng, base, spread) {
  const n = (rng() + rng() + rng() - 1.5) / 1.5; // roughly in [-1, 1], centrally weighted
  return Math.round(base + n * spread);
}

export const DEFAULT_STRIKE_MIX = { solid: 0.6, thin: 0.1, topped: 0.1, fat: 0.1, shank: 0.05, miss: 0.05 };
export const DEFAULT_DIRECTION_MIX = { left: 0.2, straight: 0.6, right: 0.2 };
export const DEFAULT_HEIGHT_MIX = { low: 0.2, medium: 0.6, high: 0.2 };

function blockPickValue(b) {
  if (b.drill !== undefined) return b.drill;
  if (b.target !== undefined) return b.target;
  return b.trainingAid;
}

function blockValueAt(blocks, index, fallback) {
  if (!blocks || !blocks.length) return fallback;
  let cursor = 0;
  for (const b of blocks) {
    cursor += b.count;
    if (index < cursor) return blockPickValue(b);
  }
  return blockPickValue(blocks[blocks.length - 1]);
}

function isoLocal(date) {
  const pad = (n, len = 2) => String(Math.abs(n)).padStart(len, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  );
}

let sessionCounter = 0;
function fakeUuid(seed, i) {
  sessionCounter++;
  return `gen-${seed}-${i}-${sessionCounter}`;
}

/**
 * generateSession({ seed, shots, club, setup, surface, swing, drill,
 *   drillBlocks, target, targetBlocks, strikeMix, directionMix, heightMix,
 *   baseDistance, distanceNoise, date, startTimestamp, shotIntervalSeconds,
 *   weather, fatigue_rating, hand_discomfort_rating, elbow_discomfort_rating })
 * -> { session, shots } — plain objects, not persisted.
 */
export function generateSession(opts = {}) {
  const {
    seed = 1,
    shots: shotCount = 50,
    club = '7i',
    setup = 'ground',
    surface = 'mat',
    swing = 'full',
    drill = 'Normal Swing',
    drillBlocks = null,
    target = null,
    targetBlocks = null,
    trainingAid = 'none',
    trainingAidBlocks = null,
    strikeMix = DEFAULT_STRIKE_MIX,
    directionMix = DEFAULT_DIRECTION_MIX,
    heightMix = DEFAULT_HEIGHT_MIX,
    baseDistance = 140,
    distanceNoise = 10,
    date = '2026-01-01',
    startTimestamp = new Date('2026-01-01T10:00:00'),
    shotIntervalSeconds = 25,
    weather = null,
    fatigue_rating = null,
    hand_discomfort_rating = null,
    elbow_discomfort_rating = null,
    status = 'finished',
  } = opts;

  const rng = mulberry32(typeof seed === 'number' ? seed : hashStringToInt(String(seed)));
  const session_id = fakeUuid(seed, 'session');

  const session = {
    session_id,
    date,
    start_time: startTimestamp.toTimeString().slice(0, 5),
    end_time: null,
    latitude: weather?.latitude ?? null,
    longitude: weather?.longitude ?? null,
    location_name: weather?.location_name ?? null,
    weather_timestamp: weather ? isoLocal(startTimestamp) : null,
    temperature_f: weather?.temperature_f ?? null,
    feels_like_f: weather?.feels_like_f ?? null,
    humidity_percent: weather?.humidity_percent ?? null,
    weather_condition: weather?.weather_condition ?? null,
    precipitation: weather?.precipitation ?? null,
    cloud_cover_percent: weather?.cloud_cover_percent ?? null,
    wind_speed_mph: weather?.wind_speed_mph ?? null,
    wind_gust_mph: weather?.wind_gust_mph ?? null,
    wind_direction_degrees: weather?.wind_direction_degrees ?? null,
    wind_direction_cardinal: weather?.wind_direction_cardinal ?? null,
    weather_observations: weather ? [{ ...weather, timestamp: isoLocal(startTimestamp) }] : [],
    target_ball_count: shotCount,
    default_club: club,
    default_setup: setup,
    default_surface: surface,
    default_swing: swing,
    current_club: club,
    current_setup: setup,
    current_surface: surface,
    current_swing: swing,
    current_drill: drillBlocks ? drillBlocks[drillBlocks.length - 1].drill : drill,
    current_target_distance: targetBlocks ? targetBlocks[targetBlocks.length - 1].target : target,
    current_training_aid: trainingAidBlocks ? trainingAidBlocks[trainingAidBlocks.length - 1].trainingAid : trainingAid,
    practice_focus: [],
    session_notes: '',
    fatigue_rating,
    hand_discomfort_rating,
    elbow_discomfort_rating,
    status,
    created_at: isoLocal(startTimestamp),
    updated_at: isoLocal(startTimestamp),
  };

  const shots = [];
  let t = new Date(startTimestamp);
  for (let i = 0; i < shotCount; i++) {
    const strike = weightedPick(rng, strikeMix);
    const shotDrill = blockValueAt(drillBlocks, i, drill);
    const shotTarget = blockValueAt(targetBlocks, i, target);
    const shotTrainingAid = blockValueAt(trainingAidBlocks, i, trainingAid);

    let direction = null, height = null, distance_yards = null;
    if (strike !== 'miss') {
      direction = weightedPick(rng, directionMix);
      height = weightedPick(rng, heightMix);
      const strikePenalty = { solid: 0, thin: -15, topped: -70, fat: -60, shank: -40 }[strike] ?? 0;
      distance_yards = Math.max(5, noisyInt(rng, (shotTarget ?? baseDistance) + strikePenalty, distanceNoise));
    }

    t = new Date(t.getTime() + shotIntervalSeconds * 1000);

    shots.push({
      shot_id: fakeUuid(seed, i),
      session_id,
      shot_number: i + 1,
      shot_timestamp: isoLocal(t),
      club, setup, surface, swing_length: swing,
      drill: shotDrill ?? null,
      target_distance_yards: shotTarget ?? null,
      training_aid: shotTrainingAid ?? 'none',
      strike, direction, height, distance_yards,
      shot_note: '',
      created_at: isoLocal(t),
      updated_at: isoLocal(t),
    });
  }

  return { session, shots };
}

function hashStringToInt(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return h >>> 0;
}

// Actually persists a generated {session, shots} through db.js, so
// persistence-layer tests (undo/edit/reload) exercise the real storage code
// path rather than just the pure calculators.
export async function persistGenerated(db, { session, shots }) {
  const created = db.createSession({
    date: session.date,
    start_time: session.start_time,
    target_ball_count: session.target_ball_count,
    default_club: session.default_club,
    default_setup: session.default_setup,
    default_surface: session.default_surface,
    default_swing: session.default_swing,
    practice_focus: session.practice_focus,
    session_notes: session.session_notes,
    // Every session persisted through this generator is simulated fixture
    // data, never a real range session — tag it so it stays cleanly
    // separable from genuine history (see db.js's deleteAllTestSessions()).
    data_source: 'test',
  });
  // db.createSession always starts current_drill/current_target_distance at
  // their hardcoded defaults (matching the real app — there's no starting
  // picker for either); mirror that here by only patching them if the
  // generated session actually diverges, same as the Active screen's
  // Drill/Target chips would after the fact.
  if (session.current_drill && session.current_drill !== created.current_drill) {
    db.updateSession(created.session_id, { current_drill: session.current_drill });
  }
  if (session.current_target_distance != null) {
    db.updateSession(created.session_id, { current_target_distance: session.current_target_distance });
  }
  if (session.current_training_aid && session.current_training_aid !== created.current_training_aid) {
    db.updateSession(created.session_id, { current_training_aid: session.current_training_aid });
  }
  for (const sh of shots) {
    db.addShot(created.session_id, {
      club: sh.club, setup: sh.setup, surface: sh.surface, swing_length: sh.swing_length,
      drill: sh.drill, target_distance_yards: sh.target_distance_yards, training_aid: sh.training_aid,
      strike: sh.strike, direction: sh.direction, height: sh.height, distance_yards: sh.distance_yards,
    });
  }
  if (session.status === 'finished') db.finishSession(created.session_id);
  if (session.fatigue_rating != null || session.hand_discomfort_rating != null || session.elbow_discomfort_rating != null) {
    db.setSessionCheckIn(created.session_id, {
      fatigue_rating: session.fatigue_rating,
      hand_discomfort_rating: session.hand_discomfort_rating,
      elbow_discomfort_rating: session.elbow_discomfort_rating,
    });
  }
  return created.session_id;
}
