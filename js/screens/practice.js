import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { MODES } from '../practice.js';
import { startRangeFlow } from './home.js';

// Practice — the select screen behind Home's Practice card.
//
// docs/practice-spec.md §1. Home holds exactly two choices and does not
// grow: Practice and Play a Round. Three modes on Home would make an
// overflow that lesson-spec.md §3.0 already recorded at 393x664 with a saved
// plan present. So the modes live one level down, where a list of three is
// the whole screen rather than the third thing on it.
//
// The mental model is Practice vs Play, and nothing else is added at that
// level.

const ICON_RANGE = '<path d="M12 3v11" /><circle cx="12" cy="18" r="3" /><path d="M12 3l6 3-6 3" />';
const ICON_CHIP = '<path d="M3 18h18" /><path d="M5 18c3-7 9-10 14-11" /><circle cx="18" cy="8" r="1.6" />';
const ICON_PUTT = '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" />';

function modeRow({ id, icon, title, sub, count }) {
  return `
    <button class="progress-row" id="${id}">
      <span class="progress-row-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </span>
      <span class="progress-row-text">
        <span class="progress-row-title">${escapeHtml(title)}</span>
        <span class="progress-row-sub">${escapeHtml(sub)}</span>
      </span>
      ${count ? `<span class="progress-row-count">${escapeHtml(count)}</span>` : ''}
      <svg class="progress-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
    </button>`;
}

export function renderPractice(root) {
  const chipping = db.listFinishedPracticeSessions({ mode: MODES.CHIPPING }).length;
  const putting = db.listFinishedPracticeSessions({ mode: MODES.PUTTING }).length;
  const focus = db.getActiveSwingFocus();

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Home</button>
        <span class="screen-title">Practice</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        ${focus ? `
          <div class="practice-focus">
            <span class="practice-focus-label">Current focus</span>
            <span class="practice-focus-text">${escapeHtml(focus.cue_text)}</span>
          </div>` : ''}

        ${modeRow({ id: 'rangeRow', icon: ICON_RANGE, title: 'Range', sub: 'Contact · Direction · Distance' })}
        ${modeRow({ id: 'chippingRow', icon: ICON_CHIP, title: 'Chipping', sub: 'Contact · Proximity', count: chipping ? String(chipping) : '' })}
        ${modeRow({ id: 'puttingRow', icon: ICON_PUTT, title: 'Putting', sub: 'Makes · Pace · Proximity', count: putting ? String(putting) : '' })}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  // Range is untouched. The whole decision Home's Range card used to make —
  // resume, round conflict, saved plan — moved here with it.
  qs('#rangeRow', root).addEventListener('click', () => { startRangeFlow(root); });
  qs('#chippingRow', root).addEventListener('click', () => { location.hash = '#/chipping/setup'; });
  qs('#puttingRow', root).addEventListener('click', () => { location.hash = '#/putting/select'; });
}
