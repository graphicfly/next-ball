import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import {
  CONTACTS, CONTACT_LABELS, PROX_LABELS, MISS_DEPTH, MISS_LATERAL, MISS_LABELS,
  LIE_LABELS, SURFACE_LABELS, chippingDrill, isHoled, isInside6, pct,
} from '../practice.js';
import { proximityTargetHtml, binaryTargetHtml, puttsStepHtml, progressHeadHtml } from './practiceCanvas.js';
import { openRepEditor } from './practiceEdit.js';

// Chipping — one screen, one tap.
//
// The old flow asked Contact, then Proximity, then an optional miss, then
// Next Ball: four interactions for an ordinary chip. Practice does not work
// like that. The golfer hits, glances down, taps where it finished, and hits
// again.
//
// So everything lives on one canvas and the PROXIMITY TAP IS THE COMMIT.
// Contact defaults to Solid and the optional miss axes are armed BEFORE the
// result rather than asked about after it:
//
//   ordinary chip              tap a ring                        1 tap
//   thin chip                  tap Thin, tap a ring              2 taps
//   with a noted miss          tap Short, tap a ring             2 taps
//
// Nothing is ever asked twice, and nothing between balls exists purely to
// show the golfer what they just entered — that is what the summary is for.

const FEEDBACK_MS = 220;

