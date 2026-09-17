import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast, commitOnce } from '../ui.js';
import { getPendingCourseId } from '../state.js';

// Edit Course Info — docs/course-mode-spec.md §14.2.
//
// Everything that used to sit on Round Setup lives here: course name, hole
// count and the par strip. Reference A shows no par editor on Course
// Details, and a returning golfer with remembered pars should not have to
// scroll past one — but §11.5's promise still holds, so a first-ever round
// at a course with nothing remembered opens this screen automatically.
//
// Pars are the one thing the app genuinely cannot source: §14.12.1 measured
// par present on 23 of 24 holes at one course and 2 of 18 at another, so a
// trace is a bonus that pre-fills this, never a replacement for it.

const PAR_CYCLE = [3, 4, 5];

export function renderCourseEdit(root) {
  const courseId = getPendingCourseId();
  const course = courseId ? db.getCourse(courseId) : null;
  if (!course) { location.hash = '#/course/select'; return; }

  let holeCount = course.hole_count === 18 ? 18 : 9;
  let name = course.name;
  // Resolved exactly as Course Details resolves them, so this screen opens
  // showing the pars the golfer just saw. Reading hole_defs directly would
  // show the template instead and silently discard a traced par the moment
  // they saved — Oakmont's par 27 became 35 that way.
  let pars = parsFor(courseId, holeCount);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Back</button>
        <span class="screen-title">Edit Course Info</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="field">
          <label for="courseNameInput">Course Name</label>
          <input type="text" id="courseNameInput" value="${escapeHtml(course.name)}" autocomplete="off" />
        </div>

        <div class="field">
          <label>Holes</label>
          <div class="choice-grid wrap-2" id="holeCountGrid">
            <div class="choice-btn ${holeCount === 9 ? 'selected' : ''}" data-holes="9" role="button" tabindex="0" aria-pressed="${holeCount === 9}">9</div>
            <div class="choice-btn ${holeCount === 18 ? 'selected' : ''}" data-holes="18" role="button" tabindex="0" aria-pressed="${holeCount === 18}">18</div>
          </div>
        </div>

        <div class="field">
          <label>Pars <span class="muted tiny">&mdash; tap to adjust</span></label>
          <div class="par-strip" id="parStrip"></div>
          <div class="tiny muted" id="parTotal"></div>
        </div>

        <p class="tiny muted">Yardages come from the tee you select on Course Details, where a course publishes them.</p>
      </div>

      <button class="btn btn-primary btn-hero" id="saveCourseBtn">Save</button>
    </div>
  `;

  const parStrip = qs('#parStrip', root);

  function renderPars() {
    parStrip.innerHTML = pars.map((par, i) => `
      <button class="par-cell" data-index="${i}" aria-label="Hole ${i + 1}, par ${par}. Tap to change.">
        <span class="par-cell-num">${i + 1}</span>
        <span class="par-cell-par">${par}</span>
      </button>`).join('');
    qs('#parTotal', root).textContent = `${holeCount} holes · par ${pars.reduce((a, b) => a + b, 0)}`;

    qsa('.par-cell', parStrip).forEach((cell) => {
      cell.addEventListener('click', () => {
        const i = Number(cell.dataset.index);
        // Tap cycles 3 -> 4 -> 5 (§4.3).
        const next = PAR_CYCLE[(PAR_CYCLE.indexOf(pars[i]) + 1) % PAR_CYCLE.length];
        pars[i] = next === undefined ? 4 : next;
        renderPars();
      });
    });
  }
  renderPars();

  qsa('#holeCountGrid .choice-btn', root).forEach((btn) => {
    const choose = () => {
      holeCount = Number(btn.dataset.holes);
      qsa('#holeCountGrid .choice-btn', root).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
      });
      pars = parsFor(courseId, holeCount);
      renderPars();
    };
    btn.addEventListener('click', choose);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
    });
  });

  qs('#courseNameInput', root).addEventListener('input', (e) => { name = e.target.value; });

  const back = () => { location.hash = '#/course/setup'; };
  qs('#backBtn', root).addEventListener('click', back);

  qs('#saveCourseBtn', root).addEventListener('click', commitOnce(() => {
    const trimmed = name.trim();
    if (!trimmed) { toast('A course needs a name'); return false; }

    // Remembered on the course, so the next round here is pre-filled and
    // the golfer simply taps Start Round (§4.3). Yardages already on the
    // course's own hole_defs are preserved — this screen edits par, and
    // dropping a known yardage would lose data the golfer never touched.
    const holeDefs = pars.map((par, i) => ({
      hole_number: i + 1,
      par,
      yardage: course.hole_defs?.find((d) => d.hole_number === i + 1)?.yardage ?? null,
    }));
    // setCoursePars, not upsertCourse: it records that these pars are the
    // golfer's, which is what stops a traced par from pre-filling over them
    // on the next visit (§14.7).
    db.setCoursePars(course.course_id, {
      name: trimmed,
      hole_count: holeCount,
      hole_defs: holeDefs,
    });
    back();
  }));
}

function parsFor(courseId, holeCount) {
  return db.resolveHoleDefs(courseId, { holeCount }).map((d) => d.par);
}
