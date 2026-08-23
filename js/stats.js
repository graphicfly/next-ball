// Pure calculation helpers shared by the summary, history, and trends screens.
// No raw "score" is ever produced here — only the underlying measurements.

import { STRIKE, DIRECTION, HEIGHT, shotTrainingAid } from './db.js';

export function pct(count, total) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

// A session's default_club is only ever a starting point — the club can
// change mid-session (see db.js's current_club), so any UI showing "the
// club" for a whole session must look at what was actually logged, not
// just the session-level default. Two distinct clubs get an explicit
// "A + B" (first-appearance order, so it reads as the practice progression);
// three or more collapse to "Mixed Clubs" rather than an unreadable list.
// Never silently picks a "majority" club and hides that others were used.
export function clubSummaryLabel(shots, fallbackClub) {
  if (!shots || !shots.length) return fallbackClub || '';
  const seen = [];
  for (const s of [...shots].sort((a, b) => a.shot_number - b.shot_number)) {
    if (s.club && !seen.includes(s.club)) seen.push(s.club);
  }
  if (!seen.length) return fallbackClub || '';
  if (seen.length === 1) return seen[0];
  if (seen.length === 2) return `${seen[0]} + ${seen[1]}`;
  return 'Mixed Clubs';
}

export function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function mean(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

// Population standard deviation — we have the complete set of shots in the
// window/session being described, not a sample being used to infer a wider
// population, so dividing by n (not n-1) is the correct choice here.
export function stddev(numbers) {
  if (numbers.length < 2) return null;
  const m = mean(numbers);
  const variance = numbers.reduce((sum, x) => sum + (x - m) ** 2, 0) / numbers.length;
  return Math.sqrt(variance);
}

// Below this sample size, standard deviation / CV are more misleading than
// informative — callers should show "Not enough data" instead of a number.
const MIN_FOR_VARIABILITY = 3;

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

// Stricter than `v !== null && v !== undefined`: a malformed value (e.g. a
// stray string from a hand-edited/corrupted JSON import) must never reach
// Math.min/Math.max/median/mean — those coerce non-numeric input and would
// silently poison the entire session's distance stats into NaN rather than
// just excluding the one bad shot, exactly like a genuinely missing value should.
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function breakdown(shots, field, keys) {
  const total = shots.length;
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const s of shots) if (counts[s[field]] !== undefined) counts[s[field]]++;
  const result = {};
  for (const k of keys) result[k] = { count: counts[k], pct: pct(counts[k], total) };
  return result;
}

export function strikeBreakdown(shots) {
  return breakdown(shots, 'strike', STRIKE);
}

export function directionBreakdown(shots) {
  return breakdown(shots, 'direction', DIRECTION);
}

export function heightBreakdown(shots) {
  return breakdown(shots, 'height', HEIGHT);
}

export function distanceStats(shots) {
  const known = shots.map((s) => s.distance_yards).filter(isFiniteNumber);
  const solidKnown = shots
    .filter((s) => s.strike === 'solid')
    .map((s) => s.distance_yards)
    .filter(isFiniteNumber);
  return { medianAll: median(known), medianSolid: median(solidKnown) };
}

// Richer distance breakdown for the Consistency section — min/max/range for
// every shot with a valid numeric distance, plus mean/stddev/CV for Solid
// strikes specifically (only once there's enough data to be meaningful).
export function distanceConsistency(shots) {
  const known = shots.map((s) => s.distance_yards).filter(isFiniteNumber);
  const solidKnown = shots
    .filter((s) => s.strike === 'solid')
    .map((s) => s.distance_yards)
    .filter(isFiniteNumber);

  const all = known.length
    ? { median: median(known), min: Math.min(...known), max: Math.max(...known), range: Math.max(...known) - Math.min(...known), count: known.length }
    : { median: null, min: null, max: null, range: null, count: 0 };

  const enoughForVariability = solidKnown.length >= MIN_FOR_VARIABILITY;
  let solid;
  if (solidKnown.length) {
    const m = enoughForVariability ? mean(solidKnown) : null;
    const sd = enoughForVariability ? stddev(solidKnown) : null;
    solid = {
      median: median(solidKnown),
      min: Math.min(...solidKnown),
      max: Math.max(...solidKnown),
      range: Math.max(...solidKnown) - Math.min(...solidKnown),
      count: solidKnown.length,
      mean: round1(m),
      stddev: round1(sd),
      cv: m && sd !== null && m > 0 ? round1((sd / m) * 100) : null,
      enoughData: enoughForVariability,
    };
  } else {
    solid = { median: null, min: null, max: null, range: null, count: 0, mean: null, stddev: null, cv: null, enoughData: false };
  }

  return { all, solid };
}

