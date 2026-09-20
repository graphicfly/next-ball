// Practice — the vocabulary shared by Range, Chipping and Putting.
//
// Owns the enums, the bucket predicates, the drill templates and the
// sample-size rules from docs/practice-spec.md. Deliberately has NO storage
// and NO DOM: db.js writes the records, the screens draw them, and both read
// their meaning from here so a new drill or a changed threshold is one edit
// rather than a search.
//
// Nothing in this file touches Swing Lab.

// ---------- Mode and skill area (§2) ----------

export const MODES = { RANGE: 'range', CHIPPING: 'chipping', PUTTING: 'putting' };

export const SKILL_AREAS = { FULL_SWING: 'full_swing', SHORT_GAME: 'short_game', PUTTING: 'putting' };

// Skill area is DERIVED from mode through this one map and is never stored
// twice. A future short-game mode — bunker, pitching — is one line here and
// no migration: nothing historical needs backfilling because nothing
// historical stored it.
const SKILL_AREA_BY_MODE = {
  [MODES.RANGE]: SKILL_AREAS.FULL_SWING,
  [MODES.CHIPPING]: SKILL_AREAS.SHORT_GAME,
  [MODES.PUTTING]: SKILL_AREAS.PUTTING,
};

export function skillAreaFor(mode) { return SKILL_AREA_BY_MODE[mode] || null; }

// ---------- Chipping enums (§4, §5) ----------

export const LIES = ['fairway', 'rough', 'fringe', 'tight'];
export const LIE_LABELS = { fairway: 'Fairway', rough: 'Rough', fringe: 'Fringe', tight: 'Tight lie' };

export const SURFACES = ['grass', 'mat'];
export const SURFACE_LABELS = { grass: 'Grass', mat: 'Mat' };

export const CHIP_CLUBS = ['PW', 'GW', 'SW', 'LW', '9i', '8i'];
export const CHIP_DISTANCES = [5, 10, 15, 20, 30];

export const CONTACTS = ['solid', 'thin', 'fat'];
export const CONTACT_LABELS = { solid: 'Solid', thin: 'Thin', fat: 'Fat' };

// §6. Categorical outcomes, presented as categories. Order is the order the
// UI shows them in, best first.
export const PROX_BUCKETS = ['holed', 'in_3', '3_6', '6_10', '10_20', '20_plus'];
export const PROX_LABELS = {
  holed: 'Holed', in_3: 'Inside 3 ft', '3_6': '3–6 ft',
  '6_10': '6–10 ft', '10_20': '10–20 ft', '20_plus': '20 ft +',
};

// §7. Every derived figure is a BUCKET PREDICATE. There is no proximity_ft,
// no midpoint, and no average computed from categorical taps — "average
// proximity 7.3 ft" is a number the app never collected.
export const INSIDE_3 = ['holed', 'in_3'];
export const INSIDE_6 = ['holed', 'in_3', '3_6'];

export const isInside3 = (b) => INSIDE_3.includes(b);
export const isInside6 = (b) => INSIDE_6.includes(b);
export const isHoled = (b) => b === 'holed';

// §9. Two INDEPENDENT axes, never one four-value enum. A golfer commonly
// notices depth and not direction; collapsing them would force a false
// choice and make "8 of 11 finished short" uncomputable the moment somebody
// logged "right".
export const MISS_DEPTH = ['short', 'long'];
export const MISS_LATERAL = ['left', 'right'];
export const MISS_LABELS = { short: 'Short', long: 'Long', left: 'Left', right: 'Right' };

// ---------- Putting enums (§14–§17) ----------

export const PUTTING_KINDS = ['short', 'distance', 'mixed'];
export const PUTT_SURFACES = ['green', 'mat'];
export const PUTT_SURFACE_LABELS = { green: 'Green', mat: 'Mat' };
export const SHORT_PUTT_DISTANCES = [3, 5, 6, 8, 10];
export const LAG_DISTANCES = [15, 20, 30, 40];

// §14.1. One threshold, two result models, and deliberately no third.
export const SHORT_PUTT_MAX_FT = 10;
export function puttModelFor(distanceFt) {
  return (distanceFt != null && distanceFt <= SHORT_PUTT_MAX_FT) ? 'short' : 'distance';
}

// §16. Lag leaves are a coarser scale than chip proximity: from 30 ft, 6–10
// and 10–20 are not a distinction worth a tap.
export const LEAVE_BUCKETS = ['in_3', '3_6', '6_plus'];
export const LEAVE_LABELS = { in_3: 'Inside 3 ft', '3_6': '3–6 ft', '6_plus': '6 ft +' };
export const PACE = ['short', 'past'];
export const PACE_LABELS = { short: 'Short', past: 'Past' };

// ---------- Drills (§18) ----------
//
// Session TEMPLATES, not a data model. A drill sets the setup and the result
// model; the per-rep logging underneath is otherwise identical, and drill
// progress is derived rather than stored. A new drill is one object here.

export const RESULT_MODELS = { STANDARD: 'standard', ZONE: 'zone', UP_AND_DOWN: 'up_and_down', STREAK: 'streak' };

