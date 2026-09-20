import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import {
  MODES, LIES, LIE_LABELS, SURFACES, SURFACE_LABELS, CHIP_CLUBS, CHIP_DISTANCES,
  CHIPPING_DRILLS,
} from '../practice.js';

// Chipping setup — set once, at the start (practice-spec.md §3, §4).
//
// This is the screen where Chipping diverges from Range on purpose. Range
// snapshots context onto every shot because a golfer at the range changes
// club constantly. A golfer chipping picks a spot and hits fifteen balls
// from it, so the context belongs to the session — and a material change of
// it starts a NEW session rather than becoming a mid-session edit.
//
// There is deliberately no persistent context bar during chip logging.

const DEFAULTS_KEY = 'lastChippingSetup';

function chipRow(label, name, options, current) {
  return `
    <div class="setup-block">
      <div class="setup-label">${escapeHtml(label)}</div>
      <div class="chip-row" role="radiogroup" aria-label="${escapeHtml(label)}">
        ${options.map((o) => `
          <button type="button" class="chip ${o.value === current ? 'selected' : ''}" role="radio"
                  aria-checked="${o.value === current}" data-name="${name}" data-value="${escapeHtml(String(o.value))}">
            ${escapeHtml(o.label)}
          </button>`).join('')}
      </div>
    </div>`;
}

export function renderChippingSetup(root) {
  const saved = db.getSettings()[DEFAULTS_KEY] || {};
  const focus = db.getActiveSwingFocus();

  const state = {
    club: saved.club || 'PW',
    lie: saved.lie || 'fairway',
    surface: saved.surface || 'grass',
    distance_yds: saved.distance_yds || 10,
    practice_type: 'standard',
  };

  function draw() {
    root.innerHTML = `
      <div class="screen">
        <div class="topbar">
          <button class="back" id="backBtn">&larr; Practice</button>
          <span class="screen-title">Chipping</span>
          <span class="side-space"></span>
        </div>
        <div class="scroll">
          ${chipRow('Club', 'club', CHIP_CLUBS.map((c) => ({ value: c, label: c })), state.club)}
          ${chipRow('Lie', 'lie', LIES.map((l) => ({ value: l, label: LIE_LABELS[l] })), state.lie)}
          ${chipRow('Surface', 'surface', SURFACES.map((s) => ({ value: s, label: SURFACE_LABELS[s] })), state.surface)}
          ${chipRow('Distance to hole', 'distance_yds',
            CHIP_DISTANCES.map((d) => ({ value: d, label: `${d} yd` })).concat([{ value: 'custom', label: 'Custom' }]),
            state.distance_yds)}
          <p class="tiny muted setup-note">Distance is your estimate of the shot you are practising, not a measurement.</p>

          <div class="setup-block">
            <div class="setup-label">Practice type</div>
            <div class="drill-list">
              ${CHIPPING_DRILLS.map((d) => `
                <button type="button" class="drill-option ${d.id === state.practice_type ? 'selected' : ''}" data-drill="${d.id}">
                  <span class="drill-option-name">${escapeHtml(d.name)}</span>
                  <span class="drill-option-blurb">${escapeHtml(d.blurb)}</span>
                </button>`).join('')}
            </div>
          </div>

          ${focus ? `
            <div class="setup-block">
              <div class="setup-label">Current focus</div>
              <div class="practice-focus">
                <span class="practice-focus-text">${escapeHtml(focus.cue_text)}</span>
                <button class="capture-link" id="changeFocusBtn">Change</button>
              </div>
            </div>` : ''}

          <button class="btn btn-primary btn-hero" id="startBtn">Start Chipping</button>
        </div>
      </div>`;

    qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/practice'; });

    qsa('.chip[data-name]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const { name, value } = btn.dataset;
        if (name === 'distance_yds' && value === 'custom') {
          const entered = window.prompt('Distance to the hole, in yards');
          const n = Number(entered);
          if (!Number.isFinite(n) || n <= 0) return;
          state.distance_yds = Math.round(n);
        } else {
          state[name] = name === 'distance_yds' ? Number(value) : value;
        }
        draw();
      });
    });

    qsa('.drill-option', root).forEach((btn) => {
      btn.addEventListener('click', () => { state.practice_type = btn.dataset.drill; draw(); });
    });

    // Focus is changed through the EXISTING Active Focus system. There is no
    // separate Chipping Focus model (§19).
    qs('#changeFocusBtn', root)?.addEventListener('click', () => { location.hash = '#/history'; });

    qs('#startBtn', root).addEventListener('click', () => {
      // Around the Green is variable practice: the golfer moves to a new
      // spot every ball, so a session-level lie and distance would be a
      // fiction (§13). They are not collected and not stored.
      const variable = state.practice_type === 'around_green';
      const setup = {
        club: state.club,
        surface: state.surface,
        lie: variable ? null : state.lie,
        distance_yds: variable ? null : state.distance_yds,
      };
      const session = db.createPracticeSession({
        mode: MODES.CHIPPING,
        practice_type: state.practice_type,
        setup,
        // Snapshotted now, so a later edit to the Focus cannot rewrite what
        // this session was practised under (§19).
        focus_snapshot: db.swingFocusSnapshot(),
      });
      if (!session) { toast("Couldn't start that session"); return; }
      db.updateSettings({ [DEFAULTS_KEY]: { club: state.club, lie: state.lie, surface: state.surface, distance_yds: state.distance_yds } });
      location.hash = `#/chipping/${session.session_id}`;
    });
  }

  draw();
}
