// Transient, in-memory-only state. Deliberately NOT persisted: losing a
// half-entered single shot (a couple of taps) if the app is killed mid-entry
// is an acceptable cost, and keeping it out of localStorage keeps every
// completed shot write simple and atomic.

let draft = null;

export function startNewShotDraft() {
  draft = { mode: 'new', shotId: null, strike: null, direction: null, height: null };
  return draft;
}

export function startEditShotDraft(shot) {
  draft = {
    mode: 'edit',
    shotId: shot.shot_id,
    sessionId: shot.session_id,
    strike: shot.strike,
    direction: shot.direction,
    height: shot.height,
    distance_yards: shot.distance_yards,
    // The shot's own immutable swing length — never the session's current
    // setting, which may have changed since this shot was logged. Editing
    // never rewrites swing_length (see shotEntry.js's finishShot), this is
    // purely so the Distance screen knows which preset ladder to show.
    swing_length: shot.swing_length,
  };
  return draft;
}

export function getDraft() {
  if (!draft) draft = startNewShotDraft();
  return draft;
}

export function setDraftField(field, value) {
  getDraft()[field] = value;
}

export function clearDraft() {
  draft = null;
}

// Where to return to after the 4-step shot flow completes (active session,
// or a specific history detail page when editing a past shot).
let flowReturnHash = '#/active';
export function setFlowReturn(hash) {
  flowReturnHash = hash;
}
export function getFlowReturn() {
  return flowReturnHash;
}

// Same idea for Your Groove's back button (docs/ux-spec.md §4.7: "a
// ← Explore Session back button") — Explore Session isn't its own route
// (it's a client-side layer toggle inside Session Summary, or the whole of
// History Detail), so the screen that opened Your Groove records exactly
// where "back" should land.
let grooveReturnHash = '#/history';
export function setGrooveReturn(hash) {
  grooveReturnHash = hash;
}
export function getGrooveReturn() {
  return grooveReturnHash;
}

// The course chosen on Select a Course, held only until Round Setup turns it
// into an actual round. Transient for the same reason a half-entered shot is
// (see the module comment): the course record itself is already persisted by
// then, so the worst case after a refresh is re-tapping it in Recent —
// which is one tap, and by definition now the most recent course.
let pendingCourseId = null;
export function setPendingCourseId(courseId) {
  pendingCourseId = courseId;
}
export function getPendingCourseId() {
  return pendingCourseId;
}
export function clearPendingCourse() {
  pendingCourseId = null;
}

// The practice plan the golfer chose to practice, held only between that
// choice and the moment Session Setup actually creates the session. It is
// transient on purpose: the plan itself is already persisted, and if this is
// lost to a refresh the plan simply stays `saved` and can be started again —
// which is far better than a plan stuck at `started` with no session.
let pendingPlanId = null;
export function setPendingPlanId(planId) {
  pendingPlanId = planId;
}
export function getPendingPlanId() {
  return pendingPlanId;
}
export function clearPendingPlan() {
  pendingPlanId = null;
}

// Where the golfer was in a round, and what they had typed but not yet
// saved, held across a trip to the Hole Map and back (§14.4: "Returning
// lands back on the same hole with all entered values intact").
//
// This has to be transient rather than written to the hole record, and the
// reason matters: hole entry autosaves every value change, so anything the
// golfer actually TOUCHED is already in storage. What is not in storage is a
// hole they merely opened — and writing that on the way to the map would
// create a played hole out of a hole they only looked at, which would count
// toward holes played, skip in Save + Next Hole's search, and appear in the
// round summary. Keeping it here means the map round trip records nothing.
//
// Scoped to its round: a value left over from a finished round must never
// seed a new one, so the round id is checked on the way out.
let holeEntryState = null;

export function setHoleEntryState(roundId, holeNumber, draft) {
  holeEntryState = { roundId, holeNumber, draft: { ...draft, clubs_used: [...(draft?.clubs_used || [])] } };
}

// Returns the remembered position/draft for this round, or null. Reading
// does not consume it — renderCourseRound reads it to choose a hole, and
// renderHole then reads it again to seed that hole's draft.
export function getHoleEntryState(roundId) {
  if (!holeEntryState || holeEntryState.roundId !== roundId) return null;
  // Copied on the way out as well as in: hole entry mutates its draft on
  // every tap, and handing back the stored object would let those taps
  // rewrite the remembered state behind its back.
  const { draft } = holeEntryState;
  return {
    roundId: holeEntryState.roundId,
    holeNumber: holeEntryState.holeNumber,
    draft: { ...draft, clubs_used: [...(draft?.clubs_used || [])] },
  };
}

export function clearHoleEntryState() {
  holeEntryState = null;
}