export function consistencyMetrics(shots) {
  const strike = strikeBreakdown(shots);
  const dir = directionBreakdown(shots);
  return {
    contact: {
      solidPct: strike.solid.pct,
      toppedPct: strike.topped.pct,
      fatPct: strike.fat.pct,
      thinPct: strike.thin.pct,
      shankPct: strike.shank.pct,
      missPct: strike.miss.pct,
      shankMissPct: pct(strike.shank.count + strike.miss.count, shots.length),
    },
    direction: {
      straightPct: dir.straight.pct,
      leftPct: dir.left.pct,
      rightPct: dir.right.pct,
    },
    distance: distanceConsistency(shots),
  };
}

// Longest run of shots (in shot_number order) matching `predicate`.
function longestStreak(sortedShots, predicate) {
  let best = { length: 0, startBall: null, endBall: null };
  let curStart = null;
  let curLen = 0;
  for (const s of sortedShots) {
    if (predicate(s)) {
      if (curLen === 0) curStart = s.shot_number;
      curLen++;
      if (curLen > best.length) best = { length: curLen, startBall: curStart, endBall: s.shot_number };
    } else {
      curLen = 0;
    }
  }
  return best;
}

// Purely derived from current shot order every time it's called — never
// stored, so an edit/undo/restore anywhere in the session is automatically
// reflected the next time this runs.
export function streaksSummary(shots) {
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  return {
    solid: longestStreak(sorted, (s) => s.strike === 'solid'),
    straight: longestStreak(sorted, (s) => s.direction === 'straight'),
    noTop: longestStreak(sorted, (s) => s.strike !== 'topped'),
    noFat: longestStreak(sorted, (s) => s.strike !== 'fat'),
    cleanContact: longestStreak(sorted, (s) => s.strike !== 'topped' && s.strike !== 'fat'),
  };
}

// null if the window's shots don't all share one identical, non-null target.
function uniformTarget(windowShots) {
  const targets = new Set(windowShots.map((s) => s.target_distance_yards ?? null));
  if (targets.size === 1) {
    const [t] = targets;
    return t;
  }
  return null;
}

function windowMetrics(windowShots) {
  const strike = strikeBreakdown(windowShots);
  const dir = directionBreakdown(windowShots);
  const dist = distanceStats(windowShots);
  const solidKnown = windowShots.filter((s) => s.strike === 'solid').map((s) => s.distance_yards).filter(isFiniteNumber);
  let solidDistanceCV = null;
  if (solidKnown.length >= MIN_FOR_VARIABILITY) {
    const m = mean(solidKnown);
    const sd = stddev(solidKnown);
    solidDistanceCV = m > 0 ? round1((sd / m) * 100) : null;
  }
  const target = uniformTarget(windowShots);
  let medianAbsoluteError = null;
  if (target !== null) {
    const errors = windowShots.map((s) => (isFiniteNumber(s.distance_yards) ? Math.abs(s.distance_yards - target) : null)).filter((v) => v !== null);
    medianAbsoluteError = median(errors);
  }
  return {
    startBall: windowShots[0].shot_number,
    endBall: windowShots[windowShots.length - 1].shot_number,
    count: windowShots.length,
    solidPct: strike.solid.pct,
    toppedPct: strike.topped.pct,
    fatPct: strike.fat.pct,
    thinPct: strike.thin.pct,
    shankMissPct: pct(strike.shank.count + strike.miss.count, windowShots.length),
    toppedFatPct: round1(strike.topped.pct + strike.fat.pct),
    straightPct: dir.straight.pct,
    medianDistance: dist.medianAll,
    medianSolidDistance: dist.medianSolid,
    solidDistanceCV,
    target,
    medianAbsoluteError,
  };
}

// Evaluates EVERY consecutive 10-shot window (a 50-ball session yields 41 of
// them: 1-10, 2-11, ... 41-50) — never just the fixed 1-10/11-20/... blocks.
export function rollingTenShotWindows(shots) {
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  const windows = [];
  for (let i = 0; i + 10 <= sorted.length; i++) {
    windows.push(windowMetrics(sorted.slice(i, i + 10)));
  }
  return windows;
}

