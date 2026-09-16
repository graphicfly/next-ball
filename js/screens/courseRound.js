import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast, trapSheetFocus, presentSheet } from '../ui.js';
import { getClubQuickPicks } from '../setupPersonalization.js';
import { openEndRoundSheet } from './home.js';

// Course Session / Hole Entry — docs/course-mode-spec.md §4.4, Reference C.
//
// The highest-traffic screen in the feature, and the only one with a hard
// time budget: 5-10 seconds per hole, one-handed, outdoors, often with a
// group waiting. Every decision here serves that.
//
// The budget is met by defaults, not by removing fields: the score opens at
// par, short game and putts open at 0, and clubs open empty — so a routine
// hole is a single tap on Save + Next Hole, and a bogey is one tap on `+`
// and one on Save.
//
// Nothing here is shot-by-shot. Clubs Used records only WHICH clubs
// appeared on the hole, unordered and uncounted (§7.4).

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_CLUB = '<path d="M16.5 3.5 9 15" /><ellipse cx="7.7" cy="16.8" rx="2.6" ry="1.7" transform="rotate(-25 7.7 16.8)" />';
const ICON_CHIP = '<path d="M4 18c3-5 7-7 11-8" /><path d="M15 9.5 19 10l-1.5 3.5" /><circle cx="5" cy="19" r="1.4" />';
const ICON_PUTT = '<path d="M12 4v11" /><ellipse cx="12" cy="18.5" rx="6" ry="2.2" /><circle cx="12" cy="15.4" r="2" />';
const ICON_MINUS = '<path d="M5.5 12h13" />';
const ICON_PLUS = '<path d="M12 5.5v13" /><path d="M5.5 12h13" />';

// Press-and-hold repeats after a short delay (§5.2). Long enough that a
// normal tap never triggers it, fast enough that reaching 7 is quick.
const HOLD_DELAY_MS = 450;
const HOLD_REPEAT_MS = 130;

// Reference C shows three quick picks plus More. The putter is deliberately
// absent: putts are counted in their own field, so offering it here would
// double-record and imply per-shot club tracking (§4.4).
const CLUB_QUICK_PICK_COUNT = 3;

function clubQuickPicks() {
  const picks = getClubQuickPicks().filter((c) => c !== 'Putter');
  // Backfill if filtering the putter (or thin history) left a short row, so
  // the row never collapses to one or two chips.
  for (const c of ['PW', '9i', '7i', 'GW', 'Driver']) {
    if (picks.length >= CLUB_QUICK_PICK_COUNT) break;
    if (!picks.includes(c)) picks.push(c);
  }
  return picks.slice(0, CLUB_QUICK_PICK_COUNT);
}

function stepperHtml({ id, value, min, size = 'sm', caption = '' }) {
  const atMin = value <= min;
  return `
    <div class="stepper ${size}" id="${id}">
      <button class="stepper-btn minus" data-dir="-1" ${atMin ? 'disabled' : ''} aria-label="Decrease">${icon(ICON_MINUS)}</button>
      <div class="stepper-value" role="spinbutton" aria-valuenow="${value}" aria-valuemin="${min}" tabindex="0">
        <span class="stepper-number">${value}</span>
        ${caption ? `<span class="stepper-caption">${caption}</span>` : ''}
      </div>
      <button class="stepper-btn plus" data-dir="1" aria-label="Increase">${icon(ICON_PLUS)}</button>
    </div>`;
}

export function renderCourseRound(root) {
  const round = db.getActiveRound();
  if (!round) { location.hash = '#/home'; return; }
  if (round.status === 'paused') db.resumeRound(round.round_id);

  const holes = db.getHolesForRound(round.round_id);
  const played = new Set(holes.map((h) => h.hole_number));

  // Resuming mid-round lands on the first unplayed hole, not back at hole 1
  // (§5.3) — and on the last hole once everything has been played.
  const current = firstUnplayed(round, played) ?? round.hole_count;
  renderHole(root, round.round_id, current);
}

