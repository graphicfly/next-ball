import * as db from '../db.js';
import { qs, qsa } from '../ui.js';
import { FATIGUE_LABELS, DISCOMFORT_LABELS } from '../summarySections.js';

export function renderCheckin(root, sessionId) {
  const session = db.getSession(sessionId);
  if (!session) { location.hash = '#/home'; return; }

  const state = { fatigue: null, hand: null, elbow: null };

  const optionsHtml = (range, group) => range.map((n) => `<div class="choice-btn" data-group="${group}" data-value="${n}">${n}</div>`).join('');

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <span class="side-space"></span>
        <span class="screen-title">Check-In</span>
        <button class="back" id="skipBtn">Skip</button>
      </div>
      <div class="scroll">
        <p class="tiny" style="margin-bottom:var(--space-5);">Optional &mdash; helps you track fatigue and strain over time. Not medical advice.</p>

        <div class="field">
          <label>Fatigue</label>
          <div class="choice-grid wrap-5" id="fatigueGrid">${optionsHtml([1, 2, 3, 4, 5], 'fatigue')}</div>
          <div class="rating-caption" id="fatigueCaption">&nbsp;</div>
        </div>

        <div class="field">
          <label>Hand Discomfort</label>
          <div class="choice-grid wrap-6" id="handGrid">${optionsHtml([0, 1, 2, 3, 4, 5], 'hand')}</div>
          <div class="rating-caption" id="handCaption">&nbsp;</div>
        </div>

        <div class="field">
          <label>Elbow Discomfort</label>
          <div class="choice-grid wrap-6" id="elbowGrid">${optionsHtml([0, 1, 2, 3, 4, 5], 'elbow')}</div>
          <div class="rating-caption" id="elbowCaption">&nbsp;</div>
        </div>
      </div>

      <button class="btn btn-primary btn-hero" id="continueBtn" style="margin-top:var(--space-3);">Continue</button>
    </div>
  `;

  const captionMap = { fatigue: FATIGUE_LABELS, hand: DISCOMFORT_LABELS, elbow: DISCOMFORT_LABELS };
  const captionEl = { fatigue: qs('#fatigueCaption', root), hand: qs('#handCaption', root), elbow: qs('#elbowCaption', root) };

  qsa('.choice-btn', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const value = Number(btn.dataset.value);
      const already = btn.classList.contains('selected');
      qsa(`.choice-btn[data-group="${group}"]`, root).forEach((b) => b.classList.remove('selected'));
      if (already) {
        state[group] = null;
        captionEl[group].innerHTML = '&nbsp;';
      } else {
        btn.classList.add('selected');
        state[group] = value;
        captionEl[group].textContent = captionMap[group][value];
      }
    });
  });

  qs('#skipBtn', root).addEventListener('click', () => {
    location.hash = `#/summary/${sessionId}`;
  });

  qs('#continueBtn', root).addEventListener('click', () => {
    db.setSessionCheckIn(sessionId, {
      fatigue_rating: state.fatigue,
      hand_discomfort_rating: state.hand,
      elbow_discomfort_rating: state.elbow,
    });
    location.hash = `#/summary/${sessionId}`;
  });
}
