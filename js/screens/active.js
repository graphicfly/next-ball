import * as db from '../db.js';
import { qs, qsa, toast, fmtSetup, fmtSurface, fmtSwing, escapeHtml, fmtDateTime, weatherIconHtml, cap } from '../ui.js';
import { startNewShotDraft, startEditShotDraft, setFlowReturn } from '../state.js';
import { enableWakeLock, disableWakeLock } from '../wakeLock.js';
import { startWeatherTracking, stopWeatherTracking, refreshWeatherNow, isFetchingWeather } from '../sessionWeather.js';
import { startLocationResolution } from '../sessionLocation.js';
import { openLocationSheet } from './locationSheet.js';
import { openShotDrillSheet, openShotTrainingAidSheet, openShotSetupSheet, openShotTargetSheet } from './historyDetail.js';

// Registered once at module load (not per-render) so a background weather
// update re-renders the screen if — and only if — it's the one showing.
window.addEventListener('rangelog:weather-updated', () => {
  if (location.hash === '#/active') renderActive(document.getElementById('app'));
});
window.addEventListener('rangelog:location-updated', () => {
  if (location.hash === '#/active') renderActive(document.getElementById('app'));
});

// A short, ambient string only — this line is deliberately de-emphasized
// (see section 18 of the redesign brief) and never shown at all while
// there's nothing to say, so it can't compete with the count/session
// controls above it. Unlike the old chip, it's never rendered as
// "Weather unavailable" — that state instead shows nothing.
function weatherLineText(session) {
  if (isFetchingWeather()) return 'Fetching weather…';
  if (!session.weather_timestamp) return null;
  const parts = [];
  if (session.temperature_f != null) parts.push(`${session.temperature_f}°F`);
  if (session.wind_speed_mph != null) {
    parts.push(`${session.wind_speed_mph} mph${session.wind_direction_cardinal ? ' ' + session.wind_direction_cardinal : ''}`);
  }
  return parts.length ? parts.join(' • ') : null;
}

// ---------- Icons ----------
// Small, local, stroke-based glyphs matching the nav icon language
// (viewBox 0 0 24 24, currentColor, rounded joins) — kept local to this
// screen since nothing else uses them.
function icon(paths, extraAttrs = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extraAttrs}>${paths}</svg>`;
}

const ICON_GEAR = '<circle cx="12" cy="12" r="3.2" /><path d="M20.4 12a8 8 0 0 0-.1-1.3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.1-1.3L15.4 3H9.6l-.4 2.3a7.6 7.6 0 0 0-2.1 1.3l-2.4-.9-2 3.4 2 1.6a8 8 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.1 1.3l.4 2.3h5.8l.4-2.3a7.6 7.6 0 0 0 2.1-1.3l2.4.9 2-3.4-2-1.6c.07-.4.1-.9.1-1.3Z" />';
const ICON_TARGET = '<circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" fill="currentColor" />';
const ICON_UNDO = '<path d="M7 8 3 12l4 4" /><path d="M3 12h11a5.5 5.5 0 0 1 0 11h-2" />';
const ICON_EDIT = '<path d="M15.2 4.8 19 8.6 8.6 19H4.8v-3.8Z" /><path d="M13.5 6.5 17.3 10.3" />';
const ICON_PAUSE = '<rect x="7" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" />';
const ICON_PLAY = '<path d="M8 5.5v13l11-6.5Z" />';
const ICON_FLAG = '<path d="M6 21V4" /><path d="M6 4.5h12l-3 4 3 4H6" />';
const ICON_CHEVRON_RIGHT = '<path d="M9 5.5 15.5 12 9 18.5" />';

// ---------- Illustrated context-strip icons ----------
// Unlike the stroke-only glyphs above, these carry their own fills/shading
// (metallic club head, white ball, green mat edge/tee line) so they read as
// small illustrations rather than line icons — set as explicit attributes
// per element rather than relying on the wrapping <svg>'s currentColor.
function illustratedIcon(inner) {
  return `<svg viewBox="0 0 24 24" fill="none">${inner}</svg>`;
}

function ballDimplesHtml(cx, cy) {
  const d = [[-1.8, -1.3], [1.3, -1.6], [-2.4, .6], [2, .7]];
  return d.map(([dx, dy]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r=".5" fill="#c3cbce"/>`).join('');
}

