// Round analytics — pure functions over a round and its holes. No DOM, no
// storage, no side effects, so every rule here is unit-testable and lives in
// exactly one place.
//
// THE HONESTY RULE (docs/course-mode-spec.md §7.4)
//
// Course Mode records, per hole: par, yardage, strokes, clubs_used,
// short_game_strokes, putts. It does NOT record shot order, shot outcome,
// direction, or which club hit which shot.
//
// Every sentence produced here must be traceable to one of those fields. A
// reviewer should be able to name the field behind any claim. If they
// cannot, the sentence is wrong.
//
//   Never: "Your 9i missed left four times."      (no direction captured)
//   Never: "You lost 3 strokes with the driver."  (no per-shot attribution)
//   OK:    "Your 9i appeared on several of your higher-scoring holes."
//   OK:    "Extra shots around the green added strokes today."


// A hole played to regulation is two putts plus (par - 2) full swings, with
// nothing dropped around the green. That baseline is what the stroke
// decomposition below measures against.
const BASELINE_PUTTS_PER_HOLE = 2;

// Below this, a round hasn't shown enough to recommend anything, and the
// Next Practice card is omitted rather than padded out (§8).
export const MIN_HOLES_FOR_PLAN = 5;

// A club must appear on at least this many holes before it can be named —
// one bad hole is not a pattern.
const MIN_HOLES_FOR_CLUB_SIGNAL = 2;
// ...and those holes must average at least this many strokes worse than the
// rest of the round.
const CLUB_SIGNAL_MARGIN = 1;

const THREE_PUTT_HOLES_TRIGGER = 2;

export function roundTotals(holes) {
  const holesPlayed = holes.length;
  const strokes = holes.reduce((s, h) => s + h.strokes, 0);
  // Par is summed only over holes that actually carry one, and score to par
  // is computed only over the holes played — a round walked off after seven
  // is +N over seven holes, not over eighteen (§8).
  const scoredHoles = holes.filter((h) => h.par != null);
  const par = scoredHoles.reduce((s, h) => s + h.par, 0);
  const putts = holes.reduce((s, h) => s + h.putts, 0);
  const shortGame = holes.reduce((s, h) => s + h.short_game_strokes, 0);

  return {
    holesPlayed,
    strokes,
    par,
    hasPar: scoredHoles.length === holesPlayed && holesPlayed > 0,
    toPar: strokes - par,
    putts,
    shortGame,
    // Whatever is left once putts and greenside strokes are removed. This is
    // arithmetic on recorded fields, not an inference about ball flight.
    fullSwings: Math.max(0, strokes - putts - shortGame),
  };
}

// Splits score-to-par into three buckets that sum back to it exactly:
//
//   puttsOver     = putts - 2 per hole
//   shortGameOver = every greenside stroke (regulation drops none)
//   fullSwingOver = the remainder against (par - 2) swings per hole
//
// The three always add up to toPar, so no stroke is double-counted or
// invented, and the largest bucket is a defensible answer to "where did the
// strokes go?" — while still only ever describing fields we collected.
//
// fullSwingOver is taken as the residual rather than as
// `fullSwings - baselineSwings`. The two are algebraically identical on a
// consistent hole, but roundTotals clamps fullSwings at zero (§5.4 forbids
// negative derived values), and on an inconsistent hole — putts plus
// greenside strokes exceeding the strokes recorded — that clamp would
// otherwise drop the excess and leave the buckets no longer summing to
// toPar. Deriving the remainder keeps the invariant true for every input.
// These are signed variances against a baseline, not stroke counts, so a
// negative one is meaningful ("better than baseline") rather than invalid.
export function strokeBreakdown(holes) {
  const t = roundTotals(holes);
  const baselinePutts = BASELINE_PUTTS_PER_HOLE * t.holesPlayed;

  const puttsOver = t.putts - baselinePutts;
  const shortGameOver = t.shortGame;

  return {
    ...t,
    puttsOver,
    shortGameOver,
    fullSwingOver: t.toPar - puttsOver - shortGameOver,
  };
}