function compareForBest(a, b, rankKeys) {
  for (const k of rankKeys) {
    const av = a[k.field];
    const bv = b[k.field];
    const aNull = av === null || av === undefined;
    const bNull = bv === null || bv === undefined;
    if (aNull && bNull) continue;
    if (aNull) return 1; // nulls (not enough data) never win a ranking
    if (bNull) return -1;
    if (av === bv) continue;
    return k.dir === 'desc' ? bv - av : av - bv;
  }
  return 0;
}

// Contact quality first, raw distance never decides the winner.
const NORMAL_WINDOW_RANK = [
  { field: 'solidPct', dir: 'desc' },
  { field: 'toppedFatPct', dir: 'asc' },
  { field: 'straightPct', dir: 'desc' },
  { field: 'solidDistanceCV', dir: 'asc' },
];

// Same idea, but target accuracy outranks straightness/variability for
// windows that were consistently hit at one target distance.
const TARGETED_WINDOW_RANK = [
  { field: 'solidPct', dir: 'desc' },
  { field: 'toppedFatPct', dir: 'asc' },
  { field: 'medianAbsoluteError', dir: 'asc' },
  { field: 'straightPct', dir: 'desc' },
  { field: 'solidDistanceCV', dir: 'asc' },
];

export function bestWindow(shots) {
  const windows = rollingTenShotWindows(shots);
  if (!windows.length) return null;
  return [...windows].sort((a, b) => compareForBest(a, b, NORMAL_WINDOW_RANK))[0];
}

// Only considers windows where all 10 shots share one target distance.
export function bestTargetedWindow(shots) {
  const windows = rollingTenShotWindows(shots).filter((w) => w.target !== null);
  if (!windows.length) return null;
  return [...windows].sort((a, b) => compareForBest(a, b, TARGETED_WINDOW_RANK))[0];
}

// Groups shots by their (non-null) target_distance_yards and reports how
// accurately actual distance matched that target. A target that was set but
// only ever produced Miss shots (target stamped, but no distance to
// measure) yields no group at all — a "0 shots, all dashes" card would be
// noise, not data.
export function targetAccuracyGroups(shots) {
  const measurable = shots.filter((s) => isFiniteNumber(s.target_distance_yards) && isFiniteNumber(s.distance_yards));
  const targets = [...new Set(measurable.map((s) => s.target_distance_yards))].sort((a, b) => a - b);
  return targets.map((target) => {
    const group = measurable.filter((s) => s.target_distance_yards === target);
    const actuals = group.map((s) => s.distance_yards);
    const signedErrors = group.map((s) => s.distance_yards - target);
    const absErrors = signedErrors.map((e) => Math.abs(e));
    return {
      target,
      count: group.length,
      medianActual: median(actuals),
      medianSignedError: median(signedErrors),
      medianAbsoluteError: median(absErrors),
      within5Pct: absErrors.length ? pct(absErrors.filter((e) => e <= 5).length, absErrors.length) : null,
      within10Pct: absErrors.length ? pct(absErrors.filter((e) => e <= 10).length, absErrors.length) : null,
    };
  });
}

function primaryTargetForShots(shots) {
  const targets = shots.map((s) => s.target_distance_yards).filter(isFiniteNumber);
  return targets.length ? median(targets) : null;
}

// Picks the most recent prior FINISHED session that best matches the current
// one, weighting match criteria by priority (club > swing > setup > drill >
// target distance > surface) so a higher-priority match always outranks any
// number of lower-priority ones. A score of 0 means nothing matched at all.
export function findComparableSession(currentSession, currentShots, priorSessions, shotsBySessionId) {
  if (!priorSessions.length) return null;
  const currentTarget = primaryTargetForShots(currentShots);
  let bestScore = -1;
  let bestSession = null;
  for (const s of priorSessions) {
    let score = 0;
    if (currentSession.default_club && s.default_club === currentSession.default_club) score += 32;
    if (currentSession.default_swing && s.default_swing === currentSession.default_swing) score += 16;
    if (currentSession.default_setup && s.default_setup === currentSession.default_setup) score += 8;
    if (currentSession.current_drill && s.current_drill === currentSession.current_drill) score += 4;
    if (currentTarget !== null) {
      const priorTarget = primaryTargetForShots(shotsBySessionId.get(s.session_id) || []);
      if (priorTarget !== null && Math.abs(priorTarget - currentTarget) <= 10) score += 2;
    }
    if (currentSession.default_surface && s.default_surface === currentSession.default_surface) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestSession = s;
    }
  }
  return { session: bestSession, score: bestScore, comparable: bestScore > 0 };
}

