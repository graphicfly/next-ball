import * as db from '../db.js';
import { qs, qsa, fmtDate, cap, metricRowHtml, statusBadgeHtml, emptyStateHtml, toast, trapSheetFocus, escapeHtml } from '../ui.js';
import { sessionSummary, clubSummaryLabel } from '../stats.js';
import { downloadSessionCSV } from '../export.js';

const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

// A brief, real Undo window after a History delete — holds the exact
// {session, shots} deleteSession() returned so restoreSession() can put
// them back verbatim if tapped in time. Module-scope (not a closure inside
// renderHistory) so it survives the re-render a delete triggers; cleared
// whenever a new delete happens (single-slot, not a stack) or the window
// lapses. See db.js's deleteSession/restoreSession for the persistence side.
let pendingUndo = null; // { session, shots }
let pendingUndoTimer = null;

function clearPendingUndo() {
  clearTimeout(pendingUndoTimer);
  pendingUndoTimer = null;
  pendingUndo = null;
}

export function renderHistory(root) {
  const sessions = db.listSessions();

  const cardsHtml = sessions.length ? sessions.map((session) => {
    const shots = db.getShotsForSession(session.session_id);
    const s = sessionSummary(shots);
    const club = clubSummaryLabel(shots, session.default_club);
    const isFinished = session.status === 'finished';
    const badge = !isFinished ? statusBadgeHtml(cap(session.status), 'warning') : '';
    const testBadge = isFinished && db.sessionDataSource(session) === 'test' ? '<span class="status-badge neutral test-badge">TEST</span>' : '';
    return `
      <div class="session-card" data-id="${session.session_id}" data-status="${session.status}">
        <div class="row1">
          <div class="date">${fmtDate(session.date)} ${badge}${testBadge}</div>
          <div class="row1-right">
            <div class="balls">${shots.length} balls &bull; ${club}</div>
            ${isFinished ? `<button class="icon-btn session-menu-btn" data-menu-id="${session.session_id}" aria-label="Session options">${ICON_DOTS}</button>` : ''}
          </div>
        </div>
        ${metricRowHtml([
          { value: s.strike.solid.pct + '%', label: 'Solid' },
          { value: s.direction.straight.pct + '%', label: 'Straight' },
          { value: s.distance.medianSolid != null ? s.distance.medianSolid + ' yd' : '—', label: 'Median Solid' },
        ], 'md')}
        ${(() => {
          const { primary } = db.sessionLocationDisplay(session);
          if (!primary && session.temperature_f == null) return '';
          return `<div class="foot-line"><span>${primary ? escapeHtml(primary) : ''}</span><span>${session.temperature_f != null ? session.temperature_f + '&deg;F' : ''}</span></div>`;
        })()}
      </div>`;
  }).join('') : emptyStateHtml({
    icon: 'history',
    title: 'No sessions yet',
    body: 'Every round you log will show up here, ready to compare and revisit.',
    actionLabel: 'Start Range Session',
    actionId: 'emptyStartBtn',
  });

  const undoHtml = pendingUndo ? `
    <div class="delete-undo-toast" id="deleteUndoToast" role="status">
      <span>Session deleted</span>
      <button id="undoDeleteBtn">Undo</button>
    </div>` : '';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">History</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">${cardsHtml}</div>
      ${undoHtml}
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#emptyStartBtn', root)?.addEventListener('click', () => { location.hash = '#/start'; });

  qsa('.session-card', root).forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const status = card.dataset.status;
      location.hash = status === 'finished' ? `#/history/${id}` : '#/active';
    });
  });

  qsa('.session-menu-btn', root).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = db.getSession(btn.dataset.menuId);
      if (session) openSessionMenuSheet(session, root);
    });
  });

  qs('#undoDeleteBtn', root)?.addEventListener('click', () => {
    if (!pendingUndo) return;
    const { session, shots } = pendingUndo;
    clearPendingUndo();
    const restored = db.restoreSession(session, shots);
    if (!restored) toast('Could not undo — please check History');
    renderHistory(root);
  });
}

function openSessionMenuSheet(session, root) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sessionMenuTitle">
      <h2 id="sessionMenuTitle">${fmtDate(session.date)}</h2>
      <div class="stack">
        <button class="btn" id="menuViewBtn">View Session</button>
        <button class="btn" id="menuExportBtn">Export Session</button>
        <button class="btn btn-danger" id="menuDeleteBtn" aria-label="Delete this session permanently">Delete Session</button>
        <button class="btn btn-outline" id="menuCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#menuCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#menuCancelBtn', backdrop).addEventListener('click', close);
  qs('#menuViewBtn', backdrop).addEventListener('click', () => {
    close();
    location.hash = `#/history/${session.session_id}`;
  });
  qs('#menuExportBtn', backdrop).addEventListener('click', () => {
    close();
    downloadSessionCSV(session.session_id);
  });
  qs('#menuDeleteBtn', backdrop).addEventListener('click', () => {
    close();
    openDeleteConfirmSheet(session, root, () => renderHistory(root));
  });
}

// Shared by History (returns to History, shows Undo) and Session Details
// (returns to History, no Undo — see historyDetail.js). `onDeleted` is
// called only after a confirmed, successful deletion.
export function openDeleteConfirmSheet(session, root, onDeleted) {
  const shots = db.getShotsForSession(session.session_id);
  const club = clubSummaryLabel(shots, session.default_club);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle" aria-describedby="deleteConfirmBody">
      <h2 id="deleteConfirmTitle">Delete this session?</h2>
      <p id="deleteConfirmBody" class="tiny muted" style="margin-bottom:var(--space-4);">
        ${escapeHtml(fmtDate(session.date))} &bull; ${escapeHtml(club || '')} &bull; ${shots.length} shot${shots.length === 1 ? '' : 's'}<br/>
        This will permanently remove this session and all shots recorded in it.
      </p>
      <div class="stack">
        <button class="btn btn-outline" id="deleteCancelBtn">Cancel</button>
        <button class="btn btn-danger" id="deleteConfirmBtn" aria-label="Permanently delete this session">Delete Session</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#deleteCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#deleteCancelBtn', backdrop).addEventListener('click', close);

  qs('#deleteConfirmBtn', backdrop).addEventListener('click', () => {
    let result;
    try {
      result = db.deleteSession(session.session_id);
    } catch (err) {
      close();
      toast('Unable to delete session. Please try again.');
      return;
    }
    if (!result) {
      close();
      toast('Unable to delete session. Please try again.');
      return;
    }
    close();
    clearPendingUndo();
    pendingUndo = { session: result.session, shots: result.shots };
    pendingUndoTimer = setTimeout(() => {
      // Guard against clobbering whatever screen is showing by the time this
      // fires — root is the single shared #app element reused by every
      // screen, and the user may well have navigated away within 5s.
      pendingUndo = null;
      if (location.hash === '#/history') renderHistory(root);
    }, 5000);
    onDeleted();
  });
}
