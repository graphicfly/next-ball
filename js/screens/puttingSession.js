import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import {
  LEAVE_BUCKETS, LEAVE_LABELS, PACE, PACE_LABELS,
  MISS_LATERAL, MISS_DEPTH, MISS_LABELS, PUTT_SURFACE_LABELS,
  puttModelFor, puttingDrill, pct,
} from '../practice.js';

// Putting — logging.
//
// Two result models and deliberately no third (practice-spec.md §14.1):
//
//   <= 10 ft   Made / Missed, one tap, optional direction on a miss
//   >  10 ft   the one-tap matrix, capturing proximity AND pace together
//
// Mixed practice chooses between them per putt by the same threshold, which
// is why the threshold lives in practice.js rather than here.

export function renderPuttingSession(root, sessionId) {
  const session = db.getPracticeSession(sessionId);
  if (!session || session.mode !== 'putting') { location.hash = '#/practice'; return; }
  const drill = puttingDrill(session.practice_type);
  const isStreak = drill.result_model === 'streak';
  const mixed = session.kind === 'mixed';

  // Mixed sessions ask for the distance of the ball in hand; everything else
  // takes it from the session.
  let currentDistance = session.setup?.distance_ft ?? null;
  let lastPutt = null;
  let showingMiss = false;

  function streakState() {
    // Derived from the records, never stored — a streak that disagreed with
    // the putts behind it would be a second source of truth.
    const putts = db.listPutts(sessionId);
    let run = 0;
    for (let i = putts.length - 1; i >= 0; i--) {
      if (putts[i].result === 'made') run += 1; else break;
    }
    return { run, target: session.setup?.streak_target || 3, total: putts.length };
  }

  function headline() {
    const putts = db.listPutts(sessionId);
    if (!putts.length) return '';
    if (isStreak) {
      const { run, target } = streakState();
      const dots = Array.from({ length: target }, (_, i) => (i < run ? '●' : '○')).join(' ');
      return `${run} in a row · ${dots}`;
    }
    const made = putts.filter((p) => p.result === 'made').length;
    if (session.kind === 'distance') {
      const close = putts.filter((p) => p.result === 'made' || p.leave_bucket === 'in_3').length;
      return `${putts.length} putt${putts.length === 1 ? '' : 's'} · ${pct(close, putts.length)}% inside 3 ft`;
    }
    return `${made} / ${putts.length} made`;
  }

  function draw() {
    const putts = db.listPutts(sessionId);
    const s = session.setup || {};
    const context = [
      mixed ? 'Mixed' : (currentDistance != null ? `${currentDistance} ft` : null),
      s.surface ? PUTT_SURFACE_LABELS[s.surface] : null,
    ].filter(Boolean).join(' · ');

    root.innerHTML = `
      <div class="screen">
        <div class="topbar">
          <button class="back" id="endBtn">Finish</button>
          <span class="screen-title">${escapeHtml(drill.name)}</span>
          <button class="back" id="undoBtn" ${putts.length ? '' : 'disabled'}>Undo</button>
        </div>
        <div class="scroll practice-log">
          <div class="practice-context-line">${escapeHtml(context)}</div>
          ${session.focus_snapshot ? `<div class="practice-focus"><span class="practice-focus-label">Focus</span><span class="practice-focus-text">${escapeHtml(session.focus_snapshot.cue_text)}</span></div>` : ''}
          <div class="practice-tally">${escapeHtml(headline())}</div>
          <div id="stepArea"></div>
        </div>
      </div>`;

    qs('#endBtn', root).addEventListener('click', finish);
    qs('#undoBtn', root).addEventListener('click', () => {
      if (!db.deleteLastPutt(sessionId)) return;
      toast('Putt removed');
      lastPutt = null; showingMiss = false;
      draw();
    });

    drawStep();
  }

  function drawStep() {
    const area = qs('#stepArea', root);

    // Mixed practice needs to know the distance before it knows which
    // result model applies.
    if (mixed && currentDistance == null) {
      area.innerHTML = `
        <div class="practice-question">How far is this one?</div>
        <div class="practice-options">
          ${[3, 5, 8, 10, 15, 20, 30, 40].map((d) => `<button class="practice-option" data-d="${d}">${d} ft</button>`).join('')}
        </div>`;
      qsa('.practice-option', area).forEach((b) => b.addEventListener('click', () => {
        currentDistance = Number(b.dataset.d);
        draw();
      }));
      return;
    }

    if (showingMiss) { drawMissRow(); return; }

    const model = puttModelFor(currentDistance);

    if (model === 'short' || isStreak) {
      area.innerHTML = `
        <div class="practice-options big">
          <button class="practice-option good" data-r="made">Made</button>
          <button class="practice-option" data-r="missed">Missed</button>
        </div>`;
      qsa('.practice-option', area).forEach((b) => b.addEventListener('click', () => {
        const result = b.dataset.r;
        lastPutt = db.addPutt(sessionId, { result, distance_ft: currentDistance });
        if (isStreak && result === 'missed') toast('Streak reset');
        // A made putt is one tap and done (§15).
        if (result === 'made') { afterPutt(); return; }
        showingMiss = true;
        draw();
      }));
      return;
    }

    // §16: one tap on the matrix captures proximity AND pace together. This
    // must not be split into two mandatory questions — which is also why
    // distance-control patterns always have full coverage while short-putt
    // direction patterns have to be gated.
    area.innerHTML = `
      <div class="practice-question">Where did it finish?</div>
      <button class="practice-option good wide" data-holed="1">Holed</button>
      <div class="matrix">
        ${LEAVE_BUCKETS.map((b) => `
          <div class="matrix-row">
            <div class="matrix-label">${escapeHtml(LEAVE_LABELS[b])}</div>
            ${PACE.map((p) => `<button class="practice-option matrix-cell" data-b="${b}" data-p="${p}">${escapeHtml(PACE_LABELS[p])}</button>`).join('')}
          </div>`).join('')}
      </div>`;

    qs('.practice-option[data-holed]', area).addEventListener('click', () => {
      // A holed lag is a made putt with no leave fields (§17).
      lastPutt = db.addPutt(sessionId, { result: 'made', distance_ft: currentDistance });
      afterPutt();
    });
    qsa('.matrix-cell', area).forEach((b) => b.addEventListener('click', () => {
      lastPutt = db.addPutt(sessionId, {
        result: 'missed', distance_ft: currentDistance,
        leave_bucket: b.dataset.b, leave_dir: b.dataset.p,
      });
      afterPutt();
    }));
  }

  function drawMissRow() {
    const area = qs('#stepArea', root);
    // §9: short-putt miss order is Left · Right · Short · Long, because
    // start line is what matters at short range. Deliberately NOT the
    // chipping order, and not to be normalised for consistency.
    area.innerHTML = `
      <div class="practice-logged">Missed</div>
      <div class="practice-optional">
        <div class="practice-optional-label">Which way? <span class="tiny muted">optional</span></div>
        <div class="practice-options small">
          ${MISS_LATERAL.map((d) => `<button class="practice-option small" data-axis="miss_lateral" data-v="${d}">${MISS_LABELS[d]}</button>`).join('')}
          ${MISS_DEPTH.map((d) => `<button class="practice-option small" data-axis="miss_depth" data-v="${d}">${MISS_LABELS[d]}</button>`).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-hero" id="nextBtn">Next putt</button>`;

    qsa('.practice-option[data-axis]', area).forEach((b) => b.addEventListener('click', () => {
      if (!lastPutt) return;
      const axis = b.dataset.axis;
      const value = lastPutt[axis] === b.dataset.v ? null : b.dataset.v;
      db.updatePutt(sessionId, lastPutt.putt_id, { [axis]: value });
      lastPutt[axis] = value;
      qsa(`.practice-option[data-axis="${axis}"]`, area).forEach((x) => x.classList.toggle('selected', x.dataset.v === value));
    }));

    qs('#nextBtn', area).addEventListener('click', () => { afterPutt(); });
  }

  function afterPutt() {
    showingMiss = false;
    lastPutt = null;
    if (mixed) currentDistance = null;   // a new distance each time (§14)
    draw();
  }

  function finish() {
    if (!db.listPutts(sessionId).length) {
      db.deletePracticeSession(sessionId);
      location.hash = '#/practice';
      return;
    }
    db.finishPracticeSession(sessionId);
    location.hash = `#/practice/summary/${sessionId}`;
  }

  draw();
}