function clubIconHtml() {
  return illustratedIcon(`
    <path d="M17.6 3 9.6 14.6" stroke="#9aa5ad" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M9.6 14.6c-2 .3-3.9 1.9-4.1 3.6-.2 1.5 1 2.5 2.8 2.1 2.3-.4 4.5-2.3 4.7-4.1.1-1.3-1.1-2-2.7-1.8-.2 0-.5.1-.7.2Z" fill="#c7cfd4"/>
    <path d="M9.6 14.6c-1.3.2-2.6 1-3.3 2.1 1 .3 2.3.1 3.5-.5.9-.5 1.5-1.2 1.7-1.8-.6 0-1.3 0-1.9.2Z" fill="#8f99a1"/>
  `);
}

function ballSetupIconHtml(hasTee) {
  const ballCy = hasTee ? 8 : 13.4;
  const ball = `<circle cx="12" cy="${ballCy}" r="4.3" fill="#f2f5f5"/>${ballDimplesHtml(12, ballCy)}`;
  const peg = hasTee ? '<path d="M11.3 12.3h1.4l1 5.7h-3.4Z" fill="#ccd3d7"/>' : '';
  const groundLine = '<path d="M4 19.7h16" stroke="#3ee892" stroke-width="1.5" stroke-linecap="round"/>';
  return illustratedIcon(`${ball}${peg}${groundLine}`);
}

function matSurfaceIconHtml(isGrass) {
  if (isGrass) {
    return illustratedIcon(`
      <path d="M5 19v-5c0-1.8 1-3 2-4" stroke="#7fdba3" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9 19v-7c0-2 1.2-3.3 2.3-4.4" stroke="#7fdba3" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M13 19v-5c0-2.2 1-3.7 2.4-4.9" stroke="#7fdba3" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M17 19v-3.2c0-1.6.8-2.8 1.8-3.8" stroke="#7fdba3" stroke-width="1.5" stroke-linecap="round"/>
    `);
  }
  return illustratedIcon(`
    <path d="M4 11.5 12 8.2l8 3.3-8 3.3Z" fill="#182a20" stroke="#3ee892" stroke-width="1"/>
    <path d="M4 11.5v2l8 3.3v-2Z" fill="#101d16"/>
    <path d="M20 11.5v2l-8 3.3v-2Z" fill="#0c1712"/>
  `);
}

function swingArcIconHtml(swing) {
  const arc = {
    half: 'M12 3.5A8.5 8.5 0 1 0 19.5 12',
    'three-quarter': 'M12 3.5A8.5 8.5 0 1 0 20.4 15.5',
    full: 'M12 3.5A8.5 8.5 0 1 0 15.5 20.4',
  }[swing] || 'M12 3.5A8.5 8.5 0 1 0 19.5 12';
  const arrow = {
    half: '<path d="M17 9.3l2.9 1.4-.6-3.2Z" fill="#3ee892"/>',
    'three-quarter': '<path d="M22.3 13.7l.6 3.2-2.9-1.4Z" fill="#3ee892"/>',
    full: '<path d="M17.7 21.7l-3.2.5 1.9-2.6Z" fill="#3ee892"/>',
  }[swing] || '<path d="M17 9.3l2.9 1.4-.6-3.2Z" fill="#3ee892"/>';
  return illustratedIcon(`
    <path d="${arc}" stroke="#3ee892" stroke-width="1.4" stroke-linecap="round"/>
    ${arrow}
    <circle cx="13.3" cy="10.3" r="1.3" fill="#eef2f2"/>
    <path d="M13 11.7c-.5 1.9-1.1 3.4-2.4 4.8-.9 1-1.9 1.7-2.8 2.2" stroke="#eef2f2" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <path d="M10.6 16.5c1.4-.8 3-2.2 3.9-4" stroke="#eef2f2" stroke-width="1" stroke-linecap="round" fill="none"/>
    <circle cx="8.4" cy="20.3" r=".8" fill="#3ee892"/>
  `);
}

