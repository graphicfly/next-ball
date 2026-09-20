// Practice summaries — the derived figures, with no DOM.
//
// Kept apart from the screen so the rules that matter most here can be
// tested directly: every number is a bucket predicate (practice-spec.md §7),
// and every pattern is gated on the coverage that produced it (§10).
//
// The two things this file must never do:
//   1. Average a categorical bucket into feet.
//   2. Claim a tendency from data that was not collected.

import {
  isHoled, isInside3, isInside6, tendency, coverage, pct,
  MISS_LABELS, LEAVE_LABELS, chippingDrill, isUpAndDown,
} from './practice.js';

export function chippingSummary(session, chips) {
  const drill = chippingDrill(session.practice_type);
  const total = chips.length;
  const out = { total, drill, headline: null, pattern: null, supporting: [] };
  if (!total) return out;

  const solid = chips.filter((c) => c.contact === 'solid').length;
  const holed = chips.filter((c) => isHoled(c.prox_bucket)).length;
  const scored = chips.filter((c) => c.prox_bucket != null);

  if (drill.result_model === 'zone') {
    const hit = chips.filter((c) => c.zone_hit === true).length;
    out.headline = { value: `${pct(hit, total)}%`, label: 'hit the landing zone' };
  } else if (drill.result_model === 'up_and_down') {
    // §12: derived from proximity and putt count together, never stored and
    // never confirmed by the golfer.
    const ups = chips.filter(isUpAndDown).length;
    out.headline = { value: `${pct(ups, total)}%`, label: 'up and down' };
  } else if (scored.length) {
    const in6 = scored.filter((c) => isInside6(c.prox_bucket)).length;
    out.headline = { value: `${pct(in6, scored.length)}%`, label: 'finished inside 6 ft' };
  }

  // §10: a pattern may only appear when its data was actually collected,
  // and it prints its own coverage. With nothing logged the block is
  // ABSENT — not empty, not caveated.
  const depth = tendency(chips, 'miss_depth');
  const lateral = tendency(chips, 'miss_lateral');
  const best = (depth && lateral) ? (depth.count >= lateral.count ? depth : lateral) : (depth || lateral);
  if (best) {
    const axisLabel = MISS_LABELS[best.value].toLowerCase();
    out.pattern = {
      text: `Most misses finished ${axisLabel}`,
      basis: `${best.logged} of the ${best.total} chips had a direction logged; ${best.count} of those finished ${axisLabel}.`,
    };
  }

  if (chips.some((c) => c.contact != null)) {
    out.supporting.push({ value: `${pct(solid, total)}%`, label: 'solid contact' });
  }
  if (holed) out.supporting.push({ value: String(holed), label: holed === 1 ? 'holed' : 'holed' });
  if (drill.result_model === 'up_and_down') {
    const withPutts = chips.filter((c) => c.putts != null);
    if (withPutts.length) {
      const onePutt = withPutts.filter((c) => c.putts === 1).length;
      out.supporting.push({ value: String(onePutt), label: 'one-putt finishes' });
    }
  }
  return out;
}

export function puttingSummary(session, putts) {
  const total = putts.length;
  const out = { total, headline: null, pattern: null, supporting: [], distanceLabel: null };
  if (!total) return out;

  const made = putts.filter((p) => p.result === 'made').length;
  const kind = session.kind;

  if (kind === 'distance') {
    const close = putts.filter((p) => p.result === 'made' || p.leave_bucket === 'in_3').length;
    out.distanceLabel = session.setup?.distance_ft != null ? `${session.setup.distance_ft} FT` : null;
    out.headline = { value: `${close} / ${total}`, label: 'finished inside 3 ft' };
    // Pace is mandatory by construction on every lag that was not holed
    // (§16), so this pattern always has full coverage — unlike short-putt
    // direction, which has to be gated.
    const lagged = putts.filter((p) => p.leave_dir != null);
    if (lagged.length >= 3) {
      const short = lagged.filter((p) => p.leave_dir === 'short').length;
      const past = lagged.length - short;
      if (short !== past) {
        const dominant = short > past ? 'short' : 'past the hole';
        out.pattern = {
          text: `Most misses finished ${dominant}`,
          basis: `${Math.max(short, past)} of the ${lagged.length} putts that missed finished ${dominant}.`,
        };
      }
    }
    if (made) out.supporting.push({ value: String(made), label: made === 1 ? 'holed' : 'holed' });
  } else {
    out.distanceLabel = session.setup?.distance_ft != null ? `${session.setup.distance_ft} FT` : null;
    out.headline = { value: `${made} / ${total}`, label: 'made' };
    const missed = putts.filter((p) => p.result === 'missed');
    const lateral = tendency(missed, 'miss_lateral');
    const depth = tendency(missed, 'miss_depth');
    const best = (lateral && depth) ? (lateral.count >= depth.count ? lateral : depth) : (lateral || depth);
    if (best) {
      const word = MISS_LABELS[best.value].toLowerCase();
      out.pattern = {
        text: `Misses tended ${word}`,
        basis: `${best.logged} of the ${missed.length} missed putts had a direction logged; ${best.count} of those missed ${word}.`,
      };
    }
  }

  if (session.practice_type === 'pressure_finish') {
    let best = 0, run = 0;
    for (const p of putts) { run = p.result === 'made' ? run + 1 : 0; if (run > best) best = run; }
    out.supporting.push({ value: String(best), label: 'best run' });
  }
  return out;
}
