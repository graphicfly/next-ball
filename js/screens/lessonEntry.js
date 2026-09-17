import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast, todayLocalDate, commitOnce } from '../ui.js';

// Add / Edit Lesson — docs/lesson-spec.md §2.
//
// The form's entire job is to get the instructor's words into storage
// unchanged and then get out of the way. §2.1: nothing is required except a
// date and one cue, and the form must make a one-cue lesson feel complete —
// so cue 2 and cue 3 are plainly optional, and nothing marks them missing.
//
// §2.2 governs every text field here: no auto-capitalisation, no correction,
// no expansion. `autocapitalize="off"` and `spellcheck="false"` are on the
// cue fields deliberately — iOS capitalising "stay over it" would be the
// app editing a coach's phrasing, which is exactly what the invariant
// forbids. Notes are ordinary prose, so they keep normal typing helpers.

const CUE_PLACEHOLDERS = [
  'e.g. Stay over it',
  'Optional',
  'Optional',
];

export function renderLessonEntry(root, lessonId = null) {
  const existing = lessonId ? db.getLesson(lessonId) : null;
  if (lessonId && !existing) { location.hash = '#/history'; return; }

  const isEdit = Boolean(existing);
  // The lesson date, not today's — someone typing this up on the drive home
  // is recording something that already happened (§2).
  let date = existing?.date || todayLocalDate();
  let instructor = existing?.instructor_name || '';
  const cues = [0, 1, 2].map((i) => existing?.cues?.[i]?.text || '');
  // Always one empty drill row to write in; more appear on demand. A lesson
  // with no drills is complete (§2.5), so nothing here asks for one.
  let drills = existing?.drills?.length ? existing.drills.map((d) => d.text) : [''];
  let notes = existing?.notes || '';

  const suggestions = db.recentInstructorNames();

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Back</button>
        <span class="screen-title">${isEdit ? 'Edit Lesson' : 'Add Lesson'}</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="field">
          <label for="lessonDateInput">Date</label>
          <input type="date" id="lessonDateInput" value="${escapeHtml(date)}" />
        </div>

        <div class="field">
          <label for="instructorInput">Instructor <span class="muted tiny">&mdash; optional</span></label>
          <input type="text" id="instructorInput" value="${escapeHtml(instructor)}" placeholder="Who taught this lesson" autocomplete="off" />
          ${suggestions.length ? `
            <div class="pick-row" id="instructorPicks">
              ${suggestions.map((n) => `<button class="pick-chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
            </div>` : ''}
        </div>

        <div class="field">
          <label for="cueInput0">Cues <span class="muted tiny">&mdash; in your instructor's words</span></label>
          <div class="stack-tight">
            ${cues.map((text, i) => `
              <input type="text" id="cueInput${i}" class="cue-input" data-index="${i}"
                     value="${escapeHtml(text)}" placeholder="${CUE_PLACEHOLDERS[i]}"
                     autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
                     aria-label="Cue ${i + 1}" />`).join('')}
          </div>
          <div class="tiny muted" style="margin-top:var(--space-2);">Three at most. Written exactly as you enter them.</div>
        </div>

        <div class="field">
          <label for="drillInput0">Drills <span class="muted tiny">&mdash; optional</span></label>
          <div class="stack-tight" id="drillRows"></div>
          <button class="link-btn" id="addDrillBtn" type="button">+ Add drill</button>
        </div>

        <div class="field">
          <label for="lessonNotesInput">Notes <span class="muted tiny">&mdash; optional</span></label>
          <textarea id="lessonNotesInput" placeholder="Anything else worth keeping from the lesson">${escapeHtml(notes)}</textarea>
        </div>
      </div>

      <button class="btn btn-primary btn-hero" id="saveLessonBtn">${isEdit ? 'Save Lesson' : 'Save Lesson'}</button>
    </div>
  `;

  const drillRows = qs('#drillRows', root);

  function renderDrills({ focusLast = false } = {}) {
    drillRows.innerHTML = drills.map((text, i) => `
      <input type="text" id="drillInput${i}" class="drill-input" data-index="${i}"
             value="${escapeHtml(text)}" placeholder="e.g. 10 half swings with the 9i"
             autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
             aria-label="Drill ${i + 1}" />`).join('');
    qsa('.drill-input', drillRows).forEach((input) => {
      input.addEventListener('input', (e) => { drills[Number(input.dataset.index)] = e.target.value; });
    });
    if (focusLast) drillRows.lastElementChild?.focus();
  }
  renderDrills();

  qs('#addDrillBtn', root).addEventListener('click', () => {
    drills.push('');
    renderDrills({ focusLast: true });
  });

  qs('#lessonDateInput', root).addEventListener('input', (e) => { date = e.target.value; });
  qs('#instructorInput', root).addEventListener('input', (e) => { instructor = e.target.value; });
  qs('#lessonNotesInput', root).addEventListener('input', (e) => { notes = e.target.value; });
  qsa('.cue-input', root).forEach((input) => {
    input.addEventListener('input', (e) => { cues[Number(input.dataset.index)] = e.target.value; });
  });

  qsa('#instructorPicks .pick-chip', root).forEach((chip) => {
    chip.addEventListener('click', () => {
      instructor = chip.dataset.name;
      qs('#instructorInput', root).value = instructor;
    });
  });

  const back = () => { location.hash = isEdit ? `#/lesson/${existing.lesson_id}` : '#/history'; };
  qs('#backBtn', root).addEventListener('click', back);

  qs('#saveLessonBtn', root).addEventListener('click', commitOnce(() => {
    // An empty cue 1 with cue 2 filled is still a valid lesson — db
    // renumbers, so the golfer is never told off for leaving a gap.
    const entered = cues.filter((t) => t.trim());
    if (!date) { toast('A lesson needs a date'); return false; }
    if (!entered.length) { toast('A lesson needs at least one cue'); return false; }

    const fields = { date, instructor_name: instructor, cues: entered, drills, notes };

    if (isEdit) {
      db.updateLesson(existing.lesson_id, fields);
      location.hash = `#/lesson/${existing.lesson_id}`;
      return;
    }
    const lesson = db.createLesson(fields);
    if (!lesson) { toast('Could not save this lesson'); return false; }
    location.hash = `#/lesson/${lesson.lesson_id}`;
  }));
}