function contextItemHtml(id, iconMarkup, value, caption) {
  return `<div class="context-item" id="${id}">${iconMarkup}<span class="context-value">${escapeHtml(value)}</span><span class="context-caption">${caption}</span></div>`;
}

// Consolidates Drill/Training Aid/Target into ONE compact summary string
// (see openPracticeSetupSheet below for the editor) — replacing what used
// to be three separate cards. Drill always shows (even the default "Normal
// Swing", which doubles as base context); Training Aid and Target are each
// omitted entirely when inactive, never rendered as "No Training Aid" /
// "No Target" placeholders. Order is always Drill, then Training Aid, then
// Target — never reordered.
function practiceSetupParts(session) {
  const parts = [session.current_drill || db.DEFAULT_DRILL];
  const aid = session.current_training_aid || db.DEFAULT_TRAINING_AID;
  if (aid !== db.DEFAULT_TRAINING_AID) parts.push(db.TRAINING_AID_LABELS[aid] || aid);
  // A non-breaking space keeps "50 yd" from splitting across the 2-line
  // wrap fallback with the number orphaned alone on its own line.
  if (session.current_target_distance != null) parts.push(`${session.current_target_distance} yd Target`);
  return parts;
}

// A screen-reader label always states all three, even the ones the visual
// summary omits when inactive — "no training aid" / "no target" are useful
// spoken context even though they're deliberately never shown as text.
function practiceSetupAriaLabel(session) {
  const drill = session.current_drill || db.DEFAULT_DRILL;
  const aid = session.current_training_aid || db.DEFAULT_TRAINING_AID;
  const aidText = aid !== db.DEFAULT_TRAINING_AID ? (db.TRAINING_AID_LABELS[aid] || aid) : 'No training aid';
  const targetText = session.current_target_distance != null ? `${session.current_target_distance} yard target` : 'No target';
  return `Practice Setup. ${drill}. ${aidText}. ${targetText}.`;
}

const RING_R = 88;
const RING_CIRC = 2 * Math.PI * RING_R;

