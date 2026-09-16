import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { getPendingCourseId, clearPendingCourse } from '../state.js';

// PLACEHOLDER — Round Setup proper is Phase 3 (docs/course-mode-spec.md
// §4.3: hole count, the editable par strip, and Start Round). This exists
// only so course selection has somewhere real to land instead of falling
// through the router back to Home, which would read as a bug. Phase 3
// replaces this file's contents entirely.

export function renderCourseSetup(root) {
  const courseId = getPendingCourseId();
  const course = courseId ? db.getCourse(courseId) : null;
  if (!course) { location.hash = '#/course/select'; return; }

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
        <div class="card" style="margin-top:var(--space-5);">
          <div class="card-eyebrow">Course selected</div>
          <div class="card-value">${escapeHtml(course.name)}</div>
          ${cityState ? `<div class="tiny muted" style="margin-top:2px;">${escapeHtml(cityState)}</div>` : ''}
          <div class="hairline" style="margin:var(--space-4) 0;"></div>
          <div class="tiny muted">${course.hole_count} holes &bull; par ${course.hole_defs.reduce((sum, d) => sum + (d.par || 0), 0)}</div>
        </div>
        <p class="tiny muted" style="margin-top:var(--space-5);">Round Setup — hole count, pars, and Start Round — arrives in the next step.</p>
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => {
    clearPendingCourse();
    location.hash = '#/course/select';
  });
}
