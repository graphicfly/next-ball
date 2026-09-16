import * as db from '../db.js';
import { qs, qsa, fmtDate, cap, metricRowHtml, statusBadgeHtml, emptyStateHtml, toast, trapSheetFocus, escapeHtml } from '../ui.js';
import { sessionSummary, clubSummaryLabel } from '../stats.js';
import { roundTotals, formatToPar } from '../roundAnalysis.js';
import { downloadSessionCSV } from '../export.js';

const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

// A brief, real Undo window after a History delete — holds exactly what
// deleteSession()/deleteRound() returned so it can be put back verbatim if
// tapped in time. Module-scope (not a closure inside renderHistory) so it
// survives the re-render a delete triggers; cleared whenever a new delete
// happens (single-slot, not a stack) or the window lapses. See db.js's
// delete/restore pairs for the persistence side.
//
// Carries its kind so one slot serves both: { kind: 'session' | 'round' }.
let pendingUndo = null;
let pendingUndoTimer = null;

function clearPendingUndo() {
  clearTimeout(pendingUndoTimer);
  pendingUndoTimer = null;
  pendingUndo = null;
}

// A range session card — unchanged in content and markup from before rounds
// existed, so the range half of History looks and behaves exactly as it
// always has.
function sessionCardHtml(session) {
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
        { value: Math.round(s.strike.solid.pct) + '%', label: 'Solid' },
        { value: Math.round(s.direction.straight.pct) + '%', label: 'Straight' },
        { value: s.distance.medianSolid != null ? s.distance.medianSolid + ' yd' : '—', label: 'Median Solid' },
      ], 'md')}
      ${(() => {
        const { primary } = db.sessionLocationDisplay(session);
        if (!primary && session.temperature_f == null) return '';
        return `<div class="foot-line"><span>${primary ? escapeHtml(primary) : ''}</span><span>${session.temperature_f != null ? session.temperature_f + '&deg;F' : ''}</span></div>`;
      })()}
    </div>`;
}

// A course round card. Visually distinct from a session card by an accent
// left edge and a COURSE ROUND eyebrow, so the two kinds of activity are
// never confused while sharing the same card language (§11.9).
//
// A round still in progress carries its status badge exactly as an
// unfinished session does, and never shows a score as though it were final.
function roundCardHtml(round) {
  const holes = db.getHolesForRound(round.round_id);
  const totals = roundTotals(holes);
  const isFinished = round.status === 'finished';
  const badge = !isFinished ? statusBadgeHtml(cap(round.status), 'warning') : '';
  const testBadge = isFinished && db.sessionDataSource(round) === 'test' ? '<span class="status-badge neutral test-badge">TEST</span>' : '';

  const cityState = round.course_city && round.course_state
    ? `${round.course_city}, ${round.course_state}`
    : round.course_city || round.course_state || '';

  return `
    <div class="session-card round-card" data-round-id="${round.round_id}" data-status="${round.status}">
      <div class="row1">
        <div class="date">${fmtDate(round.date)} ${badge}${testBadge}</div>
        <div class="row1-right">
          <div class="balls">${round.hole_count} holes</div>
          ${isFinished ? `<button class="icon-btn round-menu-btn" data-menu-id="${round.round_id}" aria-label="Round options">${ICON_DOTS}</button>` : ''}
        </div>
      </div>
      <div class="round-card-eyebrow">Course round</div>
      <div class="round-card-course">${escapeHtml(round.course_name || 'Course')}</div>
      ${isFinished
        ? metricRowHtml([
          { value: String(totals.strokes), label: 'Score' },
          // Score to par only when every hole played carries one — never
          // implied from a partial card.
          { value: totals.hasPar ? formatToPar(totals.toPar) : '—', label: 'To par' },
          { value: `${totals.holesPlayed}`, label: 'Holes played' },
        ], 'md')
        : `<div class="foot-line"><span>${totals.holesPlayed} of ${round.hole_count} holes played</span><span></span></div>`}
      ${cityState ? `<div class="foot-line"><span>${escapeHtml(cityState)}</span><span></span></div>` : ''}
    </div>`;
}

export function renderHistory(root) {
  // One combined, date-ordered list built from the two existing stores —
  // nothing is duplicated into a History-specific record (§11.9). Sessions
  // and rounds keep their own ids and their own storage; this only merges
  // them for display.
  const entries = [
    ...db.listSessions().map((s) => ({ kind: 'session', at: s.created_at || '', record: s })),
    ...db.listRounds().map((r) => ({ kind: 'round', at: r.created_at || '', record: r })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const cardsHtml = entries.length
    ? entries.map((e) => (e.kind === 'session' ? sessionCardHtml(e.record) : roundCardHtml(e.record))).join('')
    : emptyStateHtml({
      icon: 'history',
      title: 'No sessions yet',
      body: 'Every round you log will show up here, ready to compare and revisit.',
      actionLabel: 'Start Range Session',
      actionId: 'emptyStartBtn',
    });

  const undoHtml = pendingUndo ? `
    <div class="delete-undo-toast" id="deleteUndoToast" role="status">
      <span>${pendingUndo.kind === 'round' ? 'Round' : 'Session'} deleted</span>
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

  // Round cards share .session-card for its shell styling, so they must be
  // excluded here or they would pick up the session handler too and
  // navigate to a session id they do not have.
  qsa('.session-card:not(.round-card)', root).forEach((card) => {
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

  qsa('.round-card', root).forEach((card) => {
    card.addEventListener('click', () => {
      // A finished round opens its Round Summary, which is the way into
      // Explore Round; one still in progress resumes where it left off.
      const id = card.dataset.roundId;
      location.hash = card.dataset.status === 'finished' ? `#/course/summary/${id}` : '#/course/round';
    });
  });

  qsa('.round-menu-btn', root).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const round = db.getRound(btn.dataset.menuId);
      if (round) openRoundMenuSheet(round, root);
    });
  });

  qs('#undoDeleteBtn', root)?.addEventListener('click', () => {
    if (!pendingUndo) return;
    const undo = pendingUndo;
    clearPendingUndo();
    const restored = undo.kind === 'round'
      ? db.restoreRound(undo.round, undo.holes, undo.plan)
      : db.restoreSession(undo.session, undo.shots, undo.goal);
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
    pendingUndo = { kind: 'session', session: result.session, shots: result.shots, goal: result.goal };
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

// The round counterpart to openSessionMenuSheet. Deliberately two actions,
// not three: there is no round CSV export, because export.js is shot-shaped
// and a round has no shots — offering one would be a promise the data
// cannot keep.
function openRoundMenuSheet(round, root) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="roundMenuTitle">
      <h2 id="roundMenuTitle">${escapeHtml(round.course_name || 'Round')}</h2>
      <p class="tiny muted" style="margin-bottom:var(--space-3);">${fmtDate(round.date)}</p>
      <div class="stack">
        <button class="btn" id="roundMenuViewBtn">View Round</button>
        <button class="btn btn-danger" id="roundMenuDeleteBtn" aria-label="Delete this round permanently">Delete Round</button>
        <button class="btn btn-outline" id="roundMenuCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#roundMenuCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#roundMenuCancelBtn', backdrop).addEventListener('click', close);
  qs('#roundMenuViewBtn', backdrop).addEventListener('click', () => {
    close();
    location.hash = `#/course/summary/${round.round_id}`;
  });
  qs('#roundMenuDeleteBtn', backdrop).addEventListener('click', () => {
    close();
    openRoundDeleteConfirmSheet(round, root);
  });
}

// Mirrors the session delete confirmation, including the same brief Undo
// window. Deleting a round also removes its holes and the practice plan it
// produced (db.deleteRound) — and Undo puts all three back.
function openRoundDeleteConfirmSheet(round, root) {
  const holes = db.getHolesForRound(round.round_id);
  const plan = db.getPlanForRound(round.round_id);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="roundDeleteTitle" aria-describedby="roundDeleteBody">
      <h2 id="roundDeleteTitle">Delete this round?</h2>
      <p id="roundDeleteBody" class="tiny muted" style="margin-bottom:var(--space-4);">
        ${escapeHtml(fmtDate(round.date))} &bull; ${escapeHtml(round.course_name || 'Course')} &bull; ${holes.length} hole${holes.length === 1 ? '' : 's'}<br/>
        This will permanently remove this round${plan ? ' and the practice plan it produced' : ''}.
      </p>
      <div class="stack">
        <button class="btn btn-outline" id="roundDeleteCancelBtn">Cancel</button>
        <button class="btn btn-danger" id="roundDeleteConfirmBtn" aria-label="Permanently delete this round">Delete Round</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#roundDeleteCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#roundDeleteCancelBtn', backdrop).addEventListener('click', close);

  qs('#roundDeleteConfirmBtn', backdrop).addEventListener('click', () => {
    let result;
    try {
      result = db.deleteRound(round.round_id);
    } catch (err) {
      close();
      toast('Unable to delete round. Please try again.');
      return;
    }
    if (!result) {
      close();
      toast('Unable to delete round. Please try again.');
      return;
    }
    close();
    clearPendingUndo();
    pendingUndo = { kind: 'round', round: result.round, holes: result.holes, plan: result.plan };
    pendingUndoTimer = setTimeout(() => {
      pendingUndo = null;
      if (location.hash === '#/history') renderHistory(root);
    }, 5000);
    renderHistory(root);
  });
}