export function renderActive(root) {
  const session = db.getActiveSession();
  if (!session) {
    location.hash = '#/home';
    return;
  }

  const shots = db.getShotsForSession(session.session_id);
  const nextBallNumber = shots.length + 1;
  const paused = session.status === 'paused';
  const progress = Math.min(shots.length / session.target_ball_count, 1) || 0;
  const ringOffset = RING_CIRC * (1 - progress);

  const weatherText = weatherLineText(session);

  root.innerHTML = `
    <div class="screen active-screen">
      <div class="topbar">
        <button class="back" id="homeBtn">&larr; Home</button>
        <button class="icon-btn" id="settingsGearBtn" aria-label="Settings">${icon(ICON_GEAR)}</button>
      </div>

      ${paused ? '<div class="resume-banner">Session paused</div>' : ''}

      <div class="session-hero">
        <img class="hero-bg" src="graphics/active/range_backdrop.webp" alt="" />
        <div class="progress-ring-wrap">
          <svg class="progress-ring" viewBox="0 0 200 200">
            <circle class="ring-track" cx="100" cy="100" r="${RING_R}"></circle>
            <circle class="ring-fill" cx="100" cy="100" r="${RING_R}" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${ringOffset}"></circle>
          </svg>
          <div class="progress-ring-label">
            <div class="count">${nextBallNumber}</div>
            <div class="of">of ${session.target_ball_count}</div>
          </div>
        </div>
      </div>

      <div class="context-strip">
        ${contextItemHtml('clubItem', clubIconHtml(), session.current_club, 'Club')}
        <div class="context-divider"></div>
        ${contextItemHtml('setupItem', ballSetupIconHtml(session.current_setup === 'tee'), fmtSetup(session.current_setup), 'Lie')}
        <div class="context-divider"></div>
        ${contextItemHtml('surfaceItem', matSurfaceIconHtml(session.current_surface === 'grass'), fmtSurface(session.current_surface), 'Surface')}
        <div class="context-divider"></div>
        ${contextItemHtml('swingItem', swingArcIconHtml(session.current_swing), fmtSwing(session.current_swing), 'Swing')}
      </div>

      <div id="weatherIndicator" class="weather-line-subtle ${weatherText ? '' : 'weather-line-empty'}">${weatherText ? weatherIconHtml(session.weather_condition) : ''}<span>${weatherText ? escapeHtml(weatherText) : ''}</span></div>

      <button class="practice-setup-row" id="practiceSetupRow" aria-label="${escapeHtml(practiceSetupAriaLabel(session))}">
        <div class="session-card-icon">${icon(ICON_TARGET)}</div>
        <div class="practice-setup-text">
          <div class="card-value">${escapeHtml(practiceSetupParts(session).join(' · '))}</div>
          <div class="card-eyebrow">Practice Setup</div>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON_RIGHT}</svg>
      </button>

      ${paused
        ? `<button class="btn btn-primary btn-hero btn-log-shot" id="resumeSessionBtn">${icon(ICON_PLAY)}<span>Resume Session</span></button>`
        : `<button class="btn btn-primary btn-hero btn-log-shot" id="logShotBtn"><span class="log-shot-ball"></span><span>Log Shot</span></button>`}

      <div class="secondary-actions">
        <button class="secondary-action" id="undoBtn">${icon(ICON_UNDO)}<span>Undo</span></button>
        <button class="secondary-action" id="editLastBtn">${icon(ICON_EDIT)}<span>Edit Previous</span></button>
      </div>

      <div class="hairline"></div>

      <div class="bottom-controls">
        <button class="bottom-control" id="pauseBtn">${icon(paused ? ICON_PLAY : ICON_PAUSE)}<span>${paused ? 'Resume' : 'Pause'} Session</span></button>
        <div class="bottom-divider"></div>
        <button class="bottom-control danger" id="finishBtn">${icon(ICON_FLAG)}<span>End Session</span></button>
      </div>
    </div>
  `;

  qs('#homeBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
  qs('#settingsGearBtn', root).addEventListener('click', () => openSettingsSheet(root, session));

  qs('#logShotBtn', root)?.addEventListener('click', () => {
    startNewShotDraft();
    setFlowReturn('#/active');
    location.hash = '#/log/strike';
  });

  qs('#resumeSessionBtn', root)?.addEventListener('click', () => {
    db.resumeSession(session.session_id);
    enableWakeLock();
    startWeatherTracking(session.session_id);
    renderActive(root);
  });

  qs('#undoBtn', root).addEventListener('click', () => {
    const removed = db.deleteLastShot(session.session_id);
    if (!removed) { toast('No shots to undo'); return; }
    toast('Shot removed');
    renderActive(root);
  });

  qs('#editLastBtn', root).addEventListener('click', () => {
    const last = db.getLastShot(session.session_id);
    if (!last) { toast('No shots yet'); return; }
    openEditLastShotSheet(root, last);
  });

  qs('#pauseBtn', root).addEventListener('click', () => {
    if (paused) {
      db.resumeSession(session.session_id);
      enableWakeLock();
      startWeatherTracking(session.session_id);
      startLocationResolution(session.session_id);
    } else {
      db.pauseSession(session.session_id);
      disableWakeLock();
      stopWeatherTracking();
    }
    renderActive(root);
  });

  qs('#finishBtn', root).addEventListener('click', () => {
    db.finishSession(session.session_id);
    disableWakeLock();
    stopWeatherTracking();
    location.hash = `#/checkin/${session.session_id}`;
  });

  qs('#clubItem', root).addEventListener('click', () => openClubOnlySheet(root, session));
  qs('#setupItem', root).addEventListener('click', () => openSettingsSheet(root, session));
  qs('#surfaceItem', root).addEventListener('click', () => openSettingsSheet(root, session));
  qs('#swingItem', root).addEventListener('click', () => openSettingsSheet(root, session));
  qs('#practiceSetupRow', root).addEventListener('click', () => openPracticeSetupSheet(root, session));
  qs('#weatherIndicator', root).addEventListener('click', () => openWeatherSheet(root, session));
}

// The single consolidated entry point for Drill/Training Aid/Target,
// replacing the three separate cards. Tapping any row here closes this hub
// and opens the corresponding EXISTING editor sheet unchanged — this is
// purely a UI consolidation layer; the underlying editors, persistence, and
// data model (drill/training_aid/current_target_distance stay independent
// fields) are untouched.
function openPracticeSetupSheet(root, session) {
  const drill = session.current_drill || db.DEFAULT_DRILL;
  const aid = session.current_training_aid || db.DEFAULT_TRAINING_AID;
  const target = session.current_target_distance;

  const subRow = (id, caption, value) => `
    <button class="practice-setup-sub-row" id="${id}">
      <span class="subrow-label"><span class="sub-caption">${caption}</span><span class="sub-value">${escapeHtml(value)}</span></span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON_RIGHT}</svg>
    </button>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Practice Setup</h2>
      ${subRow('openDrillRow', 'Drill', drill)}
      ${subRow('openAidRow', 'Training Aid', db.TRAINING_AID_LABELS[aid] || 'None')}
      ${subRow('openTargetRow', 'Target', target != null ? target + ' yd' : 'None')}
      <button class="btn btn-outline" id="closePracticeSetupBtn" style="margin-top:8px;">Done</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closePracticeSetupBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qs('#openDrillRow', backdrop).addEventListener('click', () => { backdrop.remove(); openDrillSheet(root, session); });
  qs('#openAidRow', backdrop).addEventListener('click', () => { backdrop.remove(); openTrainingAidSheet(root, session); });
  qs('#openTargetRow', backdrop).addEventListener('click', () => { backdrop.remove(); openTargetSheet(root, session); });
}

// Edit Previous covers two distinct kinds of correction on the most
// recently logged shot: the RESULT (strike/direction/height/distance —
// the existing 4-step re-entry flow, unchanged) and the CONTEXT that was
// active when it was hit (club/setup/surface/swing/drill/aid/target).
// Reuses History Detail's own per-shot correction sheets for the latter
// (see historyDetail.js's openShotSetupSheet etc.) rather than duplicating
// them — same underlying db.updateShot() call, so shot_number and
// shot_timestamp are always preserved and only THIS one shot is touched,
// same guarantee as correcting a shot from History.
function openEditLastShotSheet(root, shot) {
  const subRow = (id, caption, value) => `
    <button class="practice-setup-sub-row" id="${id}">
      <span class="subrow-label"><span class="sub-caption">${caption}</span><span class="sub-value">${escapeHtml(value)}</span></span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON_RIGHT}</svg>
    </button>`;

  const resultSummary = shot.strike === 'miss'
    ? 'Miss'
    : `${cap(shot.strike)} &bull; ${shot.direction ? cap(shot.direction) : '—'} &bull; ${shot.height ? cap(shot.height) : '—'}`;
  const aid = db.shotTrainingAid(shot);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Edit Ball ${shot.shot_number}</h2>
      <div class="tiny muted" style="margin-bottom:var(--space-3);">${resultSummary}</div>
      ${subRow('openShotSetupRow', 'Club / Setup', `${shot.club} • ${fmtSwing(shot.swing_length)}`)}
      ${subRow('openShotTargetRow', 'Target', shot.target_distance_yards != null ? shot.target_distance_yards + ' yd' : 'None')}
      ${subRow('openShotDrillRow', 'Drill', shot.drill || db.DEFAULT_DRILL)}
      ${subRow('openShotAidRow', 'Training Aid', db.TRAINING_AID_LABELS[aid] || 'None')}
      <button class="btn btn-primary" id="redoResultBtn" style="margin-top:var(--space-2);">Redo Result</button>
      <button class="btn btn-outline" id="closeEditLastBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeEditLastBtn', backdrop).addEventListener('click', () => backdrop.remove());

  const reopen = () => renderActive(root);
  qs('#openShotSetupRow', backdrop).addEventListener('click', () => { backdrop.remove(); openShotSetupSheet(shot, reopen); });
  qs('#openShotTargetRow', backdrop).addEventListener('click', () => { backdrop.remove(); openShotTargetSheet(shot, reopen); });
  qs('#openShotDrillRow', backdrop).addEventListener('click', () => { backdrop.remove(); openShotDrillSheet(shot, reopen); });
  qs('#openShotAidRow', backdrop).addEventListener('click', () => { backdrop.remove(); openShotTrainingAidSheet(shot, reopen); });

  qs('#redoResultBtn', backdrop).addEventListener('click', () => {
    backdrop.remove();
    startEditShotDraft(shot);
    setFlowReturn('#/active');
    location.hash = '#/log/strike';
  });
}

function openTargetSheet(root, session) {
  const current = session.current_target_distance;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Target Distance</h2>
      <div class="choice-grid wrap-4">
        <div class="choice-btn ${current == null ? 'selected' : ''}" data-value="__off__">Off</div>
        ${db.TARGET_DISTANCE_PRESETS.map((d) => `<div class="choice-btn ${current === d ? 'selected' : ''}" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn ${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? 'selected' : ''}" data-value="__custom__">Custom</div>
      </div>
      <div id="customTargetWrap" style="display:${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? 'block' : 'none'}; margin-top:12px;">
        <input type="number" id="customTargetInput" placeholder="Yards" min="1" max="500" value="${current != null && !db.TARGET_DISTANCE_PRESETS.includes(current) ? current : ''}" />
        <button class="btn btn-primary" id="setCustomTargetBtn" style="margin-top:8px;">Set Target</button>
      </div>
      <button class="btn btn-outline" id="closeTargetSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const applyTarget = (value) => {
    db.updateSession(session.session_id, { current_target_distance: value });
    backdrop.remove();
    renderActive(root);
  };

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeTargetSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customTargetWrap', backdrop).style.display = 'block';
        qs('#customTargetInput', backdrop).focus();
        return;
      }
      if (btn.dataset.value === '__off__') { applyTarget(null); return; }
      applyTarget(Number(btn.dataset.value));
    });
  });

  qs('#setCustomTargetBtn', backdrop).addEventListener('click', () => {
    const value = Number(qs('#customTargetInput', backdrop).value);
    if (!value || value < 1) { toast('Enter a valid distance'); return; }
    applyTarget(value);
  });
}

