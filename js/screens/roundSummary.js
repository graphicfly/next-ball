import * as db from '../db.js';
import { qs, escapeHtml, fmtDate } from '../ui.js';

// PLACEHOLDER — Round Summary proper is Phase 5 (docs/course-mode-spec.md
// §4.5: the score hero, the one truthful observation, the hole-by-hole
// strip, and the Next Practice card). This exists so finishing a round has
// somewhere real to land instead of falling through the router to Home.
// Phase 5 replaces this file's contents entirely.
//
// It deliberately shows only what was actually recorded — no fabricated
// metrics, no placeholder analytics (§1.4 of ux-spec.md).

export function renderRoundSummary(root, roundId) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/home'; return; }

  const holes = db.getHolesForRound(roundId);
  const strokes = holes.reduce((sum, h) => sum + h.strokes, 0);
  const parPlayed = holes.reduce((sum, h) => sum + (h.par ?? 0), 0);
  // Score to par is computed only over the holes actually played (§8).
  const toPar = strokes - parPlayed;
  const toParLabel = toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar);

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <span class="screen-title">Round Summary</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="card" style="margin-top:var(--space-5);">
          <div class="card-eyebrow">Round complete</div>
          <div class="card-value">${escapeHtml(round.course_name)}</div>
          <div class="tiny muted" style="margin-top:2px;">${fmtDate(round.date)}</div>
          <div class="hairline" style="margin:var(--space-4) 0;"></div>
          <div class="tiny muted">${holes.length} hole${holes.length === 1 ? '' : 's'} played &bull; ${strokes} strokes${parPlayed ? ` &bull; ${toParLabel}` : ''}</div>
        </div>
        <p class="tiny muted" style="margin-top:var(--space-5);">Round Summary &mdash; your score, what stood out, and your next practice focus &mdash; arrives in the next step.</p>
      </div>
      <button class="btn btn-primary btn-hero" id="doneBtn">Done</button>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#doneBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
}
