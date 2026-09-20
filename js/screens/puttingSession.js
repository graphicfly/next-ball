import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import { PUTT_SURFACE_LABELS, puttModelFor, puttingDrill, pct } from '../practice.js';
import { puttTargetHtml, lagTargetHtml, binaryTargetHtml, progressHeadHtml } from './practiceCanvas.js';
import { openRepEditor } from './practiceEdit.js';

// Putting — one screen, one tap.
//
// A made putt is the common case and costs exactly one tap on the middle of
// the target. A directional miss costs one tap too, because the direction IS
// the target: tapping Left both records the miss and says which way it went.
// The old flow asked Made/Missed, then direction, then Next putt.
//
// Distance control keeps its matrix, which was already one tap, and loses
// the review state that followed it.

const FEEDBACK_MS = 220;

export function renderPuttingSession(root, sessionId) {
  const session = db.getPracticeSession(sessionId);
  if (!session || session.mode !== 'putting') { location.hash = '#/practice'; return; }
  const drill = puttingDrill(session.practice_type);
  const isStreak = drill.result_model === 'streak';
  const mixed = session.kind === 'mixed';

  let currentDistance = session.setup?.distance_ft ?? null;
  let busy = false;

  function streak() {
    const putts = db.listPutts(sessionId);
    let run = 0;
    for (let i = putts.length - 1; i >= 0; i--) { if (putts[i].result === 'made') run += 1; else break; }
    return { run, target: session.setup?.streak_target || 3 };
  }

  function contextLine() {
    const s = session.setup || {};
    return [
      mixed ? (currentDistance != null ? `${currentDistance} ft` : 'Mixed') : (currentDistance != null ? `${currentDistance} ft` : null),
      s.surface ? PUTT_SURFACE_LABELS[s.surface] : null,
    ].filter(Boolean).join(' · ');
  }

  function streakLine() {
    if (!isStreak) return null;
    const { run, target } = streak();
    const dots = Array.from({ length: target }, (_, i) => (i < run ? '●' : '○')).join(' ');
    return `${run} in a row   ${dots}`;
  }

  function targetHtml() {
    if (mixed && currentDistance == null) {
      return `
        <div class="binary-target putts-step">
          <div class="putts-step-label">How far is this one?</div>
          <div class="dist-grid">
            ${[3, 5, 8, 10, 15, 20, 30, 40].map((d) => `<button class="binary-cell compact" data-dist="${d}"><span>${d} ft</span></button>`).join('')}
          </div>
        </div>`;
    }
    if (isStreak) return binaryTargetHtml({ value: 'made', label: 'Made' }, { value: 'missed', label: 'Missed' });
    return puttModelFor(currentDistance) === 'short' ? puttTargetHtml() : lagTargetHtml();
  }

  function draw() {
    const putts = db.listPutts(sessionId);
    root.innerHTML = `
      <div class="screen practice-screen">
        <div class="topbar">
          <button class="back" id="endBtn">Finish</button>
          <span class="screen-title">${escapeHtml(drill.name)}</span>
          <span class="side-space"></span>
        </div>
        <div class="practice-body">
          ${progressHeadHtml({ done: putts.length, target: session.target_ball_count, context: contextLine(), streak: streakLine() })}
          <div class="practice-canvas" id="canvas">${targetHtml()}</div>
          <div class="practice-flash" id="flash" aria-live="polite"></div>
          <div class="practice-footer">
            <button class="practice-secondary" id="undoBtn" ${putts.length ? '' : 'disabled'}>Undo</button>
            <button class="practice-secondary" id="editBtn" ${putts.length ? '' : 'disabled'}>Edit previous</button>
          </div>
        </div>
      </div>`;
    wire();
  }

  function refreshCount() {
    const el = qs('.practice-count-done', root);
    if (el) el.textContent = String(db.listPutts(sessionId).length);
    qs('#undoBtn', root)?.removeAttribute('disabled');
    qs('#editBtn', root)?.removeAttribute('disabled');
    const s = qs('.practice-streak', root);
    if (s && isStreak) s.textContent = streakLine();
  }

  function flash(text, tone = '') {
    const el = qs('#flash', root);
    if (!el) return;
    el.textContent = text;
    el.className = `practice-flash show ${tone}`;
    setTimeout(() => { if (el.isConnected) el.className = 'practice-flash'; }, 900);
  }

  function pulse(el) {
    if (!el) return;
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), FEEDBACK_MS);
  }

  function commit(fields, el, label, tone) {
    const putt = db.addPutt(sessionId, { distance_ft: currentDistance, ...fields });
    if (!putt) { toast("Couldn't save that putt"); busy = false; return null; }
    pulse(el);
    // Mixed practice takes a new distance every ball, so the canvas has to
    // change; everything else restores in place.
    if (mixed) { currentDistance = null; draw(); } else { refreshCount(); }
    flash(label, tone);
    // Held for the feedback window. Releasing synchronously guards nothing —
    // rapid taps in one tick each run to completion and write a putt each.
    setTimeout(() => { busy = false; }, FEEDBACK_MS);
    return putt;
  }

  function wire() {
    qs('#endBtn', root).addEventListener('click', finish);

    qs('#undoBtn', root).addEventListener('click', () => {
      if (!db.deleteLastPutt(sessionId)) return;
      draw();
      flash('Removed');
    });

    qs('#editBtn', root).addEventListener('click', () => {
      const putts = db.listPutts(sessionId);
      const last = putts[putts.length - 1];
      if (!last) return;
      openRepEditor(root, { kind: 'putt', sessionId, record: last, onDone: () => draw() });
    });

    qsa('[data-dist]', root).forEach((b) => b.addEventListener('click', () => {
      currentDistance = Number(b.dataset.dist);
      draw();
    }));

    // Short putting: Made in the middle, each miss direction its own cell.
    // One tap either way.
    qsa('.putt-cell', root).forEach((cell) => {
      cell.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        if (cell.dataset.result === 'made') {
          commit({ result: 'made' }, cell, 'Made', 'good');
          return;
        }
        const axis = cell.dataset.axis;
        commit({ result: 'missed', [axis]: cell.dataset.value }, cell, `Missed ${cell.dataset.value}`);
      });
    });

    // Distance control: proximity and pace together, already one tap.
    qsa('.lag-cell', root).forEach((cell) => {
      cell.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        commit({ result: 'missed', leave_bucket: cell.dataset.bucket, leave_dir: cell.dataset.dir },
          cell, `${cell.dataset.dir === 'short' ? 'Short' : 'Past'}`);
      });
    });
    qs('.lag-holed', root)?.addEventListener('click', (e) => {
      if (busy) return;
      busy = true;
      // A holed lag is a make with no leave fields (practice-spec.md §17).
      commit({ result: 'made' }, e.currentTarget, 'Holed', 'good');
    });

    // Pressure Finish.
    qsa('[data-choice]', root).forEach((b) => {
      b.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        const made = b.dataset.choice === 'made';
        commit({ result: made ? 'made' : 'missed' }, b, made ? 'Made' : 'Streak reset', made ? 'good' : '');
      });
    });
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
