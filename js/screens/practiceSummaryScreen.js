import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { chippingSummary, puttingSummary } from '../practiceSummary.js';
import { LIE_LABELS, SURFACE_LABELS, PUTT_SURFACE_LABELS } from '../practice.js';

// Practice summary — one dominant result (practice-spec.md §22 rule 1).
//
// The Pattern block is ABSENT when the optional data behind it was not
// collected. Not empty, not caveated, not "no pattern yet" — absent (§10).

function statHtml(s) {
  return `<div class="practice-stat"><div class="practice-stat-value">${escapeHtml(s.value)}</div><div class="practice-stat-label">${escapeHtml(s.label)}</div></div>`;
}

export function renderPracticeSummary(root, sessionId) {
  const session = db.getPracticeSession(sessionId);
  if (!session) { location.hash = '#/practice'; return; }

  const putting = session.mode === 'putting';
  const reps = putting ? db.listPutts(sessionId) : db.listChips(sessionId);
  const sum = putting ? puttingSummary(session, reps) : chippingSummary(session, reps);
  const s = session.setup || {};

  const context = putting
    ? [s.distance_ft != null ? `${s.distance_ft} ft` : 'Mixed', s.surface ? PUTT_SURFACE_LABELS[s.surface] : null].filter(Boolean).join(' · ')
    : [s.club, s.distance_yds != null ? `${s.distance_yds} yd` : null, s.lie ? LIE_LABELS[s.lie] : null, s.surface ? SURFACE_LABELS[s.surface] : null].filter(Boolean).join(' · ');

  const title = putting ? 'Putting Session' : 'Chipping Session';
  const unit = putting ? 'putt' : 'chip';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <span class="side-space"></span>
        <span class="screen-title">Summary</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="practice-summary-head">
          <div class="practice-summary-title">${escapeHtml(title)}</div>
          <div class="practice-summary-sub">${sum.total} ${escapeHtml(unit)}${sum.total === 1 ? '' : 's'}${context ? ` &middot; ${escapeHtml(context)}` : ''}</div>
        </div>

        ${sum.headline ? `
          <div class="practice-headline">
            <div class="practice-headline-value">${escapeHtml(sum.headline.value)}</div>
            <div class="practice-headline-label">${escapeHtml(sum.headline.label)}</div>
          </div>` : ''}

        ${sum.pattern ? `
          <div class="practice-pattern">
            <div class="practice-pattern-label">PATTERN</div>
            <div class="practice-pattern-text">${escapeHtml(sum.pattern.text)}</div>
            <div class="practice-pattern-basis tiny muted">${escapeHtml(sum.pattern.basis)}</div>
          </div>` : ''}

        ${sum.supporting.length ? `<div class="practice-stats">${sum.supporting.map(statHtml).join('')}</div>` : ''}

        ${session.focus_snapshot ? `
          <div class="practice-focus">
            <span class="practice-focus-label">Practiced under</span>
            <span class="practice-focus-text">${escapeHtml(session.focus_snapshot.cue_text)}</span>
          </div>` : ''}

        <button class="btn btn-primary btn-hero" id="doneBtn">Done</button>
        <button class="capture-link practice-again" id="againBtn">Practice again</button>
      </div>
    </div>`;

  qs('#doneBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#againBtn', root).addEventListener('click', () => {
    location.hash = putting ? '#/putting/select' : '#/chipping/setup';
  });
}
