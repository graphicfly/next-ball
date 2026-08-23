// Deterministic, rules-based "story" for a finished session — no AI, no
// randomness. Pure functions only: everything here takes already-computed
// data (from stats.js / sessionAnalysis.js) and picks/phrases ONE thing
// worth saying. Never manufactures praise the data doesn't support — every
// function here can return null, and callers must treat that as "say
// nothing" rather than falling back to generic text.

import { STRIKE, TRAINING_AID_LABELS } from './db.js';
import { cap } from './ui.js';
import { strikeBreakdown } from './stats.js';

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