function openWeatherSheet(root, session) {
  const fetching = isFetchingWeather();
  const hasWeather = !!session.weather_timestamp;
  const lastKnown = db.getSettings().lastKnownLocation;

  const detailRow = (label, value) => value === null || value === undefined
    ? ''
    : `<div class="kv-row"><span class="muted">${label}</span><b>${escapeHtml(String(value))}</b></div>`;

  const detailsHtml = hasWeather ? `
    <div class="card" style="margin-bottom:var(--space-4);">
      ${detailRow('Location', session.location_name)}
      ${detailRow('Temperature', session.temperature_f != null ? session.temperature_f + '°F' : null)}
      ${detailRow('Feels like', session.feels_like_f != null ? session.feels_like_f + '°F' : null)}
      ${detailRow('Humidity', session.humidity_percent != null ? session.humidity_percent + '%' : null)}
      ${detailRow('Condition', session.weather_condition)}
      ${detailRow('Cloud cover', session.cloud_cover_percent != null ? session.cloud_cover_percent + '%' : null)}
      ${detailRow('Wind', session.wind_speed_mph != null ? session.wind_speed_mph + ' mph' + (session.wind_direction_cardinal ? ' ' + session.wind_direction_cardinal : '') : null)}
      ${detailRow('Gusts', session.wind_gust_mph != null ? session.wind_gust_mph + ' mph' : null)}
      ${detailRow('As of', fmtDateTime(session.weather_timestamp))}
    </div>` : `
    <div class="card muted tiny" style="margin-bottom:var(--space-4);">
      ${fetching ? 'Fetching weather…' : 'Weather unavailable for this session.'}
      ${!fetching && lastKnown?.location_name ? `<div style="margin-top:var(--space-2);">Last known location: ${escapeHtml(lastKnown.location_name)}</div>` : ''}
    </div>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Weather</h2>
      ${detailsHtml}
      <button class="btn btn-primary" id="refreshWeatherBtn" ${fetching ? 'disabled' : ''}>${fetching ? 'Refreshing…' : 'Refresh Weather'}</button>
      <button class="btn btn-outline" id="closeWeatherSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeWeatherSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());
  qs('#refreshWeatherBtn', backdrop).addEventListener('click', () => {
    refreshWeatherNow(session.session_id);
    backdrop.remove();
    toast('Refreshing weather…');
  });
}

// A focused, single-purpose club picker — deliberately not the multi-field
// Session Settings sheet (see openSettingsSheet below, still reachable via
// the gear icon for Setup/Surface/Swing), since switching clubs mid-session
// (warming up on PW, moving to 7i, coming back to PW) is common enough on
// its own to deserve a one-tap-and-done path: tap Club -> pick -> back on
// Active immediately. Only sets current_club — future shots use it, already
// logged ones are untouched (see db.js's addShot, which always stamps from
// current_club at the moment each shot is saved).
function openClubOnlySheet(root, session) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Change Club</h2>
      <div class="choice-grid wrap-4">
        ${db.CLUBS.map((c) => `<div class="choice-btn ${session.current_club === c ? 'selected' : ''}" data-value="${c}">${c}</div>`).join('')}
      </div>
      <button class="btn btn-outline" id="closeClubOnlySheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeClubOnlySheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      db.updateSession(session.session_id, { current_club: btn.dataset.value });
      backdrop.remove();
      renderActive(root);
    });
  });
}

function openDrillSheet(root, session) {
  const current = session.current_drill || db.DEFAULT_DRILL;
  const isCustomCurrent = !db.DRILLS.includes(current);

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Change Drill</h2>
      <div class="choice-grid wrap-2">
        ${db.DRILLS.map((d) => `<div class="choice-btn ${current === d ? 'selected' : ''}" data-value="${d}">${d}</div>`).join('')}
        <div class="choice-btn ${isCustomCurrent ? 'selected' : ''}" data-value="__custom__">Custom${isCustomCurrent ? ': ' + escapeHtml(current) : ''}</div>
      </div>
      <div id="customDrillWrap" style="display:${isCustomCurrent ? 'block' : 'none'}; margin-top:12px;">
        <input type="text" id="customDrillInput" placeholder="Drill name" maxlength="30" value="${isCustomCurrent ? escapeHtml(current) : ''}" />
        <button class="btn btn-primary" id="setCustomDrillBtn" style="margin-top:8px;">Set Drill</button>
      </div>
      <button class="btn btn-outline" id="closeDrillSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const applyDrill = (name) => {
    db.updateSession(session.session_id, { current_drill: name });
    backdrop.remove();
    renderActive(root);
  };

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeDrillSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.value === '__custom__') {
        qs('#customDrillWrap', backdrop).style.display = 'block';
        qs('#customDrillInput', backdrop).focus();
        return;
      }
      applyDrill(btn.dataset.value);
    });
  });

  qs('#setCustomDrillBtn', backdrop).addEventListener('click', () => {
    const name = qs('#customDrillInput', backdrop).value.trim();
    if (!name) { toast('Enter a drill name'); return; }
    applyDrill(name);
  });
}

// One tap selects and returns to Active — Training Aid is persistent
// session context (like Drill/Target), never a step in the Contact/
// Direction/Height/Distance shot-entry sequence. No custom-text option by
// design (speed at the range matters more than a named "Other"); 'Other'
// just stores 'other'.
function openTrainingAidSheet(root, session) {
  const current = session.current_training_aid || db.DEFAULT_TRAINING_AID;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Training Aid</h2>
      <div class="choice-grid wrap-2">
        ${db.TRAINING_AIDS.map((aid) => `<div class="choice-btn ${current === aid ? 'selected' : ''}" data-value="${aid}">${db.TRAINING_AID_LABELS[aid]}</div>`).join('')}
      </div>
      <button class="btn btn-outline" id="closeAidSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeAidSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      db.updateSession(session.session_id, { current_training_aid: btn.dataset.value });
      backdrop.remove();
      renderActive(root);
    });
  });
}

function openSettingsSheet(root, session) {
  const { primary: locationPrimary } = db.sessionLocationDisplay(session);
  const locationLabel = locationPrimary
    || (session.location_candidates?.length ? `${session.location_candidates.length} nearby options` : 'Not set');

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Session Settings</h2>
      <div class="field">
        <label>Location</label>
        <div class="kv-row"><span class="muted">Current</span><b>${escapeHtml(locationLabel)}</b></div>
        <button class="btn btn-outline" id="changeLocationBtn" style="margin-top:8px;">Change Location</button>
      </div>
      <div class="field">
        <label>Club</label>
        <div class="choice-grid wrap-4">
          ${db.CLUBS.map((c) => `<div class="choice-btn ${session.current_club === c ? 'selected' : ''}" data-group="club" data-value="${c}">${c}</div>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Setup</label>
        <div class="choice-grid wrap-2">
          <div class="choice-btn ${session.current_setup === 'ground' ? 'selected' : ''}" data-group="setup" data-value="ground">Ground</div>
          <div class="choice-btn ${session.current_setup === 'tee' ? 'selected' : ''}" data-group="setup" data-value="tee">Tee</div>
        </div>
      </div>
      <div class="field">
        <label>Surface</label>
        <div class="choice-grid wrap-2">
          <div class="choice-btn ${session.current_surface === 'mat' ? 'selected' : ''}" data-group="surface" data-value="mat">Mat</div>
          <div class="choice-btn ${session.current_surface === 'grass' ? 'selected' : ''}" data-group="surface" data-value="grass">Grass</div>
        </div>
      </div>
      <div class="field">
        <label>Swing Length</label>
        <div class="choice-grid">
          <div class="choice-btn ${session.current_swing === 'half' ? 'selected' : ''}" data-group="swing" data-value="half">Half</div>
          <div class="choice-btn ${session.current_swing === 'three-quarter' ? 'selected' : ''}" data-group="swing" data-value="three-quarter">3/4</div>
          <div class="choice-btn ${session.current_swing === 'full' ? 'selected' : ''}" data-group="swing" data-value="full">Full</div>
        </div>
      </div>
      <button class="btn btn-outline" id="closeSheetBtn" style="margin-top:8px;">Close</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());

  qs('#changeLocationBtn', backdrop).addEventListener('click', () => {
    backdrop.remove();
    openLocationSheet(session, () => renderActive(root));
  });

  qsa('.choice-btn', backdrop).forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const value = btn.dataset.value;
      const fieldMap = { club: 'current_club', setup: 'current_setup', surface: 'current_surface', swing: 'current_swing' };
      const field = fieldMap[group];
      db.updateSession(session.session_id, { [field]: value });
      backdrop.remove();
      renderActive(root);
    });
  });
}
