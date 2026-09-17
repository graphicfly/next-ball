import * as db from '../db.js';
import { qs, qsa, fmtDate, cap, metricRowHtml, statusBadgeHtml, emptyStateHtml, toast, trapSheetFocus, escapeHtml, presentSheet } from '../ui.js';
import { sessionSummary, clubSummaryLabel } from '../stats.js';
import { roundTotals, formatToPar } from '../roundAnalysis.js';
import { downloadSessionCSV } from '../export.js';
import { takePendingLessonUndo } from './lessonSummary.js';

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
          <button class="icon-btn session-menu-btn" data-menu-id="${session.session_id}" aria-label="Session options">${ICON_DOTS}</button>
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
          <button class="icon-btn round-menu-btn" data-menu-id="${round.round_id}" aria-label="Round options">${ICON_DOTS}</button>
        </div>
      </div>
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
      <div class="foot-line"><span>Course round${cityState ? ` &bull; ${escapeHtml(cityState)}` : ''}</span><span></span></div>
    </div>`;
}

// A lesson in History (§5A.1). Same card shell as a session and a round,
// distinguished by its own left edge and by naming its type in the metadata
// line rather than in an eyebrow above it — which is where the extra
// density came from, since it takes a line off every row of every type.
//
// The primary cue is the row's headline, because that is what a golfer is
// scanning for: not "a lesson happened", but which one said the thing they
// are trying to remember.
function lessonCardHtml(lesson, activeFocus) {
  const isFocus = activeFocus && activeFocus.lesson_id === lesson.lesson_id;
  const primary = lesson.cues[0]?.text || '';
  const extra = lesson.cues.length - 1;
  return `
    <div class="session-card lesson-card" data-lesson-id="${lesson.lesson_id}">
      <div class="row1">
        <div class="date">${fmtDate(lesson.date)}</div>
        <div class="row1-right">
          <div class="balls">${lesson.cues.length} cue${lesson.cues.length === 1 ? '' : 's'}</div>
          <button class="icon-btn lesson-menu-btn" data-menu-id="${lesson.lesson_id}" aria-label="Lesson options">${ICON_DOTS}</button>
        </div>
      </div>
      <div class="lesson-card-cue">${escapeHtml(primary)}</div>
      <div class="foot-line">
        <span>Lesson${lesson.instructor_name ? ` &bull; ${escapeHtml(lesson.instructor_name)}` : ''}${extra > 0 ? ` &bull; +${extra} more` : ''}</span>
        <span>${isFocus ? 'Current focus' : ''}</span>
      </div>
    </div>`;
}

// §5A.2: a single chip row, deferred twice — once for rounds and once for
// lessons — and earning its place at three entity types. It costs one line
// in total, where a type eyebrow cost one line per row.
//
// Module-scope so the choice survives the re-render a delete triggers, and
// deliberately NOT persisted: a filter is a momentary act of looking for
// something, and a golfer returning tomorrow expects to see everything.
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'session', label: 'Range' },
  { id: 'round', label: 'Rounds' },
  { id: 'lesson', label: 'Lessons' },
];
let activeFilter = 'all';

export function renderHistory(root) {
  // A delete performed from the Lesson Summary hands its Undo over here,
  // since History owns the single Undo slot for all three kinds.
  const handedOff = takePendingLessonUndo();
  if (handedOff) {
    clearPendingUndo();
    pendingUndo = { kind: 'lesson', lesson: handedOff.lesson, plans: handedOff.plans, focus: handedOff.focus };
    pendingUndoTimer = setTimeout(() => {
      pendingUndo = null;
      if (location.hash === '#/history') renderHistory(root);
    }, 5000);
  }

  // One combined, date-ordered list built from the existing stores —
  // nothing is duplicated into a History-specific record (§11.9). Sessions,
  // rounds and lessons keep their own ids and their own storage; this only
  // merges them for display.
  const activeFocus = db.getActiveSwingFocus();
  const all = [
    ...db.listSessions().map((s) => ({ kind: 'session', on: s.date || '', at: s.created_at || '', record: s })),
    ...db.listRounds().map((r) => ({ kind: 'round', on: r.date || '', at: r.created_at || '', record: r })),
    ...db.listLessons().map((l) => ({ kind: 'lesson', on: l.date || '', at: l.created_at || '', record: l })),
    // Ordered by the day the activity happened, then by when it was
    // recorded. Sessions and rounds are always created on their own date,
    // so their order is unchanged — but a lesson typed up a week later
    // belongs on the day it happened, not at the top of the list.
  ].sort((a, b) => b.on.localeCompare(a.on) || b.at.localeCompare(a.at));

  const entries = activeFilter === 'all' ? all : all.filter((e) => e.kind === activeFilter);

  // The chip row is shown once there is more than one kind of thing to
  // separate. With only range sessions logged it would be a control that
  // does nothing, which §1.4 rules out.
  const kinds = new Set(all.map((e) => e.kind));
  const filtersHtml = kinds.size > 1 ? `
    <div class="history-filters" role="group" aria-label="Filter history">
      ${FILTERS.map((f) => `<button class="filter-chip ${activeFilter === f.id ? 'selected' : ''}" data-filter="${f.id}" aria-pressed="${activeFilter === f.id}">${f.label}</button>`).join('')}
    </div>` : '';

  const cardsHtml = entries.length
    ? entries.map((e) => {
      if (e.kind === 'session') return sessionCardHtml(e.record);
      if (e.kind === 'round') return roundCardHtml(e.record);
      return lessonCardHtml(e.record, activeFocus);
    }).join('')
    : all.length
      // Filtered to nothing is not the same as having nothing — the empty
      // state's call to start a session would be the wrong offer here.
      ? `<p class="tiny muted" style="text-align:center;padding:var(--space-6) 0;">Nothing here yet.</p>`
      : emptyStateHtml({
      icon: 'history',
      title: 'Nothing logged yet',
      // "Round" meant a bucket of balls when this copy was written. Course
      // Mode gave the word a second meaning, so it is avoided here and both
      // kinds of activity are named instead.
      body: 'Range sessions and course rounds both show up here, ready to compare and revisit.',
      actionLabel: 'Start Range Session',
      actionId: 'emptyStartBtn',
    });

  const undoHtml = pendingUndo ? `
    <div class="delete-undo-toast" id="deleteUndoToast" role="status">
      <span>${{ round: 'Round', lesson: 'Lesson' }[pendingUndo.kind] || 'Session'} deleted</span>
      <button id="undoDeleteBtn">Undo</button>
    </div>` : '';

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">History</span>
        <button class="topbar-action" id="addLessonBtn">+ Lesson</button>
      </div>
      ${filtersHtml}
      <div class="scroll">${cardsHtml}</div>
      ${undoHtml}
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#emptyStartBtn', root)?.addEventListener('click', () => { location.hash = '#/start'; });
  qs('#addLessonBtn', root).addEventListener('click', () => { location.hash = '#/lesson/new'; });

  qsa('.filter-chip', root).forEach((chip) => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      renderHistory(root);
    });
  });

  qsa('.lesson-card', root).forEach((card) => {
    card.addEventListener('click', () => { location.hash = `#/lesson/${card.dataset.lessonId}`; });
  });

  qsa('.lesson-menu-btn', root).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.hash = `#/lesson/${btn.dataset.menuId}`;
    });
  });

  // Round and lesson cards share .session-card for its shell styling, so
  // both must be excluded here or they would pick up the session handler
  // too and navigate to a session id they do not have.
  qsa('.session-card:not(.round-card):not(.lesson-card)', root).forEach((card) => {
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
      : undo.kind === 'lesson'
        ? db.restoreLesson(undo.lesson, undo.plans, undo.focus)
        : db.restoreSession(undo.session, undo.shots, undo.goal, undo.plans);
    if (!restored) toast('Could not undo — please check History');
    renderHistory(root);
  });
}

