import * as db from '../db.js';
import { qs, escapeHtml, toast, fmtDate } from '../ui.js';
import { practiceFocus } from '../roundAnalysis.js';

// Next Practice — docs/course-mode-spec.md §4.6, Reference E.
//
// No page title or subtitle: the card the golfer just tapped already
// established where they are, and repeating it would waste the fold. The
// hierarchy begins directly with the focus, which sits on the background
// rather than in a card because it is the screen's subject, not one item
// among several.
//
// Two actions and only two (§4.6): Save Practice Plan saves and returns,
// Done dismisses without saving. Saving never starts a practice session —
// the golfer may well not practice for days, which is the entire reason a
// plan is persisted rather than held in memory.

const ICON_TARGET = '<circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" fill="currentColor" />';
const ICON_CHECK = '<path d="M5 12.5 10 17.5 19 7" />';

export function renderPracticePlan(root, roundId) {
  const round = db.getRound(roundId);
  if (!round) { location.hash = '#/history'; return; }

  // A round's plan is created once. Re-opening this screen shows the plan
  // that was saved rather than regenerating (and re-saving) a second one.
  const saved = db.getPlanForRound(roundId);
  const plan = saved || practiceFocus(round, db.getHolesForRound(roundId));
  if (!plan) { location.hash = `#/course/summary/${roundId}`; return; }

  const title = saved ? saved.focus_title : plan.focus_title;
  const rationale = saved ? saved.focus_rationale : plan.focus_rationale;
  const goal = saved ? saved.goal_text : plan.goal_text;
  const steps = saved ? saved.steps : plan.steps;
  const isSaved = !!saved && (saved.status === 'saved' || saved.status === 'started');

  root.innerHTML = `
    <div class="screen">
      <div class="course-hero compact">
        <img class="course-hero-img" src="graphics/home/range_hero.webp" alt="" />
        <div class="course-hero-scrim"></div>
        <div class="topbar course-hero-topbar">
          <button class="back" id="backBtn">&larr; Back</button>
          <span class="side-space"></span>
        </div>
      </div>

      <div class="scroll">
        <div class="focus-block">
          <div class="focus-eyebrow">Focus for next time</div>
          <div class="focus-title">${escapeHtml(title)}</div>
          <div class="focus-rationale">${escapeHtml(rationale)}</div>
          <div class="focus-goal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${ICON_TARGET}</svg>
            <span><b>Goal:</b> ${escapeHtml(goal)}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-eyebrow">Your Practice Plan</div>
          <div class="plan-steps">
            ${steps.map((s) => `
              <div class="plan-step">
                <span class="plan-step-num">${s.order}</span>
                <span class="plan-step-text">
                  <span class="plan-step-title">${escapeHtml(s.title)}</span>
                  <span class="plan-step-detail">${escapeHtml(s.detail)}</span>
                </span>
              </div>`).join('')}
          </div>
        </div>

        ${isSaved ? `
          <div class="plan-saved-note" id="planSavedNote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHECK}</svg>
            <span>Saved ${escapeHtml(fmtDate(saved.created_at.slice(0, 10)))} &mdash; it&rsquo;ll be here when you practice.</span>
          </div>` : ''}
      </div>

      <div class="plan-actions">
        ${isSaved
          ? '<button class="btn btn-primary" id="doneBtn">Done</button>'
          : `<button class="btn btn-primary" id="savePlanBtn">Save Practice Plan</button>
             <button class="btn btn-outline" id="doneBtn">Done</button>`}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = `#/course/summary/${roundId}`; });

  // Done dismisses without saving and returns — it never starts practice.
  qs('#doneBtn', root).addEventListener('click', () => { location.hash = '#/home'; });

  qs('#savePlanBtn', root)?.addEventListener('click', () => {
    const record = db.createPlan(roundId, plan);
    if (!record) { toast('Could not save this plan'); return; }
    toast('Practice plan saved');
    // Re-render into the saved state so the confirmation is visible and the
    // plan cannot be saved twice.
    renderPracticePlan(root, roundId);
  });
}