// Holes on which a club appeared, and how those holes scored relative to
// par compared with the holes it did not appear on. "Appeared on" is the
// strongest claim the data supports — clubs_used is an unordered set with no
// counts, so nothing here says a club caused anything (§7.4).
export function clubAssociations(holes) {
  const scored = holes.filter((h) => h.par != null);
  if (!scored.length) return [];

  const byClub = new Map();
  for (const h of scored) {
    for (const club of h.clubs_used || []) {
      if (!byClub.has(club)) byClub.set(club, []);
      byClub.get(club).push(h);
    }
  }

  const out = [];
  for (const [club, clubHoles] of byClub) {
    if (clubHoles.length < MIN_HOLES_FOR_CLUB_SIGNAL) continue;
    const others = scored.filter((h) => !clubHoles.includes(h));
    if (!others.length) continue;
    const avg = (list) => list.reduce((s, h) => s + (h.strokes - h.par), 0) / list.length;
    const withClub = avg(clubHoles);
    const withoutClub = avg(others);
    out.push({ club, holeCount: clubHoles.length, avgToPar: withClub, margin: withClub - withoutClub });
  }
  return out.sort((a, b) => b.margin - a.margin);
}

// ---------- The one positive moment (§4.5) ----------
//
// Exactly one, never stacked, and always true. When nothing noteworthy is
// true it states a plain fact rather than inventing praise — the card is
// never omitted, because the round always deserves acknowledgement, but it
// never lies.
//
// Rules in priority order; the first that holds wins:
//   1. Best round at this course (needs a comparable prior round there)
//   2. Best round in recent memory (needs 3+ comparable prior rounds)
//   3. A genuinely strong finish (last three holes beat the rest per hole)
//   4. Pars or better, when there were any
//   5. A plain factual line
export function positiveMoment(round, holes, priorRounds = []) {
  const t = roundTotals(holes);
  const courseName = round.course_name || 'this course';

  // Only rounds over the same number of holes are comparable.
  const comparable = priorRounds.filter((p) => p.holesPlayed === t.holesPlayed);

  if (t.hasPar && comparable.length) {
    const sameCourse = comparable.filter((p) => p.course_id && round.course_id && p.course_id === round.course_id);
    if (sameCourse.length && sameCourse.every((p) => t.toPar < p.toPar)) {
      return { headline: 'New best here', detail: `Your best round yet at ${courseName}.` };
    }
    if (comparable.length >= 3 && comparable.every((p) => t.toPar < p.toPar)) {
      return { headline: 'Best in a while', detail: `Your lowest score across your last ${comparable.length} rounds.` };
    }
  }

  if (t.hasPar && t.holesPlayed >= 6) {
    const last3 = holes.slice(-3);
    const rest = holes.slice(0, -3);
    const perHole = (list) => list.reduce((s, h) => s + (h.strokes - h.par), 0) / list.length;
    const finishToPar = last3.reduce((s, h) => s + (h.strokes - h.par), 0);
    // Only a finish that genuinely beat the rest of the round counts.
    if (rest.length && perHole(last3) < perHole(rest)) {
      return {
        headline: 'Nice finish!',
        detail: `You played the last 3 holes in ${formatToPar(finishToPar)}.`,
      };
    }
  }

  if (t.hasPar) {
    const parsOrBetter = holes.filter((h) => h.strokes <= h.par).length;
    if (parsOrBetter > 0) {
      return {
        headline: `${parsOrBetter} par${parsOrBetter === 1 ? '' : 's'} or better`,
        detail: `You matched or beat par on ${parsOrBetter} hole${parsOrBetter === 1 ? '' : 's'} today.`,
      };
    }
  }

  return {
    headline: 'Round complete',
    detail: `${t.holesPlayed} hole${t.holesPlayed === 1 ? '' : 's'} played at ${courseName}.`,
  };
}

export function formatToPar(toPar) {
  if (toPar === 0) return 'even';
  return toPar > 0 ? `+${toPar}` : String(toPar);
}