function diff1(curVal, cmpVal) {
  if (curVal === null || curVal === undefined || cmpVal === null || cmpVal === undefined) return null;
  return round1(curVal - cmpVal);
}

// Percentage-point (not relative-%) diffs, with an explicit "which direction
// is improvement" tag per metric so the UI never has to guess. Distance is
// always neutral — more yards is not automatically "better."
export function compareMetrics(currentShots, comparisonShots) {
  const curStrike = strikeBreakdown(currentShots);
  const cmpStrike = strikeBreakdown(comparisonShots);
  const curDir = directionBreakdown(currentShots);
  const cmpDir = directionBreakdown(comparisonShots);
  const curDist = distanceConsistency(currentShots);
  const cmpDist = distanceConsistency(comparisonShots);

  const metric = (curVal, cmpVal, betterWhen) => ({ current: curVal, previous: cmpVal, diff: diff1(curVal, cmpVal), betterWhen });

  return {
    solid: metric(curStrike.solid.pct, cmpStrike.solid.pct, 'higher'),
    topped: metric(curStrike.topped.pct, cmpStrike.topped.pct, 'lower'),
    fat: metric(curStrike.fat.pct, cmpStrike.fat.pct, 'lower'),
    thin: metric(curStrike.thin.pct, cmpStrike.thin.pct, 'lower'),
    straight: metric(curDir.straight.pct, cmpDir.straight.pct, 'higher'),
    medianSolidDistance: metric(curDist.solid.median, cmpDist.solid.median, 'neutral'),
    solidDistanceCV: metric(curDist.solid.cv, cmpDist.solid.cv, 'lower'),
  };
}

export function compareBestWindows(curWindow, cmpWindow) {
  if (!curWindow || !cmpWindow) return null;
  const metric = (curVal, cmpVal, betterWhen) => ({ current: curVal, previous: cmpVal, diff: diff1(curVal, cmpVal), betterWhen });
  return {
    solid: metric(curWindow.solidPct, cmpWindow.solidPct, 'higher'),
    toppedFat: metric(curWindow.toppedFatPct, cmpWindow.toppedFatPct, 'lower'),
    straight: metric(curWindow.straightPct, cmpWindow.straightPct, 'higher'),
    medianSolidDistance: metric(curWindow.medianSolidDistance, cmpWindow.medianSolidDistance, 'neutral'),
  };
}

// Matches target groups between sessions by nearest target value (within 5
// yd) and reports whether median absolute error improved (decreased).
export function compareTargetAccuracy(currentGroups, comparisonGroups) {
  return currentGroups.map((cur) => {
    const match = comparisonGroups.find((p) => Math.abs(p.target - cur.target) <= 5) || null;
    const improvementYards = match && match.medianAbsoluteError !== null && cur.medianAbsoluteError !== null
      ? round1(match.medianAbsoluteError - cur.medianAbsoluteError)
      : null;
    return { ...cur, previous: match, improvementYards };
  });
}

export function tenBallBlocks(shots) {
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  const blocks = [];
  for (let i = 0; i < sorted.length; i += 10) {
    const blockShots = sorted.slice(i, i + 10);
    const start = i + 1;
    const end = Math.min(i + 10, sorted.length);
    blocks.push({
      label: `Balls ${start}-${end}`,
      count: blockShots.length,
      strike: strikeBreakdown(blockShots),
      straightPct: pct(blockShots.filter((s) => s.direction === 'straight').length, blockShots.length),
    });
  }
  return blocks;
}

export function firstLastCompare(shots) {
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  const first10 = sorted.slice(0, 10);
  const last10 = sorted.length > 10 ? sorted.slice(-10) : sorted.slice(0, Math.min(10, sorted.length));
  return { first10, last10, overlapping: sorted.length < 20 };
}

// Aggregates every shot by its recorded drill (shots with no drill are
// skipped), in the order each drill was first practiced during the session.
export function drillBreakdown(shots) {
  const order = [];
  for (const s of [...shots].sort((a, b) => a.shot_number - b.shot_number)) {
    if (s.drill && !order.includes(s.drill)) order.push(s.drill);
  }
  return order.map((name) => {
    const drillShots = shots.filter((s) => s.drill === name);
    const strike = strikeBreakdown(drillShots);
    const dir = directionBreakdown(drillShots);
    const dist = distanceStats(drillShots);
    return {
      drill: name,
      count: drillShots.length,
      solidPct: strike.solid.pct,
      toppedPct: strike.topped.pct,
      fatPct: strike.fat.pct,
      thinPct: strike.thin.pct,
      straightPct: dir.straight.pct,
      medianDistance: dist.medianAll,
      medianSolidDistance: dist.medianSolid,
    };
  });
}

