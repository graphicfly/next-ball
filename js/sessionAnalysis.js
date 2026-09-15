// Glue layer between db.js and the pure stats.js calculators for the
// "Compared with Previous Session" / "Best 10 vs Previous Best 10" /
// target-accuracy-comparison features. Kept separate from stats.js so that
// module can stay a pure, db-free calculator, and separate from the screens
// so summary.js and historyDetail.js compute this identically.

import * as db from './db.js';
import {
  findComparableSession, compareMetrics, compareBestWindows, compareTargetAccuracy, bestWindow, targetAccuracyGroups,
  strikeBreakdown, streaksSummary, distanceConsistency, sessionSummary,
} from './stats.js';
import { getNextGoal, evaluateGoal } from './sessionStory.js';

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

// ---------- Next Goal persistence + evaluation ----------
// The single call site that creates, evaluates, or resolves a goal —
// called exactly once, at the moment a session transitions to 'finished'
// (see active.js's Finish button, home.js's End Session sheet, and
// shotEntry.js's in-flow End Session). Never called from a screen's render
// path, so revisiting Session Summary, Explore Session, or Home never
// regenerates or re-persists anything — those screens only ever READ via
// db.getActiveGoal()/db.getGoalForSession(), never write.
//
// Lifecycle, in order:
//   1. If there's a currently active goal, this session is first offered as
//      a chance to EVALUATE it (see sessionStory.js's evaluateGoal) —
//      never simply overwritten just because a new session happened.
//        - Not enough comparable data -> the attempt is recorded (so
//          Session Summary can explain why), status stays 'active', and
//          this session does NOT get a replacement goal of its own — the
//          golfer hasn't had a fair shot at the current one yet, so
//          nothing should compete with it.
//        - A conclusive result (met/almost/not_met) -> the goal is
//          resolved with that outcome. What happens next (keep the same
//          goal, set a new one, or dismiss) is the golfer's call, made on
//          Session Summary (see continueGoal/setNewGoalFromSession/
//          dismissGoalForSession below) — this function deliberately does
//          NOT auto-create a replacement in this branch.
//   2. Only when there was no active goal to begin with (first session
//      ever, or the golfer already chose "dismiss" with nothing pending)
//      does this session get an automatic fresh goal from its own data —
//      the original, unconditional behavior for that specific case.
export function finalizeSessionGoal(sessionId) {
  const alreadyHandled = db.getGoalForSession(sessionId)
    || db.getGoals().some((g) => g.evaluation && g.evaluation.evaluated_by_session_id === sessionId);
  if (alreadyHandled) return null; // already finalized for this session

  const session = db.getSession(sessionId);
  if (!session) return null;
  const shots = db.getShotsForSession(sessionId);
  const s = sessionSummary(shots);

  const activeGoal = db.getActiveGoal();
  if (activeGoal) {
    const result = evaluateGoal(activeGoal, session, shots, s);
    const record = { ...result, evaluated_by_session_id: sessionId, evaluated_at: new Date().toISOString(), dismissed: false };
    if (result.outcome === 'not_enough_data') {
      db.recordGoalEvaluationAttempt(activeGoal.goal_id, record);
    } else {
      db.resolveGoal(activeGoal.goal_id, GOAL_OUTCOME_TO_STATUS[result.outcome], { evaluation: record });
    }
    return null; // either way, this session does not also create its own goal
  }

  const goal = getNextGoal(s, shots, session);
  if (!goal) return null;
  return db.createGoal(sessionId, goal);
}

const GOAL_OUTCOME_TO_STATUS = { met: 'met', almost: 'partially_met', not_met: 'not_met' };

// ---------- Next Goal evaluation — user next-step actions ----------
// Session Summary offers exactly these three choices once an evaluation is
// conclusive (see summarySections.js's goalEvaluationCardHtml) — nothing
// else in the app writes to a goal's status/evaluation after the fact.

// "Continue This Goal" — puts the just-evaluated goal back to 'active' so
// the golfer gets another shot at the identical target next time.
export function continueGoal(goalId) {
  return db.reactivateGoal(goalId);
}

// "Set New Goal" — generates a fresh goal from THIS session's own data,
// same generator Finish would have used if there'd been nothing to
// evaluate. Safe to call at most meaningfully once per session: if this
// session already produced a goal (because the golfer already chose this),
// there's nothing left to do.
export function setNewGoalFromSession(sessionId) {
  if (db.getGoalForSession(sessionId)) return null;
  const session = db.getSession(sessionId);
  if (!session) return null;
  const shots = db.getShotsForSession(sessionId);
  const s = sessionSummary(shots);
  const goal = getNextGoal(s, shots, session);
  if (!goal) return null;
  return db.createGoal(sessionId, goal);
}

// "Dismiss For Now" — acknowledges the result without setting anything new;
// the golfer simply has no active goal until a future session creates one.
export function dismissGoalForSession(goalId) {
  return db.dismissGoalEvaluation(goalId);
}
