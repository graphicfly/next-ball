// Practice progress — the skill-area figures Progress shows, and the rules
// that decide whether they may be shown at all.
//
// docs/practice-spec.md §21 and §22. The thresholds live in practice.js and
// are applied HERE, centrally, rather than as ad hoc checks on a screen —
// so "enough data" means one thing everywhere, and changing it is one edit.
//
// Two separate acts, deliberately kept apart:
//   DESCRIBE   what happened          2 sessions, 20 shots per surface
//   CLAIM      that it is improving   3+ sessions, 30-40 comparable
//
// Next Ball may describe before it claims. It may never claim without the
// comparable context §21 requires.

import {
  MODES, isInside6, isHoled, meetsDescriptive, isVariablePractice,
  SURFACE_LABELS, PUTT_SURFACE_LABELS, pct,
} from './practice.js';

// Test data never reaches Progress, comparisons or insights — the
// cross-cutting rule from the README, applied at the door.
function real(sessions) {
  return sessions.filter((s) => (s.data_source || 'user') !== 'test');
}

export function shortGameOverview(sessions, chipsFor) {
  const all = real(sessions).filter((s) => s.mode === MODES.CHIPPING);
  // §13.1: Around the Green is variable practice and is held SEPARATELY. It
  // never feeds a by-lie or by-distance comparison, because the conditions
  // it was hit under were deliberately never collected.
  const fixed = all.filter((s) => !isVariablePractice(s));
  const variable = all.filter(isVariablePractice);

  const chips = fixed.flatMap((s) => chipsFor(s.session_id));
  const variableChips = variable.flatMap((s) => chipsFor(s.session_id));
  const scored = chips.filter((c) => c.prox_bucket != null);

  const out = {
    sessions: all.length,
    chips: chips.length + variableChips.length,
    headline: null,
    surfaces: [],
    variable: variableChips.length ? { sessions: variable.length, chips: variableChips.length } : null,
  };

  if (scored.length) {
    const in6 = scored.filter((c) => isInside6(c.prox_bucket)).length;
    // §22.1: the headline is ALL chipping and says so.
    out.headline = { value: `${pct(in6, scored.length)}%`, label: 'inside 6 ft · all chipping' };
  }

  // §8 rule 3: mat and grass are not equivalent, so they are described
  // separately or not at all — never averaged into one claim.
  out.surfaces = surfaceBreakdown(fixed, chipsFor, {
    surfaces: ['grass', 'mat'], labels: SURFACE_LABELS,
    measure: (list) => {
      const s = list.filter((c) => c.prox_bucket != null);
      return s.length ? { value: `${pct(s.filter((c) => isInside6(c.prox_bucket)).length, s.length)}%`, label: 'inside 6 ft' } : null;
    },
  });

  return out;
}

export function puttingOverview(sessions, puttsFor) {
  const all = real(sessions).filter((s) => s.mode === MODES.PUTTING);
  const shortSessions = all.filter((s) => s.kind === 'short' || s.kind === 'mixed');
  const lagSessions = all.filter((s) => s.kind === 'distance' || s.kind === 'mixed');

  const shortPutts = shortSessions.flatMap((s) => puttsFor(s.session_id)).filter((p) => p.distance_ft != null && p.distance_ft <= 10);
  const lagPutts = lagSessions.flatMap((s) => puttsFor(s.session_id)).filter((p) => p.distance_ft != null && p.distance_ft > 10);

  const out = { sessions: all.length, putts: shortPutts.length + lagPutts.length, headline: null, surfaces: [] };

  if (shortPutts.length) {
    const made = shortPutts.filter((p) => p.result === 'made').length;
    // §22.2: a practice make rate is never extrapolated into a course
    // probability, so the label says what it actually is.
    out.headline = { value: `${pct(made, shortPutts.length)}%`, label: 'short putts made in practice' };
  } else if (lagPutts.length) {
    const close = lagPutts.filter((p) => p.result === 'made' || p.leave_bucket === 'in_3').length;
    out.headline = { value: `${pct(close, lagPutts.length)}%`, label: 'lags inside 3 ft' };
  }

  out.surfaces = surfaceBreakdown(all, puttsFor, {
    surfaces: ['green', 'mat'], labels: PUTT_SURFACE_LABELS,
    measure: (list) => {
      const short = list.filter((p) => p.distance_ft != null && p.distance_ft <= 10);
      return short.length ? { value: `${pct(short.filter((p) => p.result === 'made').length, short.length)}%`, label: 'short putts made' } : null;
    },
  });

  return out;
}

// A descriptive, per-surface strip — shown only at the §21 DESCRIPTIVE
// threshold, and never carrying trend language. Returns [] rather than a
// placeholder: empty is empty (§22 rule 3).
function surfaceBreakdown(sessions, repsFor, { surfaces, labels, measure }) {
  const out = [];
  for (const surface of surfaces) {
    const inSurface = sessions.filter((s) => s.setup?.surface === surface);
    const reps = inSurface.flatMap((s) => repsFor(s.session_id));
    if (!meetsDescriptive({ sessions: inSurface.length, shots: reps.length })) continue;
    const m = measure(reps);
    if (!m) continue;
    out.push({ surface, label: labels[surface], ...m, sessions: inSurface.length, shots: reps.length });
  }
  // One surface alone is not a breakdown; it is the headline again.
  return out.length >= 2 ? out : [];
}

// §21: a trend claim needs the stronger threshold AND comparable context.
// When the comparison is not comparable the delta is SUPPRESSED, not
// annotated — an asterisk on a number the golfer cannot check is worse than
// no number.
export function mayClaimTrend({ sessions, shots, comparable }) {
  if (!comparable) return false;
  return sessions >= 3 && shots >= 30;
}
