import * as db from '../db.js';
import { qs, qsa, fmtDate, escapeHtml, toast, trapSheetFocus, presentSheet } from '../ui.js';

// Lesson Summary — docs/lesson-spec.md §2, §3, §4.5.
//
// The one screen where all of a lesson's cues are shown at once. Home shows
// only the primary cue on purpose (§3); seeing all three is a deliberate act
// that costs one tap, and this is where it happens.
//
// Three exits, all equal (§4.5): set the focus, build a practice plan, or
// simply leave. The focus is the product; the plan is optional structure
// around it — so nothing here nags for a plan.

const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

export function renderLessonSummary(root, lessonId) {
  const lesson = db.getLesson(lessonId);
  if (!lesson) { location.hash = '#/history'; return; }

  const focus = db.getActiveSwingFocus();
  const focusHere = focus && focus.lesson_id === lesson.lesson_id ? focus.cue_order : null;

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; History</button>
        <span class="screen-title">Lesson</span>
        <button class="icon-btn" id="lessonMenuBtn" aria-label="Lesson options">${ICON_DOTS}</button>
      </div>

      <div class="scroll">
        <div class="lesson-head">
          <div class="lesson-head-date">${escapeHtml(fmtDate(lesson.date))}</div>
          ${lesson.instructor_name ? `<div class="lesson-head-sub">with ${escapeHtml(lesson.instructor_name)}</div>` : ''}
        </div>

        <div class="section-eyebrow">Cues</div>
        <div class="lesson-cues">
          ${!lesson.cues.length ? '<p class="tiny muted">This lesson has no cues. Tap Edit to add one.</p>' : ''}
          ${lesson.cues.map((cue) => `
            <div class="lesson-cue ${focusHere === cue.order ? 'is-focus' : ''}">
              <div class="lesson-cue-text">${escapeHtml(cue.text)}</div>
              ${focusHere === cue.order
                ? '<div class="lesson-cue-flag">Current focus</div>'
                : `<button class="lesson-cue-set" data-cue="${cue.order}">Use as Current Focus</button>`}
            </div>`).join('')}
        </div>

        ${lesson.drills.length ? `
          <div class="section-eyebrow">Drills</div>
          <div class="lesson-list">
            ${lesson.drills.map((d) => `<div class="lesson-list-row"><span class="lesson-list-num">${d.order}</span><span>${escapeHtml(d.text)}</span></div>`).join('')}
          </div>` : ''}

        ${lesson.notes ? `
          <div class="section-eyebrow">Notes</div>
          <div class="lesson-notes">${escapeHtml(lesson.notes)}</div>` : ''}
      </div>

      <div class="hole-actions">
        <button class="btn btn-outline" id="editLessonBtn">Edit</button>
        ${lesson.cues.length ? '<button class="btn btn-primary" id="planBtn">Practice This</button>' : ''}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/history'; });
  qs('#editLessonBtn', root).addEventListener('click', () => { location.hash = `#/lesson/edit/${lesson.lesson_id}`; });

  qsa('.lesson-cue-set', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      db.setActiveSwingFocus(lesson.lesson_id, Number(btn.dataset.cue));
      toast('Current focus set');
      renderLessonSummary(root, lessonId);
    });
  });

  qs('#planBtn', root)?.addEventListener('click', () => {
    // Setting the focus is the point of the action; the plan screen is
    // where the optional structure is built (§4.5). Doing both from one tap
    // keeps the common path — "this is what I'm working on now" — to a
    // single decision.
    if (!focusHere) db.setActiveSwingFocus(lesson.lesson_id, 1);
    location.hash = `#/lesson/plan/${lesson.lesson_id}`;
  });

  qs('#lessonMenuBtn', root).addEventListener('click', () => openLessonMenuSheet(lesson, root));
}

