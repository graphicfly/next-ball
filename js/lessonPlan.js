// Turning a lesson into a practice plan — docs/lesson-spec.md §4.
//
// The strict counterpart to roundAnalysis.practiceFocus(): same output
// shape, same plan record, different origin (§4.1). What it must never do
// is interpret the cue. §4.2 is explicit that a lesson-derived plan's
// reason line is the instructor's cue **verbatim**, not an app-generated
// rationale — the app is arranging practice around the instructor's words,
// not paraphrasing them.
//
// Steps are practice STRUCTURE, never swing advice. Where the lesson
// carries drills they are the steps, word for word. Where it does not, the
// fallback is a shape — warm up, work, finish — that references the cue
// without ever saying anything about how to swing.

// Balls per step in the fallback structure. Deliberately modest: the plan
// is a frame for the cue, not a workout, and §7.8 sums these to pre-fill
// Session Setup's ball count.
const WARMUP_BALLS = 10;
const WORK_BALLS = 20;
const FINISH_BALLS = 10;

// A drill's ball count is unknown — the instructor wrote a sentence, not a
// prescription — and inventing one would put a fabricated number in front
// of the golfer. Null leaves Session Setup on their own default (§7.8).
function stepsFromDrills(drills) {
  return drills.map((d, i) => ({
    order: i + 1,
    title: d.text,
    detail: '',
    ball_count: null,
  }));
}

function fallbackSteps(cueText) {
  return [
    { order: 1, title: `${WARMUP_BALLS} easy warm-up swings`, detail: 'Loosen up before thinking about anything.', ball_count: WARMUP_BALLS },
    // The cue is quoted, never rewritten. Quotation marks make it plain
    // that these are the instructor's words and not the app's — real
    // characters, not HTML entities, since every renderer escapes this
    // text and an entity would show up literally.
    { order: 2, title: `${WORK_BALLS} swings holding \u201c${cueText}\u201d`, detail: 'One thought only.', ball_count: WORK_BALLS },
    { order: 3, title: `${FINISH_BALLS} swings at full speed`, detail: 'Keep the cue, let the swing go.', ball_count: FINISH_BALLS },
  ];
}

// Returns the same object shape practiceFocus() returns, so createPlan and
// the Next Practice screen need no knowledge of where a plan came from.
// Null when the lesson cannot produce one, which only happens if it somehow
// has no cues — a state createLesson refuses.
export function lessonPracticeFocus(lesson, { cueOrder = 1 } = {}) {
  if (!lesson || !Array.isArray(lesson.cues) || !lesson.cues.length) return null;
  const cue = lesson.cues.find((c) => c.order === cueOrder) || lesson.cues[0];
  const drills = Array.isArray(lesson.drills) ? lesson.drills : [];

  return {
    // Not 'putting' — every lesson plan is practicable on a range, so
    // isRangePracticable() lets Start This Practice through (§11.8).
    signal: 'lesson',
    club: null,
    // Factual, never interpretive. The lesson is named; the cue is not
    // summarised into a title, because summarising it is exactly what §2.2
    // forbids.
    focus_title: lesson.instructor_name ? `Lesson with ${lesson.instructor_name}` : 'Your lesson',
    focus_rationale: cue.text,
    // Not a fabricated metric. §4.3 keeps goal suggestion separate and
    // optional, and §3.1 forbids converting a cue into a measurable target —
    // so the plan's goal is about carrying the cue, not about a number the
    // app would have had to invent.
    goal_text: 'Hold this one thought for the whole session.',
    steps: drills.length ? stepsFromDrills(drills) : fallbackSteps(cue.text),
  };
}
