// Deterministic personalization for the Session Setup screen — no ML, no
// LLM, just frequency + recency scoring over the golfer's own real session
// history. Every function here is pure given the session list you pass it
// (or defaults to reading real history itself), so it's independently
// testable and rebuildable from source data at any time: nothing here is
// "state" that can go stale after a delete/import — see recomputeAndStore*
// below, which persist only a STABILITY hint, never the source of truth.

import * as db from './db.js';

// Only real, finished sessions ever influence personalization — a
// simulated/seeded session (data_source: 'test') must never bias which
// clubs or ball counts show up as quick picks for the actual golfer.
export function realFinishedSessions() {
  return db.listFinishedSessions().filter((s) => db.sessionDataSource(s) === 'real');
}

// How many of the most-recent real sessions count toward the recency bonus,
// and how much that bonus is worth relative to one lifetime use. Kept small
// and simple by design (section 5 of the spec explicitly rules out anything
// fancier) — recency should nudge the ranking, not dominate it.
const RECENCY_WINDOW = 10;
const RECENCY_WEIGHT = 0.5;

// A challenger must beat the weakest current quick-pick by more than this
// margin before it's allowed to bump it — this is what keeps the row from
// visibly reshuffling every time two clubs are within a session of each
// other (spec section 30).
const REPLACE_MARGIN = 1.0;

// Ranks the values of `field` across `sessions` (newest-first, matching
// listSessions()'s own order) by lifetime frequency + a recency bonus for
// appearing in the most recent RECENCY_WINDOW sessions. Returns
// [{ value, score }] sorted highest-first, ties broken alphabetically so
// the result is fully deterministic.
export function rankByField(sessions, field) {
  const scores = new Map();
  for (const s of sessions) {
    const v = s[field];
    if (v === null || v === undefined || v === '') continue;
    scores.set(v, (scores.get(v) || 0) + 1);
  }
  for (const s of sessions.slice(0, RECENCY_WINDOW)) {
    const v = s[field];
    if (v === null || v === undefined || v === '') continue;
    scores.set(v, (scores.get(v) || 0) + RECENCY_WEIGHT);
  }
  return [...scores.entries()]
    .map(([value, score]) => ({ value, score }))
    .sort((a, b) => b.score - a.score || String(a.value).localeCompare(String(b.value)));
}

// Picks the top N values, preferring to keep `previous`'s order stable —
// a new value only displaces the previous list's weakest member once it
// clears REPLACE_MARGIN, and ties/near-ties never cause a swap. `previous`
// entries with no real usage left (score 0, e.g. after a deletion) are
// dropped before the stability check runs.
export function stableTopN(ranked, previous, n) {
  const scoreOf = (v) => ranked.find((r) => r.value === v)?.score ?? 0;
  let current = (previous || []).filter((v) => scoreOf(v) > 0);

  for (const { value } of ranked) {
    if (current.length >= n) break;
    if (!current.includes(value)) current.push(value);
  }
  current = current.slice(0, n);

  for (const { value: challenger, score: challengerScore } of ranked) {
    if (current.includes(challenger)) continue;
    let weakestIdx = 0;
    for (let i = 1; i < current.length; i++) {
      if (scoreOf(current[i]) < scoreOf(current[weakestIdx])) weakestIdx = i;
    }
    if (current.length < n) { current.push(challenger); continue; }
    if (challengerScore > scoreOf(current[weakestIdx]) + REPLACE_MARGIN) {
      current[weakestIdx] = challenger;
    }
  }
  return current.slice(0, n);
}

const DEFAULT_CLUB_QUICK_PICKS = ['PW', '7i', 'Hybrid', 'Driver'];
const DEFAULT_BALL_COUNT_QUICK_PICKS = [20, 30, 50];

// Returns the 4 club quick-picks to show, blending real usage history with
// sensible defaults when there isn't much history yet, and stabilized
// against the previously-shown row (persisted only as a presentation hint —
// see the module comment).
export function getClubQuickPicks() {
  const ranked = rankByField(realFinishedSessions(), 'default_club');
  const settings = db.getSettings();
  const previous = Array.isArray(settings.clubQuickPicks) && settings.clubQuickPicks.length ? settings.clubQuickPicks : DEFAULT_CLUB_QUICK_PICKS;
  const picks = stableTopN(ranked, previous, 4);
  // Backfill with defaults (never real clubs already shown) if history is
  // too thin to produce 4 distinct values on its own.
  for (const c of DEFAULT_CLUB_QUICK_PICKS) {
    if (picks.length >= 4) break;
    if (!picks.includes(c)) picks.push(c);
  }
  return picks.slice(0, 4);
}

export function getBallCountQuickPicks() {
  const ranked = rankByField(realFinishedSessions(), 'target_ball_count');
  const settings = db.getSettings();
  const previous = Array.isArray(settings.ballCountQuickPicks) && settings.ballCountQuickPicks.length ? settings.ballCountQuickPicks : DEFAULT_BALL_COUNT_QUICK_PICKS;
  const picks = stableTopN(ranked, previous, 3);
  for (const n of DEFAULT_BALL_COUNT_QUICK_PICKS) {
    if (picks.length >= 3) break;
    if (!picks.includes(n)) picks.push(n);
  }
  return picks.slice(0, 3).sort((a, b) => a - b);
}

// Persists the just-computed quick-pick rows as the new stability baseline.
// Call this once, right after reading the quick picks for a render — never
// speculatively — so the next render's stableTopN() call compares against
// what was actually just shown, not a stale value from several sessions
// ago. Safe to call every render: recomputing from source and re-saving
// the same list is a no-op.
export function recordClubQuickPicks(picks) {
  db.updateSettings({ clubQuickPicks: picks });
}

export function recordBallCountQuickPicks(picks) {
  db.updateSettings({ ballCountQuickPicks: picks });
}

// Defaults for a brand-new Session Setup screen, per the priority order in
// the spec: most recent REAL session > product defaults. Target is
// deliberately excluded — always starts Off for a new session regardless of
// what the last session used, so an old target distance never silently
// carries into an unrelated one. Training Aid restores the last real
// session's aid (visibly, since it's shown as its own row before Start
// Session) rather than silently defaulting to None, so the golfer can see
// and correct it before starting rather than losing it without noticing.
export function getLastRealSetupDefaults() {
  const [last] = realFinishedSessions();
  const settings = db.getSettings();
  if (!last) {
    return {
      club: settings.lastClub || null,
      setup: settings.lastSetup || 'ground',
      surface: settings.lastSurface || 'mat',
      swing: settings.lastSwing || 'full',
      ballCount: settings.lastBallCount || db.DEFAULT_BALL_COUNT,
      drill: db.DEFAULT_DRILL,
      trainingAid: db.DEFAULT_TRAINING_AID,
    };
  }
  return {
    club: last.default_club,
    setup: last.default_setup,
    surface: last.default_surface,
    swing: last.default_swing,
    ballCount: last.target_ball_count,
    drill: last.current_drill || db.DEFAULT_DRILL,
    trainingAid: last.current_training_aid || db.DEFAULT_TRAINING_AID,
  };
}
