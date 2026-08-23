import * as db from '../db.js';
import { qs, qsa, toast, todayLocalDate, nowLocalTime, escapeHtml } from '../ui.js';
import { enableWakeLock } from '../wakeLock.js';
import { startWeatherTracking } from '../sessionWeather.js';
import { startLocationResolution } from '../sessionLocation.js';
import {
  getClubQuickPicks, getBallCountQuickPicks, getLastRealSetupDefaults,
  recordClubQuickPicks, recordBallCountQuickPicks,
} from '../setupPersonalization.js';

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_BACK = '<path d="M15 5 8 12l7 7" />';
const ICON_SETTINGS = '<circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3H9.7l-.3 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.3 2.6h4.6l.3-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.07-.4.1-.8.1-1.2Z" />';
const ICON_TRENDS = '<path d="M4 18V9" /><path d="M11 18V5" /><path d="M18 18v-7" />';
const ICON_CLUB = '<path d="M8 20l7.5-15" /><circle cx="16.3" cy="4.3" r="2" /><path d="M6 21h5" />';
const ICON_BALL = '<circle cx="12" cy="12" r="8" /><circle cx="9" cy="9" r="0.8" fill="currentColor" stroke="none" /><circle cx="14" cy="8.5" r="0.8" fill="currentColor" stroke="none" /><circle cx="15.5" cy="12" r="0.8" fill="currentColor" stroke="none" /><circle cx="9" cy="14" r="0.8" fill="currentColor" stroke="none" /><circle cx="12.5" cy="15.5" r="0.8" fill="currentColor" stroke="none" />';
const ICON_SURFACE = '<path d="M12 3 21 8l-9 5-9-5Z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" />';
const ICON_LIE = '<path d="M6 21V4" /><path d="M6 4.5h11l-2.5 3.5L17 11.5H6" />';
const ICON_SWING = '<circle cx="12" cy="5" r="1.8" /><path d="M12 7v6l4 4" /><path d="M12 13l-5-3" /><path d="M17 4l3 2" />';
const ICON_DRILL = '<path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />';
const ICON_TARGET = '<circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" fill="currentColor" />';
const ICON_AID = '<circle cx="5" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7 12h10" /><path d="M5 9.3v5.4M19 9.3v5.4" />';
const ICON_CHEVRON = '<path d="M9 6l6 6-6 6" />';

// Grouped for the All Clubs sheet — same order as db.CLUBS itself (the
// single source of truth), just broken into visual sections. A club added
// to db.CLUBS later that doesn't fall in any named group below simply
// falls through to "Other" via the final catch-all, so this never silently
// drops a supported club.
const CLUB_GROUPS = [
  { label: 'Woods', test: (c) => c === 'Driver' || /^\dW$/.test(c) },
  { label: 'Hybrids', test: (c) => c === 'Hybrid' },
  { label: 'Irons', test: (c) => /^\di$/.test(c) },
  { label: 'Wedges', test: (c) => ['PW', 'GW', 'SW', 'LW'].includes(c) },
  { label: 'Putter', test: (c) => c === 'Putter' },
];

function groupClubs() {
  const groups = CLUB_GROUPS.map((g) => ({ label: g.label, clubs: db.CLUBS.filter(g.test) }));
  const grouped = new Set(groups.flatMap((g) => g.clubs));
  const rest = db.CLUBS.filter((c) => !grouped.has(c));
  if (rest.length) groups.push({ label: 'Other', clubs: rest });
  return groups.filter((g) => g.clubs.length);
}

// NOTE: there is deliberately no "Ready to Start" summary card. The whole
// screen fits one viewport now, so every value such a card would list
// (club, balls, surface, lie, swing) is already visible directly above it
// as a green selected pill — restating them was pure duplication and cost
// vertical space the rows and hero use better.