// ---------- Next Practice recommendation, V1 (§7) ----------
//
// Deliberately rule-based and transparent: the focus is whichever stroke
// bucket cost the most, using the decomposition above. That makes the answer
// to "why am I practicing this?" a single arithmetic statement over recorded
// fields, and it makes the rules reviewable and tunable in one place.
//
//   1. Fewer than MIN_HOLES_FOR_PLAN holes  -> no plan; the card is omitted.
//   2. Three or more three-putt holes, or the putting bucket is largest
//      -> putting.
//   3. The greenside bucket is largest -> short game.
//   4. The full-swing bucket is largest -> ball striking, narrowed to one
//      club when a club appeared on clearly higher-scoring holes.
//   5. Nothing cost anything (a level or better round) -> a maintenance
//      focus built from the largest bucket regardless, framed as upkeep.
//
// Every rationale names a number that came straight from §6's fields.
export function practiceFocus(round, holes) {
  if (holes.length < MIN_HOLES_FOR_PLAN) return null;

  const b = strokeBreakdown(holes);
  if (!b.hasPar) return null; // without par nothing can be measured against

  const threePutts = holes.filter((h) => h.putts >= 3).length;
  const puttsPerHole = b.putts / b.holesPlayed;
  const largest = Math.max(b.puttsOver, b.shortGameOver, b.fullSwingOver);
  const costStrokes = largest > 0;

  if (threePutts >= THREE_PUTT_HOLES_TRIGGER || (costStrokes && b.puttsOver === largest)) {
    return {
      focus_title: 'Sharpen your putting',
      focus_rationale: threePutts >= THREE_PUTT_HOLES_TRIGGER
        ? `You had ${threePutts} three-putt holes today.`
        : `You averaged ${round1(puttsPerHole)} putts per hole.`,
      goal_text: 'save 2–3 strokes',
      signal: 'putting',
      steps: [
        { order: 1, title: 'Lag control', detail: '20 putts • from 30, 40 and 50 feet', ball_count: 20 },
        { order: 2, title: 'Short range', detail: '15 putts • from 3 to 5 feet', ball_count: 15 },
        { order: 3, title: 'Pressure finish', detail: 'Hole 5 in a row from 4 feet', challenge_count: 5 },
      ],
    };
  }

  if (costStrokes && b.shortGameOver === largest) {
    return {
      focus_title: 'Sharpen short game',
      focus_rationale: 'Extra shots around the green added strokes today.',
      goal_text: 'save 2–3 strokes',
      signal: 'short_game',
      steps: [
        { order: 1, title: 'Chipping contact', detail: '20 balls • land on, or just onto, the green', ball_count: 20 },
        { order: 2, title: 'Distance control', detail: '15 balls • short, medium, long chips', ball_count: 15 },
        { order: 3, title: 'Pressure finish', detail: 'Play 3 up-and-down challenges', challenge_count: 3 },
      ],
    };
  }

  if (costStrokes && b.fullSwingOver === largest) {
    // When one club shows up on clearly worse holes, name it — but only as
    // "appeared on", which is all clubs_used supports (§7.4).
    const [top] = clubAssociations(holes).filter((c) => c.margin >= CLUB_SIGNAL_MARGIN);
    if (top) {
      return {
        focus_title: `Build confidence with the ${top.club}`,
        focus_rationale: `Your ${top.club} appeared on several of your higher-scoring holes.`,
        goal_text: 'save 2–3 strokes',
        signal: 'club',
        club: top.club,
        steps: [
          { order: 1, title: `${top.club} contact`, detail: `20 balls • ${top.club} only, focus on strike`, ball_count: 20 },
          { order: 2, title: 'Pick a target', detail: `15 balls • ${top.club} to a specific target`, ball_count: 15 },
          { order: 3, title: 'Mixed set', detail: '10 balls • alternate clubs, one swing each', ball_count: 10 },
        ],
      };
    }
    return {
      focus_title: 'Tighten your ball striking',
      focus_rationale: 'Most of your strokes came from full swings today.',
      goal_text: 'save 2–3 strokes',
      signal: 'full_swing',
      steps: [
        { order: 1, title: 'Contact quality', detail: '20 balls • one club, focus on strike', ball_count: 20 },
        { order: 2, title: 'Target window', detail: '15 balls • pick a target for every ball', ball_count: 15 },
        { order: 3, title: 'Club ladder', detail: '10 balls • change club every shot', ball_count: 10 },
      ],
    };
  }

  // A level or better round still gets a focus, framed as upkeep rather than
  // a correction — nothing here claims a weakness that the numbers deny.
  return {
    focus_title: 'Keep your contact sharp',
    focus_rationale: 'Your scoring held up today — keep the strike consistent.',
    goal_text: 'hold your scoring',
    signal: 'maintenance',
    steps: [
      { order: 1, title: 'Contact quality', detail: '20 balls • one club, focus on strike', ball_count: 20 },
      { order: 2, title: 'Target window', detail: '15 balls • pick a target for every ball', ball_count: 15 },
    ],
  };
}

// Whether a focus can actually be practiced as a range session.
//
// A putting focus cannot (§11.8): a range session logs strike, direction,
// height and distance, and there is no putting session type — so offering
// "start this practice" on a putting plan would open a session that has
// nothing to do with the plan. Such a plan stays useful as a written
// reminder; it simply has no start action.
export function isRangePracticable(focusType) {
  return focusType !== 'putting';
}

