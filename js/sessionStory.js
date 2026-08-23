// Deterministic, rules-based "story" for a finished session — no AI, no
// randomness. Pure functions only: everything here takes already-computed
// data (from stats.js / sessionAnalysis.js) and picks/phrases ONE thing
// worth saying. Never manufactures praise the data doesn't support — every
// function here can return null, and callers must treat that as "say
// nothing" rather than falling back to generic text.

import { STRIKE, TRAINING_AID_LABELS } from './db.js';
import { cap } from './ui.js';
import { strikeBreakdown } from './stats.js';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function pts(n) {
  return `${n > 0 ? '+' : ''}${n} pt${Math.abs(n) === 1 ? '' : 's'}`;
}

// ---------- Session Recap insight card ----------
// Priority per product spec: personal best > meaningful Solid Contact
// improvement > meaningful reduction in Top/Fat > strong finish > improved
// distance consistency > improved target accuracy > meaningful streak >
// meaningful drill/training-aid contrast > short-session factual
// composition > nothing. Returns { headline, sub } for the first tier with
// real, meaningful data, or null if nothing clears the bar — the card is
// simply omitted rather than showing an invented or generic line.
//
// Deliberately excluded: a "Best Stretch" tier keyed off s.bestWindow.
// recapBestStretchHtml() already renders that exact window, unconditionally,
// directly below the shot map whenever it exists — an insight-card version
// would always be retelling the same fact a second time, never new
// information. If that dedicated section is ever made conditional, this
// tier could be reconsidered, but not before.

// Percentage-point comparisons get noisy fast on small samples (one shot
// swings a 3-shot session by ~33 points) — the same 10-shot floor the app
// already treats as "enough to mean something" elsewhere (it's the Best 10
// window size) gates every comparison-based tier below.
const MIN_SHOTS_FOR_COMPARISON = 10;

// Drill/training-aid contrasts are a within-session subgroup comparison,
// noisier than a whole-session one — both sides need their own reasonable
// sample, and the gap has to be larger to be worth reporting at that scale.
const MIN_GROUP_SAMPLE = 5;
const MIN_GROUP_SOLID_DIFF = 15;

// Short-session fallback: past this shot count there's enough session for
// one of the tiers above to have found something, or there genuinely isn't
// a story here — forcing a factual restatement on a 50-shot session with
// nothing notable is exactly the "SOLID SESSION" problem this replaced.
const MAX_SHOTS_FOR_FACTUAL_FALLBACK = 9;

const PERSONAL_BEST_SUB = {
  solidPct: (session) => `Highest Solid Contact for your ${session.default_club}`,
  bestWindowSolidPct: () => 'Highest Solid Contact in a 10-shot stretch',
  cleanContactStreak: () => 'Longest clean-contact streak yet',
  solidDistanceCV: () => 'Your most consistent solid-shot distance yet',
};

// Contrasts the strongest training aid group against 'none', and the
// strongest single drill against the rest of the session — same shape,
// different grouping, so one helper covers both. Returns null unless both
// sides clear MIN_GROUP_SAMPLE and the solid% gap clears MIN_GROUP_SOLID_DIFF.
function bestGroupContrast(groups, restSolidPctFor) {
  let best = null;
  for (const g of groups) {
    if (g.count < MIN_GROUP_SAMPLE) continue;
    const restSolidPct = restSolidPctFor(g);
    if (restSolidPct === null) continue;
    const diff = round1Diff(g.solidPct - restSolidPct);
    if (Math.abs(diff) >= MIN_GROUP_SOLID_DIFF && (!best || Math.abs(diff) > Math.abs(best.diff))) {
      best = { group: g, restSolidPct, diff };
    }
  }
  return best;
}

function round1Diff(n) {
  return Math.round(n * 10) / 10;
}

function trainingAidInsight(shots, trainingAids) {
  const none = trainingAids.find((a) => a.training_aid === 'none');
  const candidates = trainingAids.filter((a) => a.training_aid !== 'none');
  if (!none || !candidates.length) return null;
  const best = bestGroupContrast(candidates, () => (none.count >= MIN_GROUP_SAMPLE ? none.solidPct : null));
  if (!best) return null;
  const label = TRAINING_AID_LABELS[best.group.training_aid] || cap(best.group.training_aid);
  // Factual wording only — never implies the aid caused the difference.
  return {
    headline: label,
    sub: `Solid contact was ${best.group.solidPct}% with the ${label} vs ${none.solidPct}% without it.`,
  };
}

