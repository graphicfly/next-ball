import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { roundTotals, positiveMoment, practiceFocus, formatToPar } from '../roundAnalysis.js';

// Round Summary — docs/course-mode-spec.md §4.5, Reference D.
//
// A reward, not a report. One hero number, one true observation, one
// glanceable score strip, one Next Practice card, then a quiet way deeper
// and Done. Detailed metrics live behind Explore Round and never appear
// here.

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_STAR = '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" />';
const ICON_TARGET = '<circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" fill="currentColor" />';
const ICON_CHART = '<path d="M5 19V10" /><path d="M12 19V5" /><path d="M19 19v-6" />';
const ICON_CHEVRON = '<path d="M9 5.5 15.5 12 9 18.5" />';

// Prior finished rounds, newest first, reduced to just what the positive
// moment needs to compare against. Test rounds never influence it (§6).
function priorRoundSummaries(round) {
  return db.listFinishedRounds()
    .filter((r) => r.round_id !== round.round_id && db.sessionDataSource(r) === 'real')
    .map((r) => {
      const holes = db.getHolesForRound(r.round_id);
      const t = roundTotals(holes);
      return { round_id: r.round_id, course_id: r.course_id, holesPlayed: t.holesPlayed, toPar: t.toPar, hasPar: t.hasPar };
    })
    .filter((r) => r.hasPar && r.holesPlayed > 0);
}

export function renderRoundSummary(root, roundId) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/history'; return; }

  const holes = db.getHolesForRound(roundId);
  const totals = roundTotals(holes);
  const moment = positiveMoment(round, holes, priorRoundSummaries(round));
  // A round that already produced a plan shows that plan rather than a
  // freshly regenerated focus — this is how a concluded plan stays
  // reachable, through the round that explains it (§7.9). Otherwise the
  // card offers the focus this round would generate.
  const savedPlan = db.getPlanForRound(roundId);
  const focus = savedPlan || practiceFocus(round, holes);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Round Summary</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="round-hero">
          <img class="round-hero-img" src="graphics/home/range_hero.webp" alt="" />
          <div class="round-hero-scrim"></div>
          <div class="round-hero-content">
            <div class="round-hero-eyebrow">Round Complete</div>
            <div class="round-hero-score">
              <span class="round-hero-total">${totals.strokes}</span>
              ${totals.hasPar ? `
                <span class="round-hero-divider"></span>
                <span class="round-hero-topar">${escapeHtml(formatToPar(totals.toPar))}</span>` : ''}
            </div>
            <div class="round-hero-line">Great job getting out there!</div>
          </div>
        </div>

        <div class="insight-card">
          <span class="insight-icon">${icon(ICON_STAR)}</span>
          <div class="next-goal-text">
            <div class="insight-headline">${escapeHtml(moment.headline)}</div>
            <div class="insight-sub">${escapeHtml(moment.detail)}</div>
          </div>
        </div>

        ${holes.length ? `
          <div class="section-title">Your Round</div>
          <div class="card">
            <div class="score-strip">${holes.map((h) => scoreCellHtml(h)).join('')}</div>
          </div>` : ''}

        ${focus ? `
          <button class="next-practice-card" id="nextPracticeBtn">
            <span class="next-practice-badge">${icon(ICON_TARGET)}</span>
            <span class="next-practice-text">
              <span class="next-practice-eyebrow">${savedPlan ? escapeHtml(planStatusLabel(savedPlan.status)) : 'Next Practice'}</span>
              <span class="next-practice-title">${escapeHtml(focus.focus_title)}</span>
              <span class="next-practice-desc">${escapeHtml(focus.focus_rationale)}</span>
            </span>
            <svg class="next-practice-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON}</svg>
          </button>` : ''}

        <button class="explore-row" id="exploreBtn">
          <span class="insight-icon">${icon(ICON_CHART)}</span>
          <span class="explore-row-text">
            <span class="explore-row-title">Explore Round</span>
            <span class="explore-row-sub">See every hole in detail</span>
          </span>
          <span class="explore-row-chevron">&rsaquo;</span>
        </button>
      </div>

      <button class="btn btn-primary btn-hero" id="doneBtn">Done</button>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#doneBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#exploreBtn', root).addEventListener('click', () => { location.hash = `#/course/explore/${roundId}`; });
  // The whole card is the tap target, not a button inside it (§4.5).
  qs('#nextPracticeBtn', root)?.addEventListener('click', () => { location.hash = `#/course/plan/${roundId}`; });
}

// A stored plan shows its own state in place of the "Next Practice"
// eyebrow, so a round opened from History says what became of the plan it
// produced rather than presenting it as a fresh suggestion (§7.9).
function planStatusLabel(status) {
  return {
    saved: 'Practice plan saved',
    started: 'Practice plan in progress',
    completed: 'Practice plan completed',
    dismissed: 'Practice plan deleted',
    superseded: 'Replaced by a newer plan',
  }[status] || 'Next Practice';
}

// One cell per hole: number above, score in a ring below. Ring color encodes
// score relative to par — at or under par accent, over par warning — and
// every cell also carries its numeral and a spoken label, so color is never
// the only channel (§10).
function scoreCellHtml(hole) {
  const overPar = hole.par != null && hole.strokes > hole.par;
  const tone = hole.par == null ? 'neutral' : overPar ? 'over' : 'under';
  const relative = hole.par == null
    ? ''
    : hole.strokes === hole.par
      ? ', level par'
      : `, ${Math.abs(hole.strokes - hole.par)} ${overPar ? 'over' : 'under'} par`;
  return `
    <div class="score-cell" aria-label="Hole ${hole.hole_number}, ${hole.strokes} strokes${relative}">
      <span class="score-cell-num">${hole.hole_number}</span>
      <span class="score-cell-ring ${tone}">${hole.strokes}</span>
    </div>`;
}
