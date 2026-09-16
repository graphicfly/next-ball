import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import { getPendingCourseId, clearPendingCourse } from '../state.js';

// Round Setup — docs/course-mode-spec.md §4.3. One brief screen between
// course selection and the first hole, and it must not feel like a form.
//
// It exists because Reference C displays "Par 3 • 127 yd", and no source
// reliably provides per-hole par (§11.5). Capturing it here means the score
// stepper can open at par on every hole (§4.4), which is most of what makes
// hole entry a one-tap operation.
//
// Pars are remembered per course after the first round there, so a
// returning golfer sees this pre-filled and simply taps Start Round.

const PAR_CYCLE = [3, 4, 5];

export function renderCourseSetup(root) {
  const courseId = getPendingCourseId();
  const course = courseId ? db.getCourse(courseId) : null;
  if (!course) { location.hash = '#/course/select'; return; }

  // Defaults to the course's remembered value, else 9 (§4.3).
  let holeCount = course.hole_count === 18 ? 18 : 9;
  // Remembered pars when this course has been played before; the standard
  // template otherwise. Either way it is immediately playable without edits.
  let pars = parsFor(course, holeCount);

  const cityState = course.city && course.state
    ? `${course.city}, ${course.state}`
    : course.city || course.state || '';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Back</button>
        <span class="screen-title">Round Setup</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="setup-course-line">
          <div class="setup-course-name">${escapeHtml(course.name)}</div>
          ${cityState ? `<div class="tiny muted">${escapeHtml(cityState)}</div>` : ''}
        </div>

        <div class="field">
          <label>Holes</label>
          <div class="choice-grid wrap-2" id="holeCountGrid">
            <div class="choice-btn ${holeCount === 9 ? 'selected' : ''}" data-holes="9">9</div>
            <div class="choice-btn ${holeCount === 18 ? 'selected' : ''}" data-holes="18">18</div>
          </div>
        </div>

        <div class="field">
          <label>Pars <span class="muted tiny">&mdash; tap to adjust</span></label>
          <div class="par-strip" id="parStrip"></div>
          <div class="tiny muted" id="parTotal"></div>
        </div>
      </div>

      <button class="btn btn-primary btn-hero" id="startRoundBtn">Start Round</button>
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
    btn.addEventListener('click', () => {
      holeCount = Number(btn.dataset.holes);
      qsa('#holeCountGrid .choice-btn', root).forEach((b) => b.classList.toggle('selected', b === btn));
      pars = parsFor(course, holeCount);
      renderPars();
    });
  });

  qs('#backBtn', root).addEventListener('click', () => {
    clearPendingCourse();
    location.hash = '#/course/select';
  });

  qs('#startRoundBtn', root).addEventListener('click', () => {
    const holeDefs = pars.map((par, i) => ({
      hole_number: i + 1,
      par,
      // Yardage is never captured here (§4.3) — it comes from the course's
      // own definitions where a source provided it, and stays unknown
      // otherwise so display can omit it rather than render "— yd".
      yardage: course.hole_defs?.find((d) => d.hole_number === i + 1)?.yardage ?? null,
    }));

    const round = db.createRound({
      course_id: course.course_id,
      course_name: course.name,
      course_city: course.city,
      course_state: course.state,
      course_place_id: course.place_id,
      course_source: course.source,
      latitude: course.latitude,
      longitude: course.longitude,
      hole_count: holeCount,
      hole_defs: holeDefs,
    });
    if (!round) { toast('Could not start the round'); return; }

    // Remember this course's hole count and pars for next time (§4.3).
    db.recordCoursePlayed(course.course_id, { hole_count: holeCount, hole_defs: holeDefs });
    clearPendingCourse();
    location.hash = '#/course/round';
  });
}

function parsFor(course, holeCount) {
  const defs = db.defaultHoleDefs(holeCount);
  return defs.map((d) => course.hole_defs?.find((c) => c.hole_number === d.hole_number)?.par ?? d.par);
}
