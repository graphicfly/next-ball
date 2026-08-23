// Glue layer between db.js and the pure stats.js calculators for the
// "Compared with Previous Session" / "Best 10 vs Previous Best 10" /
// target-accuracy-comparison features. Kept separate from stats.js so that
// module can stay a pure, db-free calculator, and separate from the screens
// so summary.js and historyDetail.js compute this identically.

import * as db from './db.js';
import {
  findComparableSession, compareMetrics, compareBestWindows, compareTargetAccuracy, bestWindow, targetAccuracyGroups,
  strikeBreakdown, streaksSummary, distanceConsistency,
} from './stats.js';

// Returns null if there's no prior finished session to compare against at
// all. Otherwise returns { match, metricsCompare, bestWindowCompare,
// targetAccuracyCompare } — match.comparable is false when nothing about
// the prior session actually matched (still shown, but labeled as such).
export function getComparisonContext(session, shots, currentBestWindow) {
  const priorFinished = db.listFinishedSessions()
    .filter((s) => s.session_id !== session.session_id && (s.created_at || '') < (session.created_at || ''));
  if (!priorFinished.length) return null;

  const shotsBySessionId = new Map();
  for (const s of priorFinished) shotsBySessionId.set(s.session_id, db.getShotsForSession(s.session_id));

  const match = findComparableSession(session, shots, priorFinished, shotsBySessionId);
  if (!match || !match.session) return null;

  const comparisonShots = shotsBySessionId.get(match.session.session_id) || [];
  const metricsCompare = compareMetrics(shots, comparisonShots);
  const comparisonBestWindow = bestWindow(comparisonShots);
  const bestWindowCompare = compareBestWindows(currentBestWindow, comparisonBestWindow);
  const targetAccuracyCompare = compareTargetAccuracy(targetAccuracyGroups(shots), targetAccuracyGroups(comparisonShots));

  return { match, metricsCompare, bestWindowCompare, targetAccuracyCompare };
}

// Genuine personal bests, scoped to the same club so a wedge session is
// never compared against a driver session. Requires at least two prior
// finished sessions with that club — on someone's first or second time
// hitting a club, "best ever" isn't a meaningful claim, so nothing is
// flagged rather than trivially crowning every metric a record.
const MIN_PRIOR_SESSIONS_FOR_BEST = 2;

export function getPersonalBests(session, shots, s) {
  if (!session.default_club) return [];
  const priorSameClub = db.listFinishedSessions()
    .filter((p) => p.session_id !== session.session_id && p.default_club === session.default_club);
  if (priorSameClub.length < MIN_PRIOR_SESSIONS_FOR_BEST) return [];

  const priorShots = priorSameClub.map((p) => db.getShotsForSession(p.session_id));

  const bests = [];

  const solidPct = strikeBreakdown(shots).solid.pct;
  const priorSolidPcts = priorShots.map((sh) => strikeBreakdown(sh).solid.pct);
  if (shots.length >= 10 && solidPct > Math.max(...priorSolidPcts)) {
    bests.push({ type: 'solidPct', label: 'Best Solid %', value: solidPct });
  }

  if (s.bestWindow) {
    const priorBestWindowPcts = priorShots
      .map((sh) => bestWindow(sh))
      .filter(Boolean)
      .map((w) => w.solidPct);
    if (priorBestWindowPcts.length && s.bestWindow.solidPct > Math.max(...priorBestWindowPcts)) {
      bests.push({ type: 'bestWindowSolidPct', label: 'Best 10-Shot Solid %', value: s.bestWindow.solidPct });
    }
  }

  const cleanStreak = s.streaks.cleanContact.length;
  const priorCleanStreaks = priorShots.map((sh) => streaksSummary(sh).cleanContact.length);
  if (cleanStreak > 0 && cleanStreak > Math.max(...priorCleanStreaks)) {
    bests.push({ type: 'cleanContactStreak', label: 'Longest Clean-Contact Streak', value: cleanStreak });
  }

  const curCV = s.consistency.distance.solid.enoughData ? s.consistency.distance.solid.cv : null;
  if (curCV !== null) {
    const priorCVs = priorShots
      .map((sh) => distanceConsistency(sh).solid)
      .filter((d) => d.enoughData)
      .map((d) => d.cv);
    if (priorCVs.length && curCV < Math.min(...priorCVs)) {
      bests.push({ type: 'solidDistanceCV', label: 'Most Consistent Solid Distance', value: curCV });
    }
  }

  return bests;
}
