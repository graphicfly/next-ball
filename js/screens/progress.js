import * as db from '../db.js';
import { qs, qsa, escapeHtml } from '../ui.js';
import { MODES } from '../practice.js';
import { shortGameOverview, puttingOverview } from '../practiceProgress.js';

// Progress — the V4.3 container for everything that answers "how am I
// getting on?".
//
// It replaces Trends in the global nav rather than adding a fifth tab.
// Three things now answer that question — Trends, Swing Lab and
// Development — and giving each a tab would put Swing Lab at the same
// standing as History for something used far less often (the same reasoning
// that kept Course Mode and Lessons out of the nav: `course-mode-spec.md`
// §2.8, `lesson-spec.md` §5A.3).
//
// Trends is NOT replaced or rewritten. It keeps its own route and its own
// screen; this only changes how it is reached.

const ICON_TRENDS = '<path d="M4 17l5-6 4 4 7-8" /><path d="M20 7h-4" /><path d="M20 7v4" />';
const ICON_SWING = '<rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" />';
const ICON_DEV = '<path d="M12 20V10" /><path d="M6 20v-5" /><path d="M18 20V5" />';
const ICON_SHORT = '<path d="M3 18h18" /><path d="M5 18c3-7 9-10 14-11" />';
const ICON_PUTTING = '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.4" />';

function rowHtml({ id, icon, title, sub, count, ready }) {
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
      ${ready ? '<span class="progress-row-dot" aria-hidden="true"></span>' : ''}
      <svg class="progress-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>
    </button>`;
}

export function renderProgress(root) {
  const sessions = db.listFinishedSessions().filter((s) => db.sessionDataSource(s) !== 'test');
  const videos = db.listSwingVideos();
  const analysable = videos.filter((v) => v.media_state !== 'missing').length;

  // Progress is organised by SKILL AREA (practice-spec.md §22): Full Swing,
  // Short Game, Putting, then the tools. Trends keeps its route and its
  // screen unchanged — it is Full Swing's destination, not a fifth thing.
  //
  // One headline number per skill, and empty is empty: a skill with no
  // practice behind it shows its invitation, never a zero.
  const practice = db.listFinishedPracticeSessions();
  const shortGame = shortGameOverview(practice, db.listChips);
  const putting = puttingOverview(practice, db.listPutts);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <span class="side-space"></span>
        <span class="screen-title">Progress</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="progress-group-label">SKILLS</div>
        ${rowHtml({
          id: 'trendsRow', icon: ICON_TRENDS, title: 'Full Swing',
          sub: sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} of range data` : 'Contact, direction and distance over time',
        })}
        ${rowHtml({
          id: 'shortGameRow', icon: ICON_SHORT, title: 'Short Game',
          sub: shortGame.headline
            ? `${shortGame.headline.value} ${shortGame.headline.label}`
            : 'Contact and proximity from around the green',
          count: shortGame.chips ? String(shortGame.chips) : '',
        })}
        ${rowHtml({
          id: 'puttingRow', icon: ICON_PUTTING, title: 'Putting',
          sub: putting.headline
            ? `${putting.headline.value} ${putting.headline.label}`
            : 'Makes, pace and proximity',
          count: putting.putts ? String(putting.putts) : '',
        })}
        <div class="progress-group-label">TOOLS</div>
        ${rowHtml({
          id: 'swingLabRow', icon: ICON_SWING, title: 'Swing Lab',
          sub: videos.length ? 'Recorded swings and analysis' : 'Record a swing from a range session',
          count: videos.length ? String(videos.length) : '',
          ready: analysable > 0,
        })}
        ${rowHtml({
          id: 'developmentRow', icon: ICON_DEV, title: 'Development',
          sub: 'Coming with V4.1',
        })}
      </div>
    </div>
  `;

  qs('#trendsRow', root).addEventListener('click', () => { location.hash = '#/trends'; });
  // Short Game and Putting have no detail screen of their own in V1. The row
  // carries the one headline number §22 allows, and tapping it goes where
  // the golfer can add to it rather than to an empty dashboard.
  qs('#shortGameRow', root).addEventListener('click', () => { location.hash = '#/chipping/setup'; });
  qs('#puttingRow', root).addEventListener('click', () => { location.hash = '#/putting/select'; });
  qs('#swingLabRow', root).addEventListener('click', () => { location.hash = '#/swing-lab'; });
  // Development depends on V4.1's confidence machinery, which is specified
  // and not built (`learning-spec.md`). It is shown so the shape of Progress
  // is honest about what is coming, and it does not pretend to open.
  qs('#developmentRow', root).setAttribute('disabled', '');
}