function firstUnplayed(round, played, exclude = null) {
  for (let n = 1; n <= round.hole_count; n++) {
    if (n !== exclude && !played.has(n)) return n;
  }
  return null;
}

function renderHole(root, roundId, holeNumber) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/home'; return; }

  const stored = db.getHole(roundId, holeNumber);
  const def = round.hole_defs.find((d) => d.hole_number === holeNumber) || { par: null, yardage: null };

  // Working copy for this hole. A hole that has been played loads its saved
  // values (§5.5); an unplayed one opens at par with everything else at
  // zero, which is what makes the common hole a single tap.
  const draft = {
    strokes: stored?.strokes ?? def.par ?? 1,
    clubs_used: [...(stored?.clubs_used ?? [])],
    short_game_strokes: stored?.short_game_strokes ?? 0,
    putts: stored?.putts ?? 0,
  };

  const holes = db.getHolesForRound(roundId);
  const played = new Set(holes.map((h) => h.hole_number));
  // What the primary action will do once this hole is saved: go to the next
  // hole still unplayed, or finish when nothing is left (§5.5, §5.6).
  const nextHole = firstUnplayed(round, played, holeNumber);
  const isFinishing = nextHole === null;

  // Yardage and its separator are omitted when unknown — never "— yd" (§4.4).
  const parts = [];
  if (def.par != null) parts.push(`Par ${def.par}`);
  if (def.yardage != null) parts.push(`${def.yardage} yd`);

  root.innerHTML = `
    <div class="screen">
      <div class="course-hero compact">
        <img class="course-hero-img" src="graphics/active/range_backdrop.webp" alt="" />
        <div class="course-hero-scrim"></div>
        <div class="topbar course-hero-topbar">
          <button class="back" id="backBtn">&larr; Back</button>
          <button class="back" id="finishBtn">Finish</button>
        </div>
        <div class="course-hero-content">
          <h1 class="course-hero-title">Course Session</h1>
          <div class="course-hero-sub">Track your round, one hole at a time.</div>
        </div>
      </div>

      <div class="scroll">
        <div class="card hole-card">
          <div class="hole-identity">
            <div class="hole-number">Hole ${holeNumber} of ${round.hole_count}</div>
            ${parts.length ? `<div class="hole-meta">${parts.join(' &bull; ')}</div>` : ''}
          </div>

          ${stepperHtml({ id: 'scoreStepper', value: draft.strokes, min: 1, size: 'lg', caption: 'STROKES' })}

          <div class="hairline"></div>

          <div class="hole-row stacked">
            <span class="hole-row-label">${icon(ICON_CLUB)}<span>Clubs used</span></span>
            <div class="club-chips" id="clubChips" role="group" aria-label="Clubs used on this hole"></div>
          </div>

          <div class="hairline"></div>

          <div class="hole-row">
            <span class="hole-row-label">${icon(ICON_CHIP)}<span>Short Game</span></span>
            ${stepperHtml({ id: 'shortGameStepper', value: draft.short_game_strokes, min: 0 })}
          </div>

          <div class="hairline"></div>

          <div class="hole-row">
            <span class="hole-row-label">${icon(ICON_PUTT)}<span>Putts</span></span>
            ${stepperHtml({ id: 'puttsStepper', value: draft.putts, min: 0 })}
          </div>

          <div class="hole-hint" id="holeHint" role="status" hidden></div>

          <div class="hairline"></div>

          <div class="hole-strip-label">Holes</div>
          <div class="hole-strip" id="holeStrip"></div>
        </div>
      </div>

      <div class="hole-actions">
        <button class="btn btn-outline" id="prevHoleBtn" ${holeNumber === 1 ? 'disabled' : ''}>&lsaquo; Previous Hole</button>
        <button class="btn btn-primary" id="saveHoleBtn">${isFinishing ? 'Finish Round' : 'Save + Next Hole &rsaquo;'}</button>
      </div>
    </div>
  `;

  // ---------- Autosave ----------
  // Persisted on every value change, not only on Save + Next Hole (§4.4), so
  // a backgrounded app, a dead battery or a mid-round phone call never costs
  // a completed hole. A failed write is surfaced immediately rather than
  // swallowed — §8 names silent data loss the worst failure mode here.
  function persist() {
    const { saved } = db.upsertHole(roundId, holeNumber, {
      strokes: draft.strokes,
      clubs_used: draft.clubs_used,
      short_game_strokes: draft.short_game_strokes,
      putts: draft.putts,
    });
    if (!saved) toast('Could not save this hole — check device storage');
    return saved;
  }

  // Advisory only: short game + putts may legitimately exceed strokes and is
  // always stored as entered. This warns, it never blocks or corrects (§5.4).
  function refreshHint() {
    const hint = qs('#holeHint', root);
    const over = draft.short_game_strokes + draft.putts > draft.strokes;
    hint.hidden = !over;
    if (over) hint.textContent = "That's more than the strokes recorded";
  }

  function updateStepper(id, value, min) {
    const el = qs(`#${id}`, root);
    qs('.stepper-number', el).textContent = String(value);
    const valueEl = qs('.stepper-value', el);
    valueEl.setAttribute('aria-valuenow', String(value));
    // Disable at the bound rather than silently ignoring taps (§5.2).
    qs('.stepper-btn.minus', el).disabled = value <= min;
  }

  function bindStepper(id, { min, get, set }) {
    const el = qs(`#${id}`, root);
    const apply = (dir) => {
      const next = Math.max(min, get() + dir);
      if (next === get()) return false;
      set(next);
      updateStepper(id, next, min);
      refreshHint();
      persist();
      return true;
    };

    qsa('.stepper-btn', el).forEach((btn) => {
      const dir = Number(btn.dataset.dir);
      let holdTimer = null;
      let repeatTimer = null;
      const stop = () => {
        clearTimeout(holdTimer);
        clearInterval(repeatTimer);
        holdTimer = null;
        repeatTimer = null;
      };

      btn.addEventListener('click', () => apply(dir));
      // Press-and-hold repeats after a short delay (§5.2) — reaching 7 on a
      // blow-up hole shouldn't need seven taps.
      btn.addEventListener('pointerdown', () => {
        holdTimer = setTimeout(() => {
          repeatTimer = setInterval(() => { if (!apply(dir)) stop(); }, HOLD_REPEAT_MS);
        }, HOLD_DELAY_MS);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => btn.addEventListener(e, stop));
    });
  }

  bindStepper('scoreStepper', {
    min: 1,
    get: () => draft.strokes,
    set: (v) => { draft.strokes = v; },
  });
  bindStepper('shortGameStepper', {
    min: 0,
    get: () => draft.short_game_strokes,
    set: (v) => { draft.short_game_strokes = v; },
  });
  bindStepper('puttsStepper', {
    min: 0,
    get: () => draft.putts,
    set: (v) => { draft.putts = v; },
  });

  // ---------- Clubs used (multi-select) ----------
  function renderChips() {
    const chipsEl = qs('#clubChips', root);
    // Quick picks, plus any already-selected club that isn't among them, so
    // a club chosen through More stays visible as a chip.
    const picks = clubQuickPicks();
    const shown = [...picks, ...draft.clubs_used.filter((c) => !picks.includes(c))];
    chipsEl.innerHTML = `${shown.map((club) => `
      <button class="club-chip ${draft.clubs_used.includes(club) ? 'selected' : ''}"
              data-club="${escapeHtml(club)}"
              aria-pressed="${draft.clubs_used.includes(club)}">${escapeHtml(club)}</button>`).join('')}
      <button class="club-chip more" id="moreClubsBtn">More</button>`;

    qsa('.club-chip[data-club]', chipsEl).forEach((chip) => {
      chip.addEventListener('click', () => {
        const club = chip.dataset.club;
        // Multi-select: more than one club may be active on a hole, e.g.
        // 9i + PW (§4.4). Selecting none is valid and common.
        const i = draft.clubs_used.indexOf(club);
        if (i === -1) draft.clubs_used.push(club); else draft.clubs_used.splice(i, 1);
        renderChips();
        persist();
      });
    });
    qs('#moreClubsBtn', chipsEl).addEventListener('click', () => openClubPicker());
  }
  renderChips();

  // The app's existing club pickers are single-select by construction, so
  // this is the multi-select variant — same sheet and .choice-btn grid, so
  // it looks and behaves like every other picker in the app.
  function openClubPicker() {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="clubPickerTitle">
        <h2 id="clubPickerTitle">Clubs Used</h2>
        <p class="tiny muted" style="margin-bottom:var(--space-3);">Select every club you used on this hole.</p>
        <div class="choice-grid wrap-4" id="clubPickerGrid">
          ${db.CLUBS.filter((c) => c !== 'Putter').map((c) => `
            <div class="choice-btn ${draft.clubs_used.includes(c) ? 'selected' : ''}" data-club="${c}" role="button" aria-pressed="${draft.clubs_used.includes(c)}">${c}</div>`).join('')}
        </div>
        <button class="btn btn-primary" id="clubPickerDoneBtn" style="margin-top:var(--space-3);">Done</button>
      </div>
    `;
    if (!presentSheet(backdrop)) return;
    const untrap = trapSheetFocus(backdrop, close);

    function close() {
      untrap();
      backdrop.remove();
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    qsa('#clubPickerGrid .choice-btn', backdrop).forEach((btn) => {
      btn.addEventListener('click', () => {
        const club = btn.dataset.club;
        const i = draft.clubs_used.indexOf(club);
        if (i === -1) draft.clubs_used.push(club); else draft.clubs_used.splice(i, 1);
        btn.classList.toggle('selected', i === -1);
        btn.setAttribute('aria-pressed', String(i === -1));
      });
    });
    qs('#clubPickerDoneBtn', backdrop).addEventListener('click', () => {
      close();
      renderChips();
      persist();
    });
  }

  // ---------- Hole navigation ----------
  function renderStrip() {
    const stripEl = qs('#holeStrip', root);
    const playedNow = new Set(db.getHolesForRound(roundId).map((h) => h.hole_number));
    stripEl.innerHTML = Array.from({ length: round.hole_count }, (_, i) => {
      const n = i + 1;
      const state = n === holeNumber ? 'current' : playedNow.has(n) ? 'played' : 'unplayed';
      const label = `Hole ${n}, ${state === 'current' ? 'current hole' : state === 'played' ? 'played' : 'not played yet'}`;
      return `<button class="hole-pip ${state}" data-hole="${n}" aria-label="${label}" aria-current="${state === 'current'}">${n}</button>`;
    }).join('');

    qsa('.hole-pip', stripEl).forEach((pip) => {
      // Tapping any hole jumps there, so an earlier hole can be corrected at
      // any time (§4.4, §5.5).
      pip.addEventListener('click', () => renderHole(root, roundId, Number(pip.dataset.hole)));
    });
  }
  renderStrip();
  refreshHint();

  qs('#backBtn', root).addEventListener('click', () => {
    // Leaving pauses rather than ends — the round is resumable from Home,
    // and every completed hole is already persisted.
    db.pauseRound(roundId);
    location.hash = '#/home';
  });

  // Finish Round is reachable at any point, not only from the last hole: a
  // golfer who walks off after seven holes must be able to end cleanly
  // (§5.6).
  qs('#finishBtn', root).addEventListener('click', () => finishRound());

  qs('#prevHoleBtn', root).addEventListener('click', () => {
    if (holeNumber > 1) renderHole(root, roundId, holeNumber - 1);
  });

  qs('#saveHoleBtn', root).addEventListener('click', () => {
    if (!persist()) return; // storage failed — stay put rather than lose the hole
    if (isFinishing) { finishRound(); return; }
    renderHole(root, roundId, nextHole);
  });

  function finishRound() {
    const currentRound = db.getRound(roundId);
    if (!currentRound) { location.hash = '#/home'; return; }
    // A round with no holes played is discarded rather than saved as an
    // empty record, and is confirmed first (§8).
    openEndRoundSheet(currentRound, (zeroHole) => {
      location.hash = zeroHole ? '#/home' : `#/course/summary/${roundId}`;
    });
  }
}