function openLessonMenuSheet(lesson, root) {
  const isFocus = db.getActiveSwingFocus()?.lesson_id === lesson.lesson_id;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lessonMenuTitle">
      <h2 id="lessonMenuTitle">${escapeHtml(fmtDate(lesson.date))}</h2>
      <div class="stack">
        <button class="btn" id="lessonMenuEditBtn">Edit Lesson</button>
        ${isFocus ? '<button class="btn" id="lessonMenuClearBtn">Clear Current Focus</button>' : ''}
        <button class="btn btn-danger" id="lessonMenuDeleteBtn" aria-label="Delete this lesson permanently">Delete Lesson</button>
        <button class="btn btn-outline" id="lessonMenuCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#lessonMenuCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#lessonMenuCancelBtn', backdrop).addEventListener('click', close);
  qs('#lessonMenuEditBtn', backdrop).addEventListener('click', () => {
    close();
    location.hash = `#/lesson/edit/${lesson.lesson_id}`;
  });
  qs('#lessonMenuClearBtn', backdrop)?.addEventListener('click', () => {
    close();
    // Clearing the focus deliberately leaves the lesson alone (§11.2) —
    // the golfer is putting down a swing thought, not deleting a record.
    db.clearActiveSwingFocus();
    toast('Current focus cleared');
    renderLessonSummary(root, lesson.lesson_id);
  });
  qs('#lessonMenuDeleteBtn', backdrop).addEventListener('click', () => {
    close();
    openLessonDeleteConfirmSheet(lesson, (result) => {
      // Back to History, which owns lessons (§5A) and holds the single Undo
      // slot for every kind of delete.
      setPendingLessonUndo(result);
      location.hash = '#/history';
    });
  });
}

// Shared by Lesson Summary (returns to History, which holds the Undo) and
// by History's own row menu (stays put, shows Undo immediately) — the same
// arrangement openDeleteConfirmSheet has for sessions. `onDeleted` is called
// only after a confirmed, successful deletion, with what was removed.
export function openLessonDeleteConfirmSheet(lesson, onDeleted) {
  const plan = db.getPlanForLesson(lesson.lesson_id);
  const isFocus = db.getActiveSwingFocus()?.lesson_id === lesson.lesson_id;

  // What is actually lost is named before the delete, not after: the lesson
  // and anything that cannot outlive it. Past range sessions are NOT in
  // that list — they hold their own snapshot and stay truthful (§5.2), so
  // promising otherwise here would be a lie in the opposite direction.
  const alsoLost = [plan ? 'the practice plan it produced' : null, isFocus ? 'your current focus' : null].filter(Boolean);
  const alsoLostText = alsoLost.length === 2 ? `${alsoLost[0]}, and ${alsoLost[1]}` : alsoLost[0];

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lessonDeleteTitle" aria-describedby="lessonDeleteBody">
      <h2 id="lessonDeleteTitle">Delete this lesson?</h2>
      <p id="lessonDeleteBody" class="tiny muted" style="margin-bottom:var(--space-4);">
        ${escapeHtml(fmtDate(lesson.date))}${lesson.instructor_name ? ` &bull; ${escapeHtml(lesson.instructor_name)}` : ''}<br/>
        This will permanently remove this lesson${alsoLost.length ? `, ${alsoLostText}` : ''}.
        Range sessions you practised under it keep the cue they were played with.
      </p>
      <div class="stack">
        <button class="btn btn-outline" id="lessonDeleteCancelBtn">Cancel</button>
        <button class="btn btn-danger" id="lessonDeleteConfirmBtn" aria-label="Permanently delete this lesson">Delete Lesson</button>
      </div>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#lessonDeleteCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#lessonDeleteCancelBtn', backdrop).addEventListener('click', close);
  qs('#lessonDeleteConfirmBtn', backdrop).addEventListener('click', () => {
    let result;
    try {
      result = db.deleteLesson(lesson.lesson_id);
    } catch (err) {
      close();
      toast('Unable to delete lesson. Please try again.');
      return;
    }
    close();
    if (!result) { toast('Unable to delete lesson. Please try again.'); return; }
    onDeleted(result);
  });
}

// The Undo slot lives in History (one slot, all three kinds), so a delete
// made from this screen hands it over rather than keeping its own.
let handoff = null;
function setPendingLessonUndo(result) { handoff = result; }
export function takePendingLessonUndo() {
  const r = handoff;
  handoff = null;
  return r;
}
