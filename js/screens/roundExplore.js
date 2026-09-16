import * as db from '../db.js';
import { qs, escapeHtml } from '../ui.js';
import { roundTotals, formatToPar } from '../roundAnalysis.js';

// Explore Round — docs/course-mode-spec.md §9. Deliberately just the
// hole-by-hole detail: §9 scopes V1 to exactly that and defers the fuller
// analytics, and §4.5 keeps depth off Round Summary rather than duplicating
// it here.
//
// Subject to the §7.4 honesty rule without exception: every column below is
// a field recorded on the hole, never an inference. There is no Next
// Practice CTA here — that lives on Round Summary and appears once.

export function renderRoundExplore(root, roundId) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/history'; return; }

  const holes = db.getHolesForRound(roundId);
  const totals = roundTotals(holes);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Summary</button>
        <span class="screen-title">Explore Round</span>
        <span class="side-space"></span>
      </div>

      <div class="scroll">
        <div class="tiny muted" style="margin-bottom:var(--space-4);">
          ${escapeHtml(round.course_name)} &bull; ${totals.holesPlayed} hole${totals.holesPlayed === 1 ? '' : 's'} &bull; ${totals.strokes} strokes${totals.hasPar ? ` &bull; ${escapeHtml(formatToPar(totals.toPar))}` : ''}
        </div>

        ${holes.length ? `
          <div class="card">
            <div class="hole-detail-head">
              <span>Hole</span><span>Par</span><span>Score</span><span>Short</span><span>Putts</span>
            </div>
            ${holes.map((h) => `
              <div class="hole-detail-row">
                <span class="hole-detail-num">${h.hole_number}</span>
                <span>${h.par ?? '—'}</span>
                <span class="hole-detail-score ${h.par != null && h.strokes > h.par ? 'over' : ''}">${h.strokes}</span>
                <span>${h.short_game_strokes}</span>
                <span>${h.putts}</span>
              </div>
              ${h.clubs_used?.length ? `<div class="hole-detail-clubs">${h.clubs_used.map((c) => `<span class="hole-detail-club">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
            `).join('')}
          </div>` : '<div class="tiny muted">No holes were recorded for this round.</div>'}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = `#/course/summary/${roundId}`; });
}
