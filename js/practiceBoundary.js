// The Course -> Practice boundary.
//
// docs/practice-spec.md §23. One rule, stated as an API rather than as a
// convention somebody has to remember:
//
//   COURSE identifies the CATEGORY.   PRACTICE identifies the PATTERN.
//
// Course Mode knows short_game_strokes and putts, via strokeBreakdown(). It
// does NOT know chip quality, lie, proximity, putt distance or miss
// direction. Practice knows all of those and knows nothing about scoring.
//
// So the two never appear in one sentence. They are returned as separate
// blocks, each labelled with where it came from, and this module has no way
// to express a causal claim joining them — which is the point. There is no
// second intelligence engine here: this is a boundary, and the numbers it
// carries are computed by the modules that already own them.

import { MODES, isVariablePractice, tendency, MISS_LABELS } from './practice.js';

export const PROVENANCE = { ROUNDS: 'rounds', PRACTICE: 'practice' };

// What Course Mode is permitted to say, in the vocabulary it actually
// collects. Deliberately a CATEGORY statement and never a ranking: "short
// game cost you the most" is a causal claim about something unobserved.
//
// Putting earns stronger language than the short game because putt count is
// directly counted rather than inferred (§23 rule 2).
export function roundsStatement({ shortGameStrokes = null, putts = null, threePutts = 0, rounds = 0 } = {}) {
  if (rounds < 2) return null;
  if (threePutts >= 3) {
    return {
      provenance: PROVENANCE.ROUNDS,
      text: `You recorded ${threePutts} three-putt holes across your last ${rounds} rounds.`,
    };
  }
  if (putts != null && shortGameStrokes != null && putts >= shortGameStrokes) {
    return { provenance: PROVENANCE.ROUNDS, text: 'Putting has accounted for more strokes recently.' };
  }
  if (shortGameStrokes != null && shortGameStrokes > 0) {
    return { provenance: PROVENANCE.ROUNDS, text: 'Short-game strokes have been elevated recently.' };
  }
  return null;
}

// What Practice is permitted to say. A pattern, never a score, and only from
// data that was actually collected — the same gate the summaries use.
//
// Around the Green is excluded: §13.1 forbids drawing a situational claim
// from practice whose situation was deliberately never recorded.
export function practiceStatement(sessions, { chipsFor, puttsFor }) {
  const real = sessions.filter((s) => (s.data_source || 'user') !== 'test');

  const lagPutts = real
    .filter((s) => s.mode === MODES.PUTTING)
    .flatMap((s) => puttsFor(s.session_id))
    .filter((p) => p.distance_ft != null && p.distance_ft > 10 && p.leave_dir != null);
  if (lagPutts.length >= 10) {
    const t = tendency(lagPutts, 'leave_dir');
    if (t) {
      const word = t.value === 'short' ? 'finish short' : 'run past';
      return { provenance: PROVENANCE.PRACTICE, text: `Long putts have tended to ${word}.` };
    }
  }

  const chips = real
    .filter((s) => s.mode === MODES.CHIPPING && !isVariablePractice(s))
    .flatMap((s) => chipsFor(s.session_id));
  if (chips.length >= 10) {
    const t = tendency(chips, 'miss_depth');
    if (t) {
      return {
        provenance: PROVENANCE.PRACTICE,
        text: `Your chips have tended to finish ${MISS_LABELS[t.value].toLowerCase()}.`,
      };
    }
  }
  return null;
}

// The two blocks together, never merged.
//
// Returns them as a pair so a caller cannot accidentally concatenate them
// into one sentence, and so "Focus comes from practice" (§23 rule 4) holds
// structurally: with no practice statement there is no Focus row, because
// there is nothing to put in it.
export function boundaryBlocks(roundsInput, sessions, accessors) {
  const fromRounds = roundsStatement(roundsInput);
  const fromPractice = practiceStatement(sessions, accessors);
  return {
    fromRounds,
    fromPractice,
    // Suggested comes from rounds; Focus comes from practice. Neither
    // explains the other.
    focus: fromPractice ? fromPractice.text : null,
  };
}