export const CHIPPING_PRACTICE_TYPES = ['standard', 'landing_zone', 'around_green', 'up_and_down'];

export const CHIPPING_DRILLS = [
  {
    id: 'standard', name: 'Standard', mode: MODES.CHIPPING,
    blurb: 'Contact and proximity, ball after ball.',
    result_model: RESULT_MODELS.STANDARD, variable: false,
  },
  {
    id: 'landing_zone', name: 'Landing Zone', mode: MODES.CHIPPING,
    blurb: 'Pick a spot. Did you land it there?',
    result_model: RESULT_MODELS.ZONE, variable: false,
  },
  {
    id: 'around_green', name: 'Around the Green', mode: MODES.CHIPPING,
    blurb: 'One ball, a new spot every time.',
    result_model: RESULT_MODELS.STANDARD, variable: true,
  },
  {
    id: 'up_and_down', name: 'Up & Down', mode: MODES.CHIPPING,
    blurb: 'Chip it, then putt it out.',
    result_model: RESULT_MODELS.UP_AND_DOWN, variable: false,
  },
];

export const PUTTING_DRILLS = [
  { id: 'short', name: 'Short Putts', mode: MODES.PUTTING, kind: 'short', blurb: 'Make rate from one distance.', result_model: RESULT_MODELS.STANDARD },
  { id: 'distance', name: 'Distance Control', mode: MODES.PUTTING, kind: 'distance', blurb: 'Finish it close from long range.', result_model: RESULT_MODELS.STANDARD },
  { id: 'mixed', name: 'Mixed Practice', mode: MODES.PUTTING, kind: 'mixed', blurb: 'One ball, a new distance each time.', result_model: RESULT_MODELS.STANDARD },
  { id: 'pressure_finish', name: 'Pressure Finish', mode: MODES.PUTTING, kind: 'short', blurb: 'Three in a row, or start again.', result_model: RESULT_MODELS.STREAK, streak_target: 3, default_distance_ft: 6 },
];

export function chippingDrill(id) { return CHIPPING_DRILLS.find((d) => d.id === id) || CHIPPING_DRILLS[0]; }
export function puttingDrill(id) { return PUTTING_DRILLS.find((d) => d.id === id) || PUTTING_DRILLS[0]; }

// §13. Around the Green deliberately does not collect the situation, so the
// records it produces must never reach a by-lie or by-distance comparison.
export function isVariablePractice(session) {
  return !!(session && session.mode === MODES.CHIPPING && chippingDrill(session.practice_type).variable);
}

// ---------- Up & Down (§12) ----------
//
// DERIVED, never stored. Storing it would let the chip and the putt count
// contradict each other, and the golfer is never asked to confirm it.
export function isUpAndDown(chip) {
  if (!chip) return false;
  if (isHoled(chip.prox_bucket)) return true;
  return chip.putts != null && chip.putts <= 1;
}

// ---------- Sample-size rules (§21) ----------
//
// Two thresholds, because DESCRIBING and CLAIMING are different acts. Held
// here rather than checked ad hoc on each screen, so "enough data" means one
// thing across the whole app.
export const THRESHOLDS = {
  descriptive: { sessions: 2, shots: 20 },
  trend: { sessions: 3, shots: 30 },
};

export function meetsDescriptive({ sessions, shots }) {
  return sessions >= THRESHOLDS.descriptive.sessions && shots >= THRESHOLDS.descriptive.shots;
}

export function meetsTrend({ sessions, shots }) {
  return sessions >= THRESHOLDS.trend.sessions && shots >= THRESHOLDS.trend.shots;
}

// §10. An insight may only be shown when the data behind it was actually
// collected, and it prints its own coverage. Returns null — not an empty
// pattern, not a caveated one — when nothing was logged.
// The floor is 2, not 3, because the spec's own worked example shows a
// pattern drawn from two missed putts (§N: "8 / 10 made · Misses tended
// right"). What makes that honest is not the count but the disclosure: every
// pattern prints the coverage that produced it (§10), so a reader sees "2 of
// the 2 missed putts had a direction logged" and weighs it themselves.
//
// The RATIO guard is what actually does the work. Eighteen chips with one
// direction logged is 5% coverage and yields nothing, however lopsided that
// single tap was.
const MIN_LOGGED = 2;
const MIN_COVERAGE = 0.3;

export function coverage(records, field) {
  const total = records.length;
  const logged = records.filter((r) => r[field] != null).length;
  return { total, logged, enough: logged >= MIN_LOGGED && logged / Math.max(1, total) >= MIN_COVERAGE };
}

// The dominant value of an optional field, with the coverage that produced
// it. Null when the field was too rarely logged to say anything.
export function tendency(records, field) {
  const cov = coverage(records, field);
  if (!cov.enough) return null;
  const counts = {};
  for (const r of records) if (r[field] != null) counts[r[field]] = (counts[r[field]] || 0) + 1;
  const [value, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  if (!value) return null;
  // A tendency that is barely a majority is not a tendency.
  if (count / cov.logged < 0.5) return null;
  return { value, count, logged: cov.logged, total: cov.total };
}

export function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }
