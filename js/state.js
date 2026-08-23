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