function drillInsight(shots, drills) {
  if (drills.length < 2) return null; // nothing to contrast against
  const best = bestGroupContrast(drills, (d) => {
    const rest = shots.filter((sh) => sh.drill !== d.drill);
    return rest.length >= MIN_GROUP_SAMPLE ? strikeBreakdown(rest).solid.pct : null;
  });
  if (!best) return null;
  return {
    headline: best.group.drill,
    sub: `Solid contact was ${best.group.solidPct}% during ${best.group.drill} vs ${best.restSolidPct}% otherwise.`,
  };
}

export function buildRecapInsight(s, comparison, personalBests, session, shots) {
  if (personalBests && personalBests.length) {
    const best = personalBests[0];
    const subFn = PERSONAL_BEST_SUB[best.type];
    return { headline: 'Personal Best', sub: subFn ? subFn(session) : 'A new personal best this session.' };
  }

  const longEnoughForComparison = s.total >= MIN_SHOTS_FOR_COMPARISON;

  if (comparison && longEnoughForComparison) {
    const m = comparison.metricsCompare;
    const clubLabel = comparison.match.session.default_club;
    if (m.solid.diff !== null && m.solid.diff >= 8) {
      return { headline: 'Contact Improved', sub: `${pts(m.solid.diff)} vs your previous ${clubLabel} session` };
    }
  }

  if (comparison && longEnoughForComparison) {
    const m = comparison.metricsCompare;
    const clubLabel = comparison.match.session.default_club;
    const toppedImproved = m.topped.diff !== null && m.topped.diff <= -8;
    const fatImproved = m.fat.diff !== null && m.fat.diff <= -8;
    if (toppedImproved || fatImproved) {
      const useTopped = toppedImproved && (!fatImproved || m.topped.diff <= m.fat.diff);
      return {
        headline: useTopped ? 'Fewer Tops' : 'Fewer Fat Shots',
        sub: `${pts(useTopped ? m.topped.diff : m.fat.diff)} vs your previous ${clubLabel} session`,
      };
    }
  }

  if (!s.firstLast.overlapping && s.firstLast.first10.length && s.firstLast.last10.length) {
    const firstSolid = s.firstLast.first10.filter((sh) => sh.strike === 'solid').length;
    const lastSolid = s.firstLast.last10.filter((sh) => sh.strike === 'solid').length;
    if (lastSolid - firstSolid >= 3) {
      return { headline: 'Strong Finish', sub: `${lastSolid} of your last 10 shots were solid` };
    }
  }

  if (comparison && longEnoughForComparison) {
    if (comparison.metricsCompare.solidDistanceCV.diff !== null && comparison.metricsCompare.solidDistanceCV.diff <= -3) {
      return { headline: 'Consistency Improved', sub: 'Solid distance variability decreased' };
    }
  }

  if (comparison && longEnoughForComparison) {
    const targetImproved = comparison.targetAccuracyCompare.find((g) => g.improvementYards !== null && g.improvementYards >= 2);
    if (targetImproved) {
      return { headline: 'Target Accuracy Improved', sub: `${targetImproved.improvementYards} yd closer at ${targetImproved.target} yd` };
    }
  }

  if (s.streaks.cleanContact.length >= 6) {
    return { headline: 'Clean Contact Streak', sub: `${s.streaks.cleanContact.length} shots in a row without a top or fat` };
  }
  if (s.streaks.solid.length >= 4) {
    return { headline: 'Solid Streak', sub: `${s.streaks.solid.length} shots in a row` };
  }

  if (shots && shots.length) {
    const aidInsight = trainingAidInsight(shots, s.trainingAids);
    if (aidInsight) return aidInsight;
    const drillResult = drillInsight(shots, s.drills);
    if (drillResult) return drillResult;
  }

  // Falling all the way through means there's no comparison, streak, or
  // group-contrast story to tell. Past a real sample size, "nothing
  // notable happened" is a legitimate outcome — hide the card rather than
  // force a restatement (that's exactly the old "SOLID SESSION" problem).
  // Below that, a short session is too small for any of the above to mean
  // much anyway, so fall back to a plain, factual count of what happened —
  // additive framing (counts, not the same percentage the hero already
  // shows), never a trend or performance claim a handful of shots can't
  // support.
  if (s.total > MAX_SHOTS_FOR_FACTUAL_FALLBACK) return null;

  const solidCount = s.strike.solid.count;
  const others = STRIKE
    .filter((k) => k !== 'solid' && s.strike[k].count > 0)
    .sort((a, b) => s.strike[b].count - s.strike[a].count);
  if (!others.length) {
    return { headline: `All ${solidCount} Solid`, sub: 'No mis-hits this session.' };
  }
  const top = others[0];
  const topCount = s.strike[top].count;
  return {
    headline: `${solidCount} of ${s.total} Solid`,
    sub: `${topCount === 1 ? 'One' : topCount} ${cap(top)} strike${topCount === 1 ? '' : 's'}.`,
  };
}

