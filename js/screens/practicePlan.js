import * as db from '../db.js';
import { qs, escapeHtml, toast, trapSheetFocus } from '../ui.js';
import { practiceFocus, isRangePracticable } from '../roundAnalysis.js';
import { setPendingPlanId } from '../state.js';

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
  // A putting focus has no coherent range session to start (§11.8): the
  // range logs strike, direction, height and distance, and there is no
  // putting session type. The plan keeps its full value as a written
  // reminder — it simply offers no start action rather than one that would
  // open a session with nothing to do with the plan.
  const startable = isSaved && saved.status === 'saved' && isRangePracticable(saved.focus_type);

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
          ${isSaved ? '<div class="focus-provenance">Created from your last round</div>' : ''}
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

      </div>

      <div class="plan-actions">
        ${isSaved ? `
          ${startable ? '<button class="btn btn-primary" id="startPracticeBtn">Start This Practice</button>' : ''}
          <button class="btn btn-danger btn-sm" id="deletePlanBtn">Delete plan</button>`
          : `<button class="btn btn-primary" id="savePlanBtn">Save Practice Plan</button>
             <button class="btn btn-outline" id="doneBtn">Done</button>`}
      </div>
    </div>
  `;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = `#/course/summary/${roundId}`; });

  // Done dismisses without saving and returns — it never starts practice.
  qs('#doneBtn', root)?.addEventListener('click', () => { location.hash = '#/home'; });

  // Starting practice is always a deliberate act, here or on the Range
  // Session sheet — never something that happens on its own (§7.6).
  qs('#startPracticeBtn', root)?.addEventListener('click', () => {
    setPendingPlanId(saved.plan_id);
    location.hash = '#/start';
  });

  qs('#deletePlanBtn', root)?.addEventListener('click', () => openDeletePlanSheet(root, saved, roundId));

  qs('#savePlanBtn', root)?.addEventListener('click', () => {
    const record = db.createPlan(roundId, plan);
    if (!record) { toast('Could not save this plan'); return; }
    toast('Practice plan saved');
    // Re-render into the saved state so the confirmation is visible and the
    // plan cannot be saved twice.
    renderPracticePlan(root, roundId);
  });
}

// Deleting a plan resolves it to `dismissed` rather than erasing it: the
// record stays attached to its round for provenance but stops being
// outstanding, so it disappears from Home and from Range Session entry
// (§7.11). Nothing about the round itself changes.
function openDeletePlanSheet(root, plan, roundId) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet sheet-danger" role="dialog" aria-modal="true" aria-labelledby="deletePlanTitle">
      <h2 id="deletePlanTitle">Delete the saved plan &ldquo;${escapeHtml(plan.focus_title)}&rdquo;?</h2>
      <p class="tiny muted" style="margin-bottom:var(--space-4);">Your round and its summary are not affected.</p>
      <div class="stack">
        <button class="btn btn-outline" id="cancelDeletePlanBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmDeletePlanBtn">Delete plan</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#cancelDeletePlanBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelDeletePlanBtn', backdrop).addEventListener('click', close);
  qs('#confirmDeletePlanBtn', backdrop).addEventListener('click', () => {
    db.resolvePlan(plan.plan_id, 'dismissed');
    close();
    toast('Plan deleted');
    location.hash = '#/home';
  });
}