// Ball count to pre-fill Session Setup with: the sum of the steps that
// actually count balls (§7.8). Steps measured in challenges rather than
// balls contribute nothing, and a plan made only of challenges yields null
// so the golfer's own default is kept rather than a fabricated number.
export function planBallCount(steps) {
  if (!Array.isArray(steps)) return null;
  const total = steps.reduce((sum, s) => sum + (Number(s?.ball_count) || 0), 0);
  return total > 0 ? total : null;
}

// ---------- Explore Round (§9) ----------
//
// Every function below is bounded by §6's fields and the §7.7 wording rules:
// association is never causation, a club is only ever described as having
// appeared on holes, and no claim is made below its sample threshold (§9.5).

// A 3-hole window must not be half the round, so stretches are not a
// finding below 6 holes.
export const MIN_HOLES_FOR_STRETCH = 6;
const STRETCH_LENGTH = 3;

// A row in the club table is a recorded fact and needs 2 holes; a narrative
// sentence is a claim and needs 3 (§9.5).
export const MIN_HOLES_FOR_CLUB_SENTENCE = 3;

// The screen's always-visible answer to "where did the strokes go?" (§9.2).
//
// Names only the single largest bucket — never a ranked list — and says so
// plainly when two are within a stroke of each other rather than inventing a
// winner. A round at or under par reports what held up instead of
// manufacturing a loss.
export function strokeStory(holes) {
  const b = strokeBreakdown(holes);
  if (!b.hasPar || !b.holesPlayed) return null;

  const holeWord = `${b.holesPlayed} hole${b.holesPlayed === 1 ? '' : 's'}`;
  if (b.toPar <= 0) {
    return {
      kind: 'held_up',
      text: `You played ${holeWord} in ${b.toPar === 0 ? 'even par' : `${b.toPar} under par`}.`,
    };
  }

  const buckets = [
    { key: 'putting', label: 'Putting', value: b.puttsOver },
    { key: 'short_game', label: 'Greenside strokes', value: b.shortGameOver },
    { key: 'full_swing', label: 'Full swings', value: b.fullSwingOver },
  ].filter((x) => x.value > 0).sort((a, b2) => b2.value - a.value);

  if (!buckets.length) {
    return { kind: 'held_up', text: `You played ${holeWord} in ${formatToPar(b.toPar)}.` };
  }

  const [top, second] = buckets;
  if (second && top.value - second.value <= 1) {
    return {
      kind: 'tied',
      text: `${top.label} and ${second.label.toLowerCase()} each added about ${formatToPar(top.value)}.`,
    };
  }

  // A bucket can legitimately exceed score to par, because the split is
  // signed against a two-putt-per-hole baseline: a golfer who beats that
  // baseline makes puttsOver negative, which pushes another bucket above the
  // round's own total. "+18 of your +9" is the part-larger-than-the-whole
  // reading that produces, so where a bucket saved strokes we name it
  // instead of implying a share. Both halves are recorded fields (§7.4).
  const saver = SAVER_LABELS
    .map((s) => ({ ...s, value: b[s.field] }))
    .filter((s) => s.value < 0)
    .sort((a, b2) => a.value - b2.value)[0];

  if (top.value > b.toPar) {
    return {
      kind: top.key,
      text: saver
        ? `${top.label} added ${formatToPar(top.value)}, and ${saver.label} saved ${Math.abs(saver.value)}.`
        : `${top.label} added ${formatToPar(top.value)}.`,
    };
  }

  return {
    kind: top.key,
    text: `${top.label} accounted for ${formatToPar(top.value)} of your ${formatToPar(b.toPar)}.`,
  };
}

// Lower-case mid-sentence forms, used only when a bucket came in under its
// baseline and is named as the offset in strokeStory.
const SAVER_LABELS = [
  { key: 'putting', field: 'puttsOver', label: 'putting' },
  { key: 'short_game', field: 'shortGameOver', label: 'greenside play' },
  { key: 'full_swing', field: 'fullSwingOver', label: 'full swings' },
];

