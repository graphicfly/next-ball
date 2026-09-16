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
