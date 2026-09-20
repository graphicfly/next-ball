import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import {
  CONTACTS, CONTACT_LABELS, PROX_BUCKETS, PROX_LABELS,
  MISS_DEPTH, MISS_LATERAL, MISS_LABELS, LIE_LABELS, SURFACE_LABELS,
  chippingDrill, isHoled, isInside6, pct,
} from '../practice.js';

// Chipping — logging.
//
// One screen, four result models (practice-spec.md §18), optimised for
// logging a ball in under two seconds and getting straight back to ready.
//
//   standard      contact -> proximity -> optional miss
//   zone          hit/missed -> optional proximity
//   around_green  same as standard, but the situation is not collected (§13)
//   up_and_down   contact -> proximity -> putts, result derived (§12)
//
// The optional miss row appears ON THE SAME SCREEN, after the chip is
// already written (§9). It is an addendum, never a second mandatory step,
// and skipping it writes nothing.

const STEP = { CONTACT: 'contact', PROX: 'prox', ZONE: 'zone', PUTTS: 'putts', DONE: 'done' };

export function renderChippingSession(root, sessionId) {
  const session = db.getPracticeSession(sessionId);
  if (!session || session.mode !== 'chipping') { location.hash = '#/practice'; return; }
  const drill = chippingDrill(session.practice_type);
  const model = drill.result_model;

  // What has been chosen for the ball in hand. Cleared the moment it lands.
  let pending = {};
  let step = model === 'zone' ? STEP.ZONE : STEP.CONTACT;
  let lastChip = null;

  function setupLine() {
    const s = session.setup || {};
    if (drill.variable) {
      // §13: a variable-practice session has no single situation to show,
      // and inventing one on screen would be the first step toward
      // inventing one in the data.
      return [s.club, s.surface ? SURFACE_LABELS[s.surface] : null, 'Variable practice'].filter(Boolean).join(' · ');
    }
    return [
      s.club,
      s.distance_yds != null ? `${s.distance_yds} yd` : null,
      s.lie ? LIE_LABELS[s.lie] : null,
      s.surface ? SURFACE_LABELS[s.surface] : null,
    ].filter(Boolean).join(' · ');
  }

  function tally() {
    const chips = db.listChips(sessionId);
    const done = chips.length;
    if (!done) return '';
    const in6 = chips.filter((c) => isInside6(c.prox_bucket)).length;
    if (model === 'zone') {
      const hit = chips.filter((c) => c.zone_hit === true).length;
      return `${done} chip${done === 1 ? '' : 's'} · ${hit} hit`;
    }
    return `${done} chip${done === 1 ? '' : 's'} · ${pct(in6, done)}% inside 6 ft`;
  }

  function draw() {
    const chips = db.listChips(sessionId);
    root.innerHTML = `
      <div class="screen">
        <div class="topbar">
          <button class="back" id="endBtn">Finish</button>
          <span class="screen-title">${escapeHtml(drill.name)}</span>
          <button class="back" id="undoBtn" ${chips.length ? '' : 'disabled'}>Undo</button>
        </div>
        <div class="scroll practice-log">
          <div class="practice-context-line">${escapeHtml(setupLine())}</div>
          ${session.focus_snapshot ? `<div class="practice-focus"><span class="practice-focus-label">Focus</span><span class="practice-focus-text">${escapeHtml(session.focus_snapshot.cue_text)}</span></div>` : ''}
          <div class="practice-tally">${escapeHtml(tally())}</div>
          ${drill.variable && step === STEP.CONTACT && chips.length ? '<p class="practice-move tiny">Move to a new spot.</p>' : ''}
          <div id="stepArea"></div>
        </div>
      </div>`;

    qs('#endBtn', root).addEventListener('click', finish);
    qs('#undoBtn', root).addEventListener('click', () => {
      const removed = db.deleteLastChip(sessionId);
      if (!removed) return;
      toast('Chip removed');
      pending = {}; lastChip = null;
      step = model === 'zone' ? STEP.ZONE : STEP.CONTACT;
      draw();
    });

    drawStep();
  }

  function bigRow(title, options, onPick, { skip = null } = {}) {
    const area = qs('#stepArea', root);
    area.innerHTML = `
      <div class="practice-question">${escapeHtml(title)}</div>
      <div class="practice-options">
        ${options.map((o) => `<button class="practice-option ${o.tone || ''}" data-v="${escapeHtml(String(o.value))}">${escapeHtml(o.label)}</button>`).join('')}
      </div>
      ${skip ? `<button class="practice-skip" id="skipBtn">${escapeHtml(skip)}</button>` : ''}`;
    qsa('.practice-option', area).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.v)));
    if (skip) qs('#skipBtn', area).addEventListener('click', () => onPick(null));
  }

  function drawStep() {
    if (step === STEP.CONTACT) {
      bigRow('Contact', CONTACTS.map((c) => ({ value: c, label: CONTACT_LABELS[c] })), (v) => {
        if (!v) return;
        pending.contact = v;
        step = STEP.PROX; drawStep();
      });
      return;
    }

    if (step === STEP.ZONE) {
      bigRow('Did it land in the zone?', [
        { value: 'hit', label: 'Hit', tone: 'good' },
        { value: 'missed', label: 'Missed' },
      ], (v) => {
        if (!v) return;
        // §11: the drill is about EXECUTION. Proximity is offered
        // afterwards, quietly, and never required.
        lastChip = db.addChip(sessionId, { zone_hit: v === 'hit' });
        pending = {};
        step = STEP.DONE; draw();
      });
      return;
    }

    if (step === STEP.PROX) {
      bigRow('How close?', PROX_BUCKETS.map((b) => ({ value: b, label: PROX_LABELS[b], tone: b === 'holed' ? 'good' : '' })), (v) => {
        if (!v) return;
        pending.prox_bucket = v;
        if (model === 'up_and_down') {
          // §12: a holed chip skips the putt question entirely, stores
          // putts = 0, and counts as successful. The golfer is never asked
          // to confirm it.
          if (isHoled(v)) {
            lastChip = db.addChip(sessionId, { ...pending, putts: 0 });
            pending = {};
            step = STEP.DONE;
            draw();
            toast('Holed out');
            return;
          }
          step = STEP.PUTTS; drawStep(); return;
        }
        lastChip = db.addChip(sessionId, { ...pending });
        pending = {};
        step = STEP.DONE; draw();
      });
      return;
    }

    if (step === STEP.PUTTS) {
      bigRow('Putts to hole out', [
        { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3+' },
      ], (v) => {
        if (!v) return;
        lastChip = db.addChip(sessionId, { ...pending, putts: Number(v) });
        pending = {};
        step = STEP.DONE; draw();
      });
      return;
    }

    // DONE — the chip is written. What follows is an optional addendum.
    drawAddendum();
  }

  function drawAddendum() {
    const area = qs('#stepArea', root);
    const holed = lastChip && isHoled(lastChip.prox_bucket);
    const zoneOnly = model === 'zone';

    area.innerHTML = `
      <div class="practice-logged">${holed ? 'HOLED OUT' : 'Logged'}</div>
      ${zoneOnly ? `
        <button class="practice-skip" id="addProxBtn">Add proximity</button>
      ` : (holed ? '' : `
        <div class="practice-optional">
          <div class="practice-optional-label">Where did it finish? <span class="tiny muted">optional</span></div>
          <div class="practice-options small" id="depthRow">
            ${MISS_DEPTH.map((d) => `<button class="practice-option small ${lastChip?.miss_depth === d ? 'selected' : ''}" data-axis="miss_depth" data-v="${d}">${MISS_LABELS[d]}</button>`).join('')}
          </div>
          <div class="practice-options small" id="lateralRow">
            ${MISS_LATERAL.map((d) => `<button class="practice-option small ${lastChip?.miss_lateral === d ? 'selected' : ''}" data-axis="miss_lateral" data-v="${d}">${MISS_LABELS[d]}</button>`).join('')}
          </div>
        </div>
      `)}
      <button class="btn btn-primary btn-hero" id="nextBtn">Next ball</button>`;

    // Two independent axes (§9). Tapping one does not require the other, and
    // tapping again clears it — a wrong tap must be fixable without an undo.
    qsa('.practice-option[data-axis]', area).forEach((b) => {
      b.addEventListener('click', () => {
        if (!lastChip) return;
        const axis = b.dataset.axis;
        const value = lastChip[axis] === b.dataset.v ? null : b.dataset.v;
        db.updateChip(sessionId, lastChip.chip_id, { [axis]: value });
        lastChip[axis] = value;
        qsa(`.practice-option[data-axis="${axis}"]`, area).forEach((x) => {
          x.classList.toggle('selected', x.dataset.v === value);
        });
      });
    });

    qs('#addProxBtn', area)?.addEventListener('click', () => {
      bigRow('How close?', PROX_BUCKETS.map((b) => ({ value: b, label: PROX_LABELS[b] })), (v) => {
        if (v && lastChip) { db.updateChip(sessionId, lastChip.chip_id, { prox_bucket: v }); lastChip.prox_bucket = v; }
        step = STEP.DONE; draw();
      }, { skip: 'Skip' });
    });

    qs('#nextBtn', area).addEventListener('click', () => {
      lastChip = null;
      step = model === 'zone' ? STEP.ZONE : STEP.CONTACT;
      draw();
    });
  }

  function finish() {
    const chips = db.listChips(sessionId);
    if (!chips.length) {
      // An empty session is not history; it is a start that did not happen.
      db.deletePracticeSession(sessionId);
      location.hash = '#/practice';
      return;
    }
    db.finishPracticeSession(sessionId);
    location.hash = `#/practice/summary/${sessionId}`;
  }

  draw();
}
