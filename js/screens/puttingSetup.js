import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import {
  MODES, PUTTING_DRILLS, PUTT_SURFACES, PUTT_SURFACE_LABELS,
  SHORT_PUTT_DISTANCES, LAG_DISTANCES, puttingDrill,
} from '../practice.js';

// Putting — select a practice type, then set it up.
//
// practice-spec.md §14. Three practice types plus the approved drills, all
// session-level. Stroke mechanics are never requested during logging.

export function renderPuttingSelect(root) {
  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="backBtn">&larr; Practice</button>
        <span class="screen-title">Putting</span>
        <span class="side-space"></span>
      </div>
      <div class="scroll">
        <div class="drill-list">
          ${PUTTING_DRILLS.map((d) => `
            <button type="button" class="drill-option" data-drill="${d.id}">
              <span class="drill-option-name">${escapeHtml(d.name)}</span>
              <span class="drill-option-blurb">${escapeHtml(d.blurb)}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;

  qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/practice'; });
  qsa('.drill-option', root).forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/putting/setup/${b.dataset.drill}`; });
  });
}

const DEFAULTS_KEY = 'lastPuttingSetup';

export function renderPuttingSetup(root, drillId) {
  const drill = puttingDrill(drillId);
  const saved = db.getSettings()[DEFAULTS_KEY] || {};
  const focus = db.getActiveSwingFocus();

  // Mixed practice varies the distance per putt, so there is no session
  // distance to choose (§17).
  const needsDistance = drill.kind !== 'mixed';
  const distances = drill.kind === 'distance' ? LAG_DISTANCES : SHORT_PUTT_DISTANCES;

  const state = {
    distance_ft: drill.default_distance_ft || saved.distance_ft || distances[1],
    surface: saved.surface || 'green',
  };

  function draw() {
    root.innerHTML = `
      <div class="screen">
        <div class="topbar">
          <button class="back" id="backBtn">&larr; Putting</button>
          <span class="screen-title">${escapeHtml(drill.name)}</span>
          <span class="side-space"></span>
        </div>
        <div class="scroll">
          <p class="tiny muted setup-note">${escapeHtml(drill.blurb)}</p>
          ${needsDistance ? `
            <div class="setup-block">
              <div class="setup-label">Distance</div>
              <div class="pill-select" role="radiogroup" aria-label="Distance">
                ${distances.map((d) => `
                  <button type="button" class="pill ${d === state.distance_ft ? 'active' : ''}" role="radio"
                          aria-checked="${d === state.distance_ft}" data-name="distance_ft" data-value="${d}">${d} ft</button>`).join('')}
                <button type="button" class="pill" data-name="distance_ft" data-value="custom">Custom</button>
              </div>
            </div>` : ''}
          <div class="setup-block">
            <div class="setup-label">Surface</div>
            <div class="pill-select" role="radiogroup" aria-label="Surface">
              ${PUTT_SURFACES.map((s) => `
                <button type="button" class="pill ${s === state.surface ? 'active' : ''}" role="radio"
                        aria-checked="${s === state.surface}" data-name="surface" data-value="${s}">${PUTT_SURFACE_LABELS[s]}</button>`).join('')}
            </div>
          </div>
          ${focus ? `
            <div class="setup-block">
              <div class="setup-label">Current focus</div>
              <div class="practice-focus"><span class="practice-focus-text">${escapeHtml(focus.cue_text)}</span></div>
            </div>` : ''}
          <button class="btn btn-primary btn-hero" id="startBtn">Start Putting</button>
        </div>
      </div>`;

    qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/putting/select'; });

    qsa('.pill[data-name]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const { name, value } = btn.dataset;
        if (name === 'distance_ft' && value === 'custom') {
          const entered = window.prompt('Distance in feet');
          const n = Number(entered);
          if (!Number.isFinite(n) || n <= 0) return;
          state.distance_ft = Math.round(n);
        } else {
          state[name] = name === 'distance_ft' ? Number(value) : value;
        }
        draw();
      });
    });

    qs('#startBtn', root).addEventListener('click', () => {
      const session = db.createPracticeSession({
        mode: MODES.PUTTING,
        kind: drill.kind,
        practice_type: drill.id,
        setup: {
          distance_ft: needsDistance ? state.distance_ft : null,
          surface: state.surface,
          streak_target: drill.streak_target || null,
        },
        focus_snapshot: db.swingFocusSnapshot(),
      });
      if (!session) { toast("Couldn't start that session"); return; }
      db.updateSettings({ [DEFAULTS_KEY]: { distance_ft: state.distance_ft, surface: state.surface } });
      location.hash = `#/putting/${session.session_id}`;
    });
  }

  draw();
}