// ---------- Session Recap "Next Goal" ----------
// A single, deterministic, forward-looking challenge for the NEXT session —
// never a swing tip, never generated by an LLM. Every goal type here is
// measured in "how many more/fewer shots would it have taken today," so
// they're directly comparable in effort; whichever is closest to already
// being true wins. No goal is invented just to fill the slot — returning
// null (and hiding the card) is a normal, expected outcome.

// Evenly-spaced, deliberately small milestone sets — never current+10.
// Reused for both Solid and Straight since both read "X% of shots were
// good," just on different dimensions. Capped at 90: pushing anyone
// (especially someone already excellent) toward a literal 100% is neither
// realistic nor useful (see product spec section 7).
const PCT_MILESTONES_UP = [40, 50, 60, 70, 80, 90];
// Descending — the next LOWER bar Top+Fat should land under. Bottoms out
// at 10, not 0: chasing zero poor-contact shots isn't a reasonable ask.
const PCT_MILESTONES_DOWN = [40, 30, 20, 15, 10];
const TARGET_MILESTONES_UP = [50, 60, 70, 80, 90];
const STREAK_MILESTONES = [5, 10, 15, 20, 25, 30];

const MIN_SHOTS_FOR_SOLID_GOAL = 10;
const MIN_SHOTS_FOR_TOPFAT_OR_STRAIGHT_GOAL = 20;
const MIN_SHOTS_FOR_STREAK_GOAL = 10;
const MIN_STREAK_FOR_GOAL = 4;
const MIN_SHOTS_AT_TARGET_FOR_GOAL = 10;
// Straight only becomes the more useful lever once contact itself is
// reasonably under control — otherwise fixing contact is still the bigger
// opportunity even if a Straight milestone happens to be numerically closer.
const SOLID_STABLE_FLOOR_PCT = 50;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// The number of ADDITIONAL good-outcome shots needed to reach `milestone`,
// computed from the exact shot count — never from an already-rounded
// percentage, so the copy can never describe a mathematically impossible
// scenario (see product spec section 21).
function shotsToReachUp(milestone, total) {
  return Math.ceil((milestone / 100) * total);
}

// The maximum poor-contact count that still qualifies as "under" a
// milestone (strict <, matching how the milestone is phrased to the
// golfer) — e.g. exactly 20% of 50 shots is 10, so "under 20%" requires 9
// or fewer, not 10.
function maxUnder(milestone, total) {
  const t = (milestone / 100) * total;
  return Number.isInteger(t) ? t - 1 : Math.floor(t);
}

export function solidContactGoal(s, total) {
  const solidCount = s.strike.solid.count;
  const pctExact = (solidCount / total) * 100;
  const next = PCT_MILESTONES_UP.find((m) => m > pctExact);
  if (next === undefined) return null;
  const needed = shotsToReachUp(next, total);
  const shotsAway = needed - solidCount;
  if (shotsAway <= 0) return null;
  return {
    type: 'solid_contact',
    title: `${next}% Solid Contact`,
    detail: `You were ${shotsAway} shot${shotsAway === 1 ? '' : 's'} away in a ${total}-ball session.`,
    metric: 'solid_percentage',
    target: next,
    current: round1(pctExact),
    shotsAway,
  };
}

export function topFatGoal(s, total) {
  const topFatCount = s.strike.topped.count + s.strike.fat.count;
  const pctExact = (topFatCount / total) * 100;
  const next = PCT_MILESTONES_DOWN.find((m) => m < pctExact);
  if (next === undefined) return null;
  const maxAllowed = maxUnder(next, total);
  const shotsAway = topFatCount - maxAllowed;
  if (shotsAway <= 0) return null;
  return {
    type: 'top_fat',
    title: `Top + Fat Under ${next}%`,
    detail: `You had ${topFatCount} Top/Fat shot${topFatCount === 1 ? '' : 's'} today. ${maxAllowed} or fewer gets you under ${next}%.`,
    metric: 'top_fat_percentage',
    target: next,
    current: round1(pctExact),
    shotsAway,
  };
}

