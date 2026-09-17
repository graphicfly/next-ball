import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { greenEdgeYards, yardsBetween, metersToYards } from '../geo.js';
import { watchPosition, POSITION_STATE, accuracyTier, yardagesUsable } from '../livePosition.js';

// Hole Map — docs/course-mode-spec.md §14.5, §14.6, §14.8, §14.10.
//
// SCOPE: this is the text readout and the live-position engine, not yet
// Reference C's aerial map. §14.10 requires that every value on that screen
// "is also available as readable text in the bottom readout and to assistive
// technology" — so this is that substrate, built first and deliberately. The
// imagery, hole-up rotation and the front/centre/back chips layered over it
// are the next piece, and they depend on §14.12.2's still-open provider
// decision. Nothing here will need to be undone to add them.
//
// What it does do in full: start a high-accuracy watch on open, stop it on
// every exit, answer "how far am I from the green?", and behave correctly in
// all six of §14.8's GPS states.

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
const ICON_PIN = '<path d="M12 21s6.5-5.8 6.5-10.3a6.5 6.5 0 1 0-13 0C5.5 15.2 12 21 12 21Z" /><circle cx="12" cy="10.4" r="2.4" />';

// §14.8's wording, chosen so no state blames the golfer and none of them
// reads as an error — poor accuracy is a condition, not a failure.
const STATE_COPY = {
  [POSITION_STATE.LOCATING]: 'Locating…',
  [POSITION_STATE.DENIED]: "Location is off, so live yardages aren't available.",
  [POSITION_STATE.UNAVAILABLE]: "Live yardages aren't available on this device.",
  [POSITION_STATE.TIMEOUT]: "Couldn't get a location fix.",
};

export function renderHoleMap(root, holeNumberParam) {
  const round = db.getActiveRound();
  if (!round) { location.hash = '#/home'; return; }

  const holeNumber = Number.parseInt(holeNumberParam, 10);
  const def = round.hole_defs.find((d) => d.hole_number === holeNumber);
  const green = db.getGreenForHole(round.course_id, holeNumber);

  // The pill that got here is gated on exactly this, so arriving without a
  // green means a stale link or a course deleted mid-round. Return rather
  // than render a map of nothing.
  if (!def || !green?.centroid) { location.hash = '#/course/round'; return; }

  // Published, from the selected tee's snapshot — never the live number
  // below it, and never reconciled against it (§14.6).
  const parts = [];
  if (def.par != null) parts.push(`Par ${def.par}`);
  if (def.yardage != null) parts.push(`${def.yardage} yd`);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Back</button>
        <span class="screen-title">Hole ${holeNumber}</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        ${parts.length ? `<div class="hole-map-published">${escapeHtml(parts.join(' • '))}</div>` : ''}

        <div class="card hole-map-readout" role="status" aria-live="polite">
          <div class="hole-map-primary">
            <span class="hole-map-distance" id="distanceValue">—</span>
            <span class="hole-map-distance-label" id="distanceLabel">to center</span>
          </div>
          <div class="hole-map-accuracy" id="accuracyLine">Locating…</div>
        </div>

        <div class="hole-map-edges" id="edgeChips" hidden></div>

        <p class="tiny muted hole-map-note">Live distance to the green from where you are standing. Published yardage above is measured from the tee.</p>
      </div>

      <button class="btn btn-primary btn-hero" id="doneBtn">${icon(ICON_PIN)}<span>Back to Scoring</span></button>
    </div>
  `;

  const distanceEl = qs('#distanceValue', root);
  const labelEl = qs('#distanceLabel', root);
  const accuracyEl = qs('#accuracyLine', root);
  const edgesEl = qs('#edgeChips', root);

  // The watch belongs to this screen and nothing else. §14.9 names the exit
  // paths that leak one; every one of them runs stop() below.
  let stop = () => {};
  let stopped = false;
  const teardown = () => {
    if (stopped) return;
    stopped = true;
    stop();
  };

  function showState(state) {
    const copy = STATE_COPY[state];
    if (!copy || state === POSITION_STATE.AVAILABLE) return;
    distanceEl.textContent = '—';
    labelEl.textContent = 'to center';
    accuracyEl.textContent = copy;
    edgesEl.hidden = true;
  }

  function showFix(fix) {
    const tier = accuracyTier(fix.accuracy_m);

    // §14.8: beyond the unusable threshold a number is suppressed entirely.
    // A wrong yardage is worse than no yardage.
    if (!yardagesUsable(fix)) {
      distanceEl.textContent = '—';
      labelEl.textContent = 'to center';
      accuracyEl.textContent = "Location isn't precise enough for yardages right now.";
      edgesEl.hidden = true;
      return;
    }

    const centre = yardsBetween({ lat: fix.lat, lon: fix.lon }, green.centroid);
    // The approximate marker is the "~" plus the accuracy line, never a
    // colour change (§14.10).
    distanceEl.textContent = `${tier === 'approximate' ? '~' : ''}${centre}`;
    labelEl.textContent = 'to center';
    accuracyEl.textContent = `± ${Math.round(metersToYards(fix.accuracy_m))} yd GPS accuracy`;

    // Front and back exist only where a polygon does. A captured single
    // point is centre-only and must never have them estimated (§14.7 B).
    const edges = green.polygon?.length >= 3
      ? greenEdgeYards({ lat: fix.lat, lon: fix.lon }, green.polygon, green.centroid)
      : null;
    if (!edges) { edgesEl.hidden = true; return; }
    edgesEl.hidden = false;
    edgesEl.innerHTML = `
      <span class="edge-chip" aria-label="Green front, ${edges.front} yards">
        <span class="edge-chip-value">${edges.front}</span><span class="edge-chip-label">Front</span>
      </span>
      <span class="edge-chip" aria-label="Green back, ${edges.back} yards">
        <span class="edge-chip-value">${edges.back}</span><span class="edge-chip-label">Back</span>
      </span>`;
  }

  stop = watchPosition({
    onFix: (fix) => { if (!stopped) showFix(fix); },
    onState: (state) => { if (!stopped) showState(state); },
  });

  const backToScoring = () => {
    teardown();
    location.hash = '#/course/round';
  };
  qs('#backBtn', root).addEventListener('click', backToScoring);
  qs('#doneBtn', root).addEventListener('click', backToScoring);

  // Any route change at all tears the watch down, including the ones that do
  // not pass through the buttons above — the browser back gesture, a deep
  // link, or the bottom nav if it is ever shown here (§14.9 calls that the
  // exit most likely to leak a watch).
  const onHashChange = () => {
    if (!location.hash.startsWith('#/course/map/')) {
      teardown();
      window.removeEventListener('hashchange', onHashChange);
    }
  };
  window.addEventListener('hashchange', onHashChange);
}