function openSessionMenuSheet(session, root) {
  // An unfinished session gets the menu too. It used to be withheld until a
  // session was finished, which left any session that never got finished —
  // including one started by accident — with no delete affordance anywhere
  // in the app. Viewing and exporting stay behind a finished session, since
  // neither has anything to show for one still in progress.
  const isFinished = session.status === 'finished';
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sessionMenuTitle">
      <h2 id="sessionMenuTitle">${fmtDate(session.date)}</h2>
      <div class="stack">
        ${isFinished ? `
          <button class="btn" id="menuViewBtn">View Session</button>
          <button class="btn" id="menuExportBtn">Export Session</button>` : `
          <button class="btn" id="menuResumeBtn">Resume Session</button>`}
        <button class="btn btn-danger" id="menuDeleteBtn" aria-label="Delete this session permanently">Delete Session</button>
        <button class="btn btn-outline" id="menuCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#menuCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#menuCancelBtn', backdrop).addEventListener('click', close);
  qs('#menuViewBtn', backdrop)?.addEventListener('click', () => {
    close();
    location.hash = `#/history/${session.session_id}`;
  });
  qs('#menuExportBtn', backdrop)?.addEventListener('click', () => {
    close();
    downloadSessionCSV(session.session_id);
  });
  qs('#menuResumeBtn', backdrop)?.addEventListener('click', () => {
    close();
    location.hash = '#/active';
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
  if (!presentSheet(backdrop)) return;
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
      result = db.deleteSession(session.session_id, { allowInProgress: true });
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
    pendingUndo = { kind: 'session', session: result.session, shots: result.shots, goal: result.goal, plans: result.plans };
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
        ${round.status === 'finished'
          ? '<button class="btn" id="roundMenuViewBtn">View Round</button>'
          : '<button class="btn" id="roundMenuResumeBtn">Resume Round</button>'}
        <button class="btn btn-danger" id="roundMenuDeleteBtn" aria-label="Delete this round permanently">Delete Round</button>
        <button class="btn btn-outline" id="roundMenuCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#roundMenuCancelBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#roundMenuCancelBtn', backdrop).addEventListener('click', close);
  qs('#roundMenuViewBtn', backdrop)?.addEventListener('click', () => {
    close();
    location.hash = `#/course/summary/${round.round_id}`;
  });
  qs('#roundMenuResumeBtn', backdrop)?.addEventListener('click', () => {
    close();
    location.hash = '#/course/round';
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
  if (!presentSheet(backdrop)) return;
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
      result = db.deleteRound(round.round_id, { allowInProgress: true });
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
    pendingUndo = { kind: 'round', round: result.round, holes: result.holes, plan: result.plans ?? result.plan };
    pendingUndoTimer = setTimeout(() => {
      pendingUndo = null;
      if (location.hash === '#/history') renderHistory(root);
    }, 5000);
    renderHistory(root);
  });
}