// Best and worst consecutive 3-hole stretches by score to par. Returns null
// below MIN_HOLES_FOR_STRETCH, where the window would be half the round.
export function holeStretches(holes) {
  const scored = holes.filter((h) => h.par != null);
  if (scored.length < MIN_HOLES_FOR_STRETCH) return null;

  let best = null;
  let worst = null;
  for (let i = 0; i + STRETCH_LENGTH <= scored.length; i++) {
    const window = scored.slice(i, i + STRETCH_LENGTH);
    const toPar = window.reduce((s, h) => s + (h.strokes - h.par), 0);
    const entry = { from: window[0].hole_number, to: window[STRETCH_LENGTH - 1].hole_number, toPar };
    if (!best || toPar < best.toPar) best = entry;
    if (!worst || toPar > worst.toPar) worst = entry;
  }
  // A single flat round has one stretch that is both; reporting the same
  // holes as best and worst says nothing.
  if (best && worst && best.from === worst.from) worst = null;
  return { best, worst };
}

// Holes ranked by greenside strokes, heaviest first — a plain reading of
// short_game_strokes, with no claim about why.
export function shortGameHoles(holes) {
  return holes
    .filter((h) => h.short_game_strokes > 0)
    .sort((a, b) => b.short_game_strokes - a.short_game_strokes || a.hole_number - b.hole_number);
}

export function puttingSummary(holes) {
  const t = roundTotals(holes);
  const threePutts = holes.filter((h) => h.putts >= 3);
  return {
    total: t.putts,
    perHole: t.holesPlayed ? round1(t.putts / t.holesPlayed) : 0,
    threePutts,
    // Only mentioned when at least one exists (§9.5).
    hasThreePutts: threePutts.length > 0,
  };
}

// Which clubs appeared and on how many holes — a record of what was logged,
// never a ranking by quality.
export function clubUsage(holes) {
  const counts = new Map();
  for (const h of holes) {
    for (const club of h.clubs_used || []) {
      counts.set(club, (counts.get(club) || 0) + 1);
    }
  }
  const associations = new Map(clubAssociations(holes).map((a) => [a.club, a]));
  return [...counts.entries()]
    .map(([club, holeCount]) => ({
      club,
      holeCount,
      avgToPar: associations.get(club)?.avgToPar ?? null,
      margin: associations.get(club)?.margin ?? null,
    }))
    .sort((a, b) => b.holeCount - a.holeCount || a.club.localeCompare(b.club));
}

// Comparable means the SAME course and the SAME number of holes played
// (§9.8). Course difficulty is not captured, so a round at one course can
// never be compared with a round at another, and a 9 is never compared with
// an 18. Each prior round is { course_id, holesPlayed, toPar, putts }.
export function comparableRounds(round, holesPlayed, priorRounds = []) {
  if (!round.course_id) return [];
  return priorRounds.filter((p) => p.course_id === round.course_id && p.holesPlayed === holesPlayed);
}

// Factual deltas only (§9.8) — never "you're improving", which is a trend
// claim and Trends' job. Returns null rather than a placeholder when there
// is nothing comparable.
export function scoringComparison(round, holes, priorRounds = []) {
  const t = roundTotals(holes);
  if (!t.hasPar) return null;
  const comparable = comparableRounds(round, t.holesPlayed, priorRounds);
  if (!comparable.length) return null;

  if (comparable.length >= 3) {
    const avg = comparable.reduce((s, p) => s + p.toPar, 0) / comparable.length;
    const diff = Math.round((t.toPar - avg) * 10) / 10;
    return {
      kind: 'recent',
      diff,
      label: diff === 0
        ? `Level with your average of ${comparable.length} rounds here`
        : `${Math.abs(diff)} ${diff < 0 ? 'better' : 'worse'} than your average of ${comparable.length} rounds here`,
      improved: diff < 0,
    };
  }

  const [last] = comparable;
  const diff = t.toPar - last.toPar;
  return {
    kind: 'last',
    diff,
    label: diff === 0
      ? 'Same as your last round here'
      : `${Math.abs(diff)} ${diff < 0 ? 'better' : 'worse'} than your last round here`,
    improved: diff < 0,
  };
}

// Putts against the golfer's own average at this course. Needs 3 comparable
// rounds — one prior round is not an average (§9.8).
export function puttingComparison(round, holes, priorRounds = []) {
  const t = roundTotals(holes);
  const comparable = comparableRounds(round, t.holesPlayed, priorRounds)
    .filter((p) => Number.isFinite(p.putts));
  if (comparable.length < 3) return null;

  const avg = comparable.reduce((s, p) => s + p.putts, 0) / comparable.length;
  const diff = Math.round((t.putts - avg) * 10) / 10;
  return {
    diff,
    label: diff === 0
      ? 'Level with your putting average here'
      : `${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} putts than your average here`,
    improved: diff < 0,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