export function renderStart(root) {
  const defaults = getLastRealSetupDefaults();
  const clubQuickPicks = getClubQuickPicks();
  const ballCountQuickPicks = getBallCountQuickPicks();
  recordClubQuickPicks(clubQuickPicks);
  recordBallCountQuickPicks(ballCountQuickPicks);

  const date = todayLocalDate();
  const time = nowLocalTime();

  const state = {
    // A brand-new golfer with no history and no saved settings has no
    // remembered club to fall back to — default to the first quick pick so
    // the screen never starts with nothing selected (core principle: most
    // of the setup should already be correct when the screen opens).
    club: defaults.club || clubQuickPicks[0],
    ballCount: defaults.ballCount,
    setup: defaults.setup,
    surface: defaults.surface,
    swing: defaults.swing,
    drill: defaults.drill,
    trainingAid: defaults.trainingAid,
    // Deliberately never restored from the last session — Target starts Off
    // every time so an old distance never silently carries into a new,
    // unrelated session (see setupPersonalization.js).
    target: null,
    focus: [],
    notes: '',
  };

  function pillHtml(group, value, label, selected) {
    return `<button type="button" class="setup-pill${selected ? ' selected' : ''}" data-group="${group}" data-value="${escapeHtml(String(value))}" aria-pressed="${selected}">${escapeHtml(label)}</button>`;
  }

  function clubPillsHtml() {
    // The currently-selected club always stays visible even if it isn't
    // (yet) one of the personalized quick picks — swapped in for the last
    // slot rather than silently hidden behind More (spec section 7).
    let display = clubQuickPicks;
    if (state.club && !display.includes(state.club)) display = [...display.slice(0, 3), state.club];
    return `
      ${display.map((c) => pillHtml('club', c, c, state.club === c)).join('')}
      <button type="button" class="setup-pill setup-pill-more" id="moreClubsBtn">More ${icon(ICON_CHEVRON)}</button>`;
  }

  function ballPillsHtml() {
    let display = ballCountQuickPicks;
    if (state.ballCount && !display.includes(state.ballCount)) display = [...display.slice(0, 2), state.ballCount].sort((a, b) => a - b);
    return `
      ${display.map((n) => pillHtml('ballCount', n, String(n), state.ballCount === n)).join('')}
      <button type="button" class="setup-pill setup-pill-more" id="moreBallsBtn">Custom ${icon(ICON_CHEVRON)}</button>`;
  }

  // `sub` is optional: the Club row carries five choices (four quick picks
  // plus More), which at phone width leaves no room for a descriptive line
  // beside them. Rather than render a truncated "Choo…", that row simply
  // stands on its title — the four club names next to it are self-evidently
  // the choice being made.
  function setupRowHtml(iconSvg, title, sub, pillsHtml, id) {
    return `
      <div class="setup-row">
        <div class="setup-row-icon">${icon(iconSvg)}</div>
        <div class="setup-row-text">
          <div class="setup-row-title">${title}</div>
          ${sub ? `<div class="setup-row-sub">${sub}</div>` : ''}
        </div>
        <div class="setup-pills" id="${id}">${pillsHtml}</div>
      </div>`;
  }

  function secondaryRowHtml(id, iconSvg, label, value) {
    return `
      <button type="button" class="setup-secondary-row" id="${id}">
        <span class="setup-secondary-icon">${icon(iconSvg)}</span>
        <span class="setup-secondary-label">${label}</span>
        <span class="setup-secondary-value">${escapeHtml(value)} ${icon(ICON_CHEVRON)}</span>
      </button>`;
  }

  function renderAll() {
    root.innerHTML = `
      <div class="screen setup-screen">
        <div class="setup-hero">
          <img class="home-hero-img" src="graphics/home/range_hero.webp" alt="" />
          <div class="home-hero-scrim"></div>
          <button class="icon-btn setup-back-btn" id="backBtn" aria-label="Cancel">${icon(ICON_BACK)}</button>
          <div class="setup-hero-actions">
            <button class="icon-btn" id="settingsBtn" aria-label="Settings">${icon(ICON_SETTINGS)}</button>
            <button class="icon-btn" id="trendsBtn" aria-label="Trends">${icon(ICON_TRENDS)}</button>
          </div>
          <div class="home-hero-content">
            <h1 class="home-brand-mark">NEXT BALL</h1>
            <div class="home-brand-tagline">Find your groove.</div>
          </div>
        </div>

        <div class="setup-body">
          <div class="setup-heading">
            <div class="setup-heading-title">Set Up Your Session</div>
            <div class="setup-heading-sub">Dial in your practice before you start.</div>
          </div>

          ${setupRowHtml(ICON_CLUB, 'Club', '', clubPillsHtml(), 'clubPills')}
          ${setupRowHtml(ICON_BALL, 'Balls', 'How many balls?', ballPillsHtml(), 'ballPills')}
          ${setupRowHtml(ICON_SURFACE, 'Surface', 'Where are you hitting?', [
            pillHtml('surface', 'mat', 'Mat', state.surface === 'mat'),
            pillHtml('surface', 'grass', 'Grass', state.surface === 'grass'),
          ].join(''), 'surfacePills')}
          ${setupRowHtml(ICON_LIE, 'Setup', 'How will you hit?', [
            pillHtml('setup', 'ground', 'Ground', state.setup === 'ground'),
            pillHtml('setup', 'tee', 'Tee', state.setup === 'tee'),
          ].join(''), 'setupPills')}
          ${setupRowHtml(ICON_SWING, 'Swing Length', 'How long is your swing?', [
            pillHtml('swing', 'half', 'Half', state.swing === 'half'),
            pillHtml('swing', 'three-quarter', '3/4', state.swing === 'three-quarter'),
            pillHtml('swing', 'full', 'Full', state.swing === 'full'),
          ].join(''), 'swingPills')}

          <div class="setup-secondary-group">
            ${secondaryRowHtml('drillRow', ICON_DRILL, 'Drill', state.drill)}
            ${secondaryRowHtml('targetRow', ICON_TARGET, 'Target Practice', state.target != null ? state.target + ' yd' : 'Off')}
            ${secondaryRowHtml('aidRow', ICON_AID, 'Training Aid', db.TRAINING_AID_LABELS[state.trainingAid])}
          </div>

          <details class="section-details">
            <summary class="section-title">More Options</summary>
            <div class="field">
              <label>Practice Focus</label>
              <div class="choice-grid wrap-2" id="focusGrid">
                ${db.PRACTICE_FOCUS.map((f) => `<div class="choice-btn ${state.focus.includes(f) ? 'selected' : ''}" data-value="${f}">${f}</div>`).join('')}
              </div>
            </div>
            <div class="field">
              <label>Session Notes</label>
              <textarea id="notesInput" placeholder="Anything worth remembering about today's session">${escapeHtml(state.notes)}</textarea>
            </div>
          </details>
        </div>

        <button class="btn btn-primary btn-hero" id="startNowBtn">Start Session</button>
      </div>
    `;
    bindAll();
  }

  function bindAll() {
    qs('#backBtn', root).addEventListener('click', () => { location.hash = '#/home'; });
    qs('#settingsBtn', root).addEventListener('click', () => { location.hash = '#/settings'; });
    qs('#trendsBtn', root).addEventListener('click', () => { location.hash = '#/trends'; });

    qsa('.setup-pill[data-group]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        const raw = btn.dataset.value;
        if (group === 'club') { state.club = raw; renderAll(); return; }
        if (group === 'ballCount') { state.ballCount = Number(raw); renderAll(); return; }
        if (group === 'surface') state.surface = raw;
        else if (group === 'setup') state.setup = raw;
        else if (group === 'swing') state.swing = raw;
        qsa(`.setup-pill[data-group="${group}"]`, root).forEach((b) => {
          const selected = b.dataset.value === raw;
          b.classList.toggle('selected', selected);
          b.setAttribute('aria-pressed', String(selected));
        });
      });
    });

    qs('#moreClubsBtn', root).addEventListener('click', () => openClubSheet());
    qs('#moreBallsBtn', root).addEventListener('click', () => openBallCountSheet());
    qs('#drillRow', root).addEventListener('click', () => openDrillSheet());
    qs('#targetRow', root).addEventListener('click', () => openTargetSheet());
    qs('#aidRow', root).addEventListener('click', () => openTrainingAidSheet());

    qsa('#focusGrid .choice-btn', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        const already = btn.classList.contains('selected');
        btn.classList.toggle('selected');
        state.focus = already ? state.focus.filter((f) => f !== value) : [...state.focus, value];
      });
    });
    qs('#notesInput', root).addEventListener('input', (e) => { state.notes = e.target.value; });

    qs('#startNowBtn', root).addEventListener('click', () => {
      if (!state.club) { toast('Select a club'); return; }
      if (!state.ballCount || state.ballCount < 1) { toast('Enter a valid ball count'); return; }

      const session = db.createSession({
        date, start_time: time,
        target_ball_count: state.ballCount,
        default_club: state.club,
        default_setup: state.setup,
        default_surface: state.surface,
        default_swing: state.swing,
        practice_focus: state.focus,
        session_notes: state.notes,
      });

      const patch = {};
      if (state.drill !== db.DEFAULT_DRILL) patch.current_drill = state.drill;
      if (state.target != null) patch.current_target_distance = state.target;
      if (state.trainingAid !== db.DEFAULT_TRAINING_AID) patch.current_training_aid = state.trainingAid;
      if (Object.keys(patch).length) db.updateSession(session.session_id, patch);

      db.updateSettings({
        lastClub: state.club,
        lastSetup: state.setup,
        lastSurface: state.surface,
        lastSwing: state.swing,
        lastBallCount: state.ballCount,
      });

      enableWakeLock();
      // Weather and venue detection both happen entirely in the background
      // from here — the session (and the golfer) never wait on either.
      startWeatherTracking(session.session_id);
      startLocationResolution(session.session_id);
      location.hash = '#/active';
    });
  }

  function openClubSheet() {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <h2>All Clubs</h2>
        ${groupClubs().map((g) => `
          <div class="sheet-group-label">${g.label}</div>
          <div class="choice-grid wrap-4" style="margin-bottom:var(--space-4);">
            ${g.clubs.map((c) => `<div class="choice-btn ${state.club === c ? 'selected' : ''}" data-value="${c}">${c}</div>`).join('')}
          </div>`).join('')}
        <button class="btn btn-outline" id="closeClubSheetBtn">Close</button>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    qs('#closeClubSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());
    qsa('.choice-btn', backdrop).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.club = btn.dataset.value;
        backdrop.remove();
        renderAll();
      });
    });
  }

  function openBallCountSheet() {
    const COMMON_COUNTS = [10, 20, 25, 30, 40, 50, 60, 75, 100];
    const isPreset = COMMON_COUNTS.includes(state.ballCount);
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <h2>Custom Ball Count</h2>
        <div class="choice-grid wrap-5" style="margin-bottom:var(--space-4);">
          ${COMMON_COUNTS.map((n) => `<div class="choice-btn ${state.ballCount === n ? 'selected' : ''}" data-value="${n}">${n}</div>`).join('')}
        </div>
        <input type="number" id="customBallInput" placeholder="Number of balls" min="1" max="200" value="${!isPreset ? state.ballCount : ''}" />
        <button class="btn btn-primary" id="setCustomBallBtn" style="margin-top:var(--space-3);">Set Ball Count</button>
        <button class="btn btn-outline" id="closeBallSheetBtn" style="margin-top:8px;">Close</button>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    qs('#closeBallSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());
    qsa('.choice-btn', backdrop).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.ballCount = Number(btn.dataset.value);
        backdrop.remove();
        renderAll();
      });
    });
    qs('#setCustomBallBtn', backdrop).addEventListener('click', () => {
      const value = Number(qs('#customBallInput', backdrop).value);
      if (!value || value < 1 || value > 200) { toast('Enter a valid ball count (1-200)'); return; }
      state.ballCount = value;
      backdrop.remove();
      renderAll();
    });
  }

  function openDrillSheet() {
    const current = state.drill;
    const isCustomCurrent = !db.DRILLS.includes(current);
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <h2>Drill</h2>
        <div class="choice-grid wrap-2">
          ${db.DRILLS.map((d) => `<div class="choice-btn ${current === d ? 'selected' : ''}" data-value="${d}">${d}</div>`).join('')}
          <div class="choice-btn ${isCustomCurrent ? 'selected' : ''}" data-value="__custom__">Custom${isCustomCurrent ? ': ' + escapeHtml(current) : ''}</div>
        </div>
        <div id="customDrillWrap" style="display:${isCustomCurrent ? 'block' : 'none'}; margin-top:12px;">
          <input type="text" id="customDrillInput" placeholder="Drill name" maxlength="30" value="${isCustomCurrent ? escapeHtml(current) : ''}" />
          <button class="btn btn-primary" id="setCustomDrillBtn" style="margin-top:8px;">Set Drill</button>
        </div>
        <button class="btn btn-outline" id="closeDrillSheetBtn" style="margin-top:8px;">Close</button>
      </div>`;
    document.body.appendChild(backdrop);
    const applyDrill = (name) => { state.drill = name; backdrop.remove(); renderAll(); };
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

  function openTargetSheet() {
    const current = state.target;
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
      </div>`;
    document.body.appendChild(backdrop);
    const applyTarget = (value) => { state.target = value; backdrop.remove(); renderAll(); };
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

  function openTrainingAidSheet() {
    const current = state.trainingAid;
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <h2>Training Aid</h2>
        <div class="choice-grid wrap-2">
          ${db.TRAINING_AIDS.map((aid) => `<div class="choice-btn ${current === aid ? 'selected' : ''}" data-value="${aid}">${db.TRAINING_AID_LABELS[aid]}</div>`).join('')}
        </div>
        <button class="btn btn-outline" id="closeAidSheetBtn" style="margin-top:8px;">Close</button>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    qs('#closeAidSheetBtn', backdrop).addEventListener('click', () => backdrop.remove());
    qsa('.choice-btn', backdrop).forEach((btn) => {
      btn.addEventListener('click', () => {
        state.trainingAid = btn.dataset.value;
        backdrop.remove();
        renderAll();
      });
    });
  }

  renderAll();
}