export function renderChippingSession(root, sessionId) {
  const session = db.getPracticeSession(sessionId);
  if (!session || session.mode !== 'chipping') { location.hash = '#/practice'; return; }
  const drill = chippingDrill(session.practice_type);
  const model = drill.result_model;

  // Armed state for the ball in hand. Cleared on every commit, so the next
  // ball always starts from Solid with no miss noted.
  let contact = 'solid';
  let missDepth = null;
  let missLateral = null;
  // Up & Down holds the chip here between the proximity tap and the putts
  // tap; it is the only place a second interaction is justified.
  let awaitingPutts = null;
  // One commit per ball. A second tap inside the feedback window is the
  // same tap as far as the golfer is concerned, and must not write twice.
  let busy = false;

  function contextLine() {
    const s = session.setup || {};
    if (drill.variable) {
      return [s.club, s.surface ? SURFACE_LABELS[s.surface] : null, 'Variable practice'].filter(Boolean).join(' · ');
    }
    return [s.club, s.distance_yds != null ? `${s.distance_yds} yd` : null,
      s.lie ? LIE_LABELS[s.lie] : null, s.surface ? SURFACE_LABELS[s.surface] : null].filter(Boolean).join(' · ');
  }

  function targetHtml() {
    if (awaitingPutts) return puttsStepHtml();
    if (model === 'zone') return binaryTargetHtml({ value: 'hit', label: 'Hit' }, { value: 'missed', label: 'Missed' });
    return proximityTargetHtml();
  }

  function draw() {
    const chips = db.listChips(sessionId);
    root.innerHTML = `
      <div class="screen practice-screen">
        <div class="topbar">
          <button class="back" id="endBtn">Finish</button>
          <span class="screen-title">${escapeHtml(drill.name)}</span>
          <span class="side-space"></span>
        </div>
        <div class="practice-body">
          ${progressHeadHtml({ done: chips.length, target: session.target_ball_count, context: contextLine() })}
          <div class="practice-canvas" id="canvas">${targetHtml()}</div>
          <div class="practice-flash" id="flash" aria-live="polite"></div>
          ${awaitingPutts ? '' : `
            <div class="practice-controls" id="controls">
              <div class="practice-control-row" role="group" aria-label="Contact">
                ${CONTACTS.map((c) => `<button class="mini-toggle ${c === contact ? 'active' : ''}" data-contact="${c}">${escapeHtml(CONTACT_LABELS[c])}</button>`).join('')}
              </div>
              ${model === 'zone' ? '' : `
                <div class="practice-control-row optional" role="group" aria-label="Optional miss">
                  ${MISS_DEPTH.map((d) => `<button class="mini-toggle ${missDepth === d ? 'active' : ''}" data-axis="miss_depth" data-value="${d}">${escapeHtml(MISS_LABELS[d])}</button>`).join('')}
                  ${MISS_LATERAL.map((d) => `<button class="mini-toggle ${missLateral === d ? 'active' : ''}" data-axis="miss_lateral" data-value="${d}">${escapeHtml(MISS_LABELS[d])}</button>`).join('')}
                </div>`}
            </div>`}
          <div class="practice-footer">
            <button class="practice-secondary" id="undoBtn" ${chips.length ? '' : 'disabled'}>Undo</button>
            <button class="practice-secondary" id="editBtn" ${chips.length ? '' : 'disabled'}>Edit previous</button>
          </div>
        </div>
      </div>`;
    wire();
  }

  // Updates only what changed. A full re-render between balls would rebuild
  // the SVG and re-read storage for something the golfer perceives as
  // instantaneous, so the ready state is restored in place instead.
  function refreshCount() {
    const done = db.listChips(sessionId).length;
    const el = qs('.practice-count-done', root);
    if (el) el.textContent = String(done);
    qs('#undoBtn', root)?.removeAttribute('disabled');
    qs('#editBtn', root)?.removeAttribute('disabled');
  }

  function flash(text, tone = '') {
    const el = qs('#flash', root);
    if (!el) return;
    el.textContent = text;
    el.className = `practice-flash show ${tone}`;
    setTimeout(() => { if (el.isConnected) el.className = 'practice-flash'; }, 900);
  }

  function resetArmed() {
    contact = 'solid';
    missDepth = null;
    missLateral = null;
    qsa('.mini-toggle[data-contact]', root).forEach((b) => b.classList.toggle('active', b.dataset.contact === 'solid'));
    qsa('.mini-toggle[data-axis]', root).forEach((b) => b.classList.remove('active'));
  }

  // The one place a chip is written. Returns the record so the caller can
  // decide what feedback to show.
  function commit(fields) {
    const chip = db.addChip(sessionId, fields);
    if (!chip) { toast("Couldn't save that chip"); return null; }
    return chip;
  }

  function afterCommit(label, tone) {
    refreshCount();
    resetArmed();
    flash(label, tone);
    if (drill.variable) flash('Move to a new spot');
    // The lock is held for the feedback window, not released immediately.
    //
    // Releasing it synchronously guarded nothing: three taps in the same
    // tick each ran to completion and wrote three chips. A second tap
    // inside the flash is the same tap as far as the golfer is concerned —
    // and no one hits two chips a fifth of a second apart, so nothing real
    // is lost by making them wait for it.
    setTimeout(() => { busy = false; }, FEEDBACK_MS);
  }

  function wire() {
    qs('#endBtn', root).addEventListener('click', finish);

    qs('#undoBtn', root).addEventListener('click', () => {
      const removed = db.deleteLastChip(sessionId);
      if (!removed) return;
      awaitingPutts = null;
      draw();
      flash('Removed');
    });

    qs('#editBtn', root).addEventListener('click', () => {
      const chips = db.listChips(sessionId);
      const last = chips[chips.length - 1];
      if (!last) return;
      // Editing is a different mode from logging: it opens deliberately,
      // changes one record and never auto-advances.
      openRepEditor(root, { kind: 'chip', sessionId, record: last, onDone: () => draw() });
    });

    qsa('.mini-toggle[data-contact]', root).forEach((b) => {
      b.addEventListener('click', () => {
        contact = b.dataset.contact;
        qsa('.mini-toggle[data-contact]', root).forEach((x) => x.classList.toggle('active', x === b));
      });
    });

    // Armed until the primary result. Tapping again clears it, so a wrong
    // tap costs one tap to fix rather than an undo.
    qsa('.mini-toggle[data-axis]', root).forEach((b) => {
      b.addEventListener('click', () => {
        const axis = b.dataset.axis;
        const value = b.dataset.value;
        const current = axis === 'miss_depth' ? missDepth : missLateral;
        const next = current === value ? null : value;
        if (axis === 'miss_depth') missDepth = next; else missLateral = next;
        qsa(`.mini-toggle[data-axis="${axis}"]`, root).forEach((x) => x.classList.toggle('active', x.dataset.value === next));
      });
    });

    wireTarget();
  }

  function wireTarget() {
    // Up & Down's putts step.
    qsa('[data-putts]', root).forEach((b) => {
      b.addEventListener('click', () => {
        if (busy || !awaitingPutts) return;
        busy = true;
        const putts = Number(b.dataset.putts);
        commit({ ...awaitingPutts, putts });
        awaitingPutts = null;
        draw();
        afterCommit(putts === 1 ? 'Up and down' : 'Logged');
      });
    });

    // Landing Zone.
    qsa('[data-choice]', root).forEach((b) => {
      b.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        const hit = b.dataset.choice === 'hit';
        const chip = commit({ zone_hit: hit, contact });
        if (!chip) { busy = false; return; }
        pulse(b);
        afterCommit(hit ? 'Hit' : 'Missed', hit ? 'good' : '');
      });
    });

    // The proximity rings — the commit for ordinary chipping.
    qsa('.prox-zone', root).forEach((zone) => {
      zone.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        const bucket = zone.dataset.bucket;
        const fields = { contact, prox_bucket: bucket, miss_depth: missDepth, miss_lateral: missLateral };

        if (model === 'up_and_down') {
          if (isHoled(bucket)) {
            // A holed chip is finished. No putt question, putts = 0, and
            // the result derives itself (practice-spec.md §12).
            commit({ ...fields, putts: 0 });
            pulseZone(zone);
            afterCommit('HOLED OUT', 'good');
            return;
          }
          awaitingPutts = fields;
          draw();
          busy = false;
          return;
        }

        const chip = commit(fields);
        if (!chip) { busy = false; return; }
        pulseZone(zone);
        afterCommit(isHoled(bucket) ? 'HOLED' : PROX_LABELS[bucket], isHoled(bucket) ? 'good' : '');
      });
    });
    // An SVG circle is not a button, so it takes no keyboard activation of
    // its own. The rings are the primary interaction of the whole screen and
    // must not be mouse-only.
    qsa('.prox-zone', root).forEach((zone) => {
      zone.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        zone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    });
    // Labels sit above the rings, so a tap on the text must count as a tap
    // on its band rather than doing nothing.
    qsa('.prox-label', root).forEach((label) => {
      label.addEventListener('click', () => {
        qs(`.prox-zone[data-bucket="${label.dataset.bucket}"]`, root)?.dispatchEvent(new Event('click'));
      });
    });
  }

  // Restrained, and never blocking: the class is removed on a timer and the
  // next tap is accepted the moment the commit returns.
  function pulseZone(zone) {
    zone.classList.add('hit');
    setTimeout(() => zone.classList.remove('hit'), FEEDBACK_MS);
  }
  function pulse(el) {
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), FEEDBACK_MS);
  }

  function finish() {
    const chips = db.listChips(sessionId);
    if (!chips.length) {
      db.deletePracticeSession(sessionId);
      location.hash = '#/practice';
      return;
    }
    db.finishPracticeSession(sessionId);
    location.hash = `#/practice/summary/${sessionId}`;
  }

  draw();
}