export function straightGoal(s, total) {
  const solidPctExact = (s.strike.solid.count / total) * 100;
  if (solidPctExact < SOLID_STABLE_FLOOR_PCT) return null;
  const straightCount = s.direction.straight.count;
  const pctExact = (straightCount / total) * 100;
  const next = PCT_MILESTONES_UP.find((m) => m > pctExact);
  if (next === undefined) return null;
  const needed = shotsToReachUp(next, total);
  const shotsAway = needed - straightCount;
  if (shotsAway <= 0) return null;
  return {
    type: 'straight',
    title: `${next}% Straight`,
    detail: `You were ${shotsAway} shot${shotsAway === 1 ? '' : 's'} away in a ${total}-ball session.`,
    metric: 'straight_percentage',
    target: next,
    current: round1(pctExact),
    shotsAway,
  };
}

export function streakGoal(s, total) {
  if (total < MIN_SHOTS_FOR_STREAK_GOAL) return null;
  const streak = s.streaks.solid.length;
  if (streak < MIN_STREAK_FOR_GOAL) return null;
  const next = STREAK_MILESTONES.find((m) => m > streak);
  if (next === undefined) return null;
  return {
    type: 'solid_streak',
    title: `${next} Solid in a Row`,
    detail: `Your best streak today was ${streak}.`,
    metric: 'solid_streak',
    target: next,
    current: streak,
  };
}

// Only considers the target distance with the most shots this session (the
// one the golfer actually practiced against), and only when it has enough
// shots of its own to trust — a target dialed in for 3 shots mid-session
// isn't enough to build a goal on top of.
export function targetGoal(s, shots, total) {
  if (!s.targetAccuracy || !s.targetAccuracy.length) return null;
  const primary = [...s.targetAccuracy].sort((a, b) => b.count - a.count)[0];
  if (!primary || primary.count < MIN_SHOTS_AT_TARGET_FOR_GOAL) return null;

  const matching = shots.filter((sh) => sh.target_distance_yards === primary.target && isFiniteNumber(sh.distance_yards));
  if (!matching.length) return null;
  const withinCount = matching.filter((sh) => Math.abs(sh.distance_yards - primary.target) <= 10).length;
  const pctExact = (withinCount / matching.length) * 100;
  const next = TARGET_MILESTONES_UP.find((m) => m > pctExact);
  if (next === undefined) return null;
  const needed = shotsToReachUp(next, matching.length);
  const shotsAway = needed - withinCount;
  if (shotsAway <= 0) return null;
  return {
    type: 'target_accuracy',
    title: `${next}% Within 10 Yards`,
    detail: `${shotsAway} more accurate shot${shotsAway === 1 ? '' : 's'} gets you there.`,
    metric: 'target_within_10yd_percentage',
    target: next,
    current: round1(pctExact),
    shotsAway,
  };
}

// Not used by anything yet — carried on every goal object so a future
// "Start Similar Session" feature can reuse the exact practice context
// (see product spec section 25) without this generator needing to change.
function goalContext(session) {
  return {
    club: session.default_club,
    setup: session.default_setup,
    surface: session.default_surface,
    swing: session.default_swing,
    drill: session.current_drill,
    trainingAid: session.current_training_aid,
  };
}

export function getNextGoal(s, shots, session) {
  const total = s.total;
  if (!total) return null;

  const candidates = [];
  if (total >= MIN_SHOTS_FOR_SOLID_GOAL) {
    const g = solidContactGoal(s, total);
    if (g) candidates.push(g);
  }
  if (total >= MIN_SHOTS_FOR_TOPFAT_OR_STRAIGHT_GOAL) {
    const g = topFatGoal(s, total);
    if (g) candidates.push(g);
  }
  if (total >= MIN_SHOTS_FOR_TOPFAT_OR_STRAIGHT_GOAL) {
    const g = straightGoal(s, total);
    if (g) candidates.push(g);
  }

  let goal = null;
  if (candidates.length) {
    // Whichever is closest to already being true wins — the easiest
    // genuine next step, not necessarily whichever tier was checked first.
    // Ties keep insertion order above (Solid > Top+Fat > Straight).
    goal = candidates.reduce((best, c) => (c.shotsAway < best.shotsAway ? c : best), candidates[0]);
  } else {
    goal = streakGoal(s, total) || targetGoal(s, shots, total);
  }

  if (!goal) return null;
  return { ...goal, context: goalContext(session) };
}