// Aggregates every shot by which training aid was active when it was
// logged (see db.js's shotTrainingAid — missing/legacy shots normalize to
// 'none'), in first-appearance order. Independent of drillBreakdown above —
// a shot's drill and training aid are unrelated groupings of the same data.
export function trainingAidBreakdown(shots) {
  const order = [];
  for (const s of [...shots].sort((a, b) => a.shot_number - b.shot_number)) {
    const aid = shotTrainingAid(s);
    if (!order.includes(aid)) order.push(aid);
  }
  return order.map((aid) => {
    const aidShots = shots.filter((s) => shotTrainingAid(s) === aid);
    const strike = strikeBreakdown(aidShots);
    const dir = directionBreakdown(aidShots);
    const dist = distanceStats(aidShots);
    return {
      training_aid: aid,
      count: aidShots.length,
      solidPct: strike.solid.pct,
      toppedPct: strike.topped.pct,
      fatPct: strike.fat.pct,
      toppedFatPct: round1(strike.topped.pct + strike.fat.pct),
      straightPct: dir.straight.pct,
      medianSolidDistance: dist.medianSolid,
    };
  });
}

// Derived purely from shot_timestamp — for later analysis, not for display
// on the active logging screen. Shots missing a timestamp (older data) are
// simply excluded rather than causing an error.
export function shotTimingStats(shots) {
  const timed = [...shots]
    .filter((s) => s.shot_timestamp)
    .sort((a, b) => a.shot_number - b.shot_number)
    .map((s) => ({ shot_number: s.shot_number, t: new Date(s.shot_timestamp).getTime() }))
    .filter((s) => Number.isFinite(s.t));

  if (timed.length < 2) {
    return { gaps: [], avgGapSeconds: null, totalDurationSeconds: null, longBreaks: [] };
  }

  const gaps = [];
  for (let i = 1; i < timed.length; i++) {
    const seconds = (timed[i].t - timed[i - 1].t) / 1000;
    gaps.push({ fromShot: timed[i - 1].shot_number, toShot: timed[i].shot_number, seconds });
  }

  const avgGapSeconds = gaps.reduce((sum, g) => sum + g.seconds, 0) / gaps.length;
  const totalDurationSeconds = (timed[timed.length - 1].t - timed[0].t) / 1000;

  // "Unusually long" = well past the pace of this session (3x average) and
  // at least 2 minutes, so normal per-shot variance isn't flagged as a break.
  const threshold = Math.max(avgGapSeconds * 3, 120);
  const longBreaks = gaps.filter((g) => g.seconds > threshold);

  return { gaps, avgGapSeconds, totalDurationSeconds, longBreaks };
}

export function sessionSummary(shots) {
  return {
    total: shots.length,
    strike: strikeBreakdown(shots),
    direction: directionBreakdown(shots),
    height: heightBreakdown(shots),
    distance: distanceStats(shots),
    blocks: tenBallBlocks(shots),
    firstLast: firstLastCompare(shots),
    drills: drillBreakdown(shots),
    trainingAids: trainingAidBreakdown(shots),
    timing: shotTimingStats(shots),
    consistency: consistencyMetrics(shots),
    streaks: streaksSummary(shots),
    bestWindow: bestWindow(shots),
    bestTargetedWindow: bestTargetedWindow(shots),
    targetAccuracy: targetAccuracyGroups(shots),
  };
}

export function sessionTrendPoint(session, allShotsForSession, filter) {
  let filtered = allShotsForSession;
  if (filter.club) filtered = filtered.filter((s) => s.club === filter.club);
  if (filter.setup) filtered = filtered.filter((s) => s.setup === filter.setup);
  if (filter.surface) filtered = filtered.filter((s) => s.surface === filter.surface);
  if (filter.swing) filtered = filtered.filter((s) => s.swing_length === filter.swing);
  if (filtered.length === 0) return null;
  const strike = strikeBreakdown(filtered);
  const straightPct = pct(filtered.filter((s) => s.direction === 'straight').length, filtered.length);
  const dist = distanceStats(filtered);
  return {
    session_id: session.session_id,
    date: session.date,
    solidPct: strike.solid.pct,
    thinPct: strike.thin.pct,
    toppedPct: strike.topped.pct,
    fatPct: strike.fat.pct,
    straightPct,
    medianSolidDistance: dist.medianSolid,
    shotCount: filtered.length,
  };
}
