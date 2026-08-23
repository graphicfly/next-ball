import * as db from '../db.js';
import { qs, fmtDate, fmtSetup, fmtSurface, fmtSwing, escapeHtml, trapSheetFocus, todayLocalDate, nowLocalTime } from '../ui.js';
import { clubSummaryLabel } from '../stats.js';
import { enableWakeLock, disableWakeLock } from '../wakeLock.js';
import { startWeatherTracking, stopWeatherTracking } from '../sessionWeather.js';
import { startLocationResolution } from '../sessionLocation.js';

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_CLOCK = '<circle cx="12" cy="13" r="8.5" /><path d="M12 9v4l3 2" /><path d="M9.5 3.2h5" />';
const ICON_PLAY = '<path d="M8 5.5v13l11-6.5Z" />';
const ICON_FLAG = '<path d="M6 21V4" /><path d="M6 4.5h12l-3 4 3 4H6" />';
// Small, simple line glyphs for the compact session-metadata row — deliberately
// plainer than Active screen's illustrated context-strip icons (which carry
// their own fills/shading); this row is secondary context on Home, not the
// main event, so it stays minimal per the mockup.
const ICON_CLUB_SMALL = '<path d="M16.5 3.5 9 15" /><ellipse cx="7.7" cy="16.8" rx="2.6" ry="1.7" transform="rotate(-25 7.7 16.8)" />';
const ICON_LIE_SMALL = '<path d="M3 17c2.5-3.5 5-3.5 7.5 0s5 3.5 7.5 0" />';
const ICON_SURFACE_SMALL = '<rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)" />';

// Starts today's session immediately using whatever defaults the golfer
// last used — the same fields #/start pre-fills from. Kept local to this
// screen rather than shared with start.js: that form also has to resolve
// the "Other" custom-club case and validate free-typed input, which this
// one-tap path never encounters (settings.lastClub is always a concrete
// value once it exists).
function startWithDefaults(settings) {
  const session = db.createSession({
    date: todayLocalDate(),
    start_time: nowLocalTime(),
    target_ball_count: settings.lastBallCount || db.DEFAULT_BALL_COUNT,
    default_club: settings.lastClub,
    default_setup: settings.lastSetup || 'ground',
    default_surface: settings.lastSurface || 'mat',
    default_swing: settings.lastSwing || 'full',
  });
  enableWakeLock();
  startWeatherTracking(session.session_id);
  startLocationResolution(session.session_id);
  location.hash = '#/active';
}

function metaItemHtml(iconMarkup, label) {
  return `<span class="home-active-meta-item">${iconMarkup}<span>${escapeHtml(label)}</span></span>`;
}

export function renderHome(root) {
  const activeSession = db.getActiveSession();
  const finished = db.listFinishedSessions();
  const recent = finished[0] || null;
  const settings = db.getSettings();
  const hasDefaults = !!settings.lastClub;

  let activeCardHtml = '';
  if (activeSession) {
    const shots = db.getShotsForSession(activeSession.session_id);
    const nextBallNumber = shots.length + 1;
    const zeroShot = shots.length === 0;
    const endLabel = zeroShot ? 'Discard Session' : 'End Session';
    const endNote = zeroShot
      ? 'No shots have been logged.'
      : `Session will be saved with ${shots.length} shot${shots.length === 1 ? '' : 's'}.`;

    activeCardHtml = `
      <div class="card home-active-card">
        <div class="home-active-header">
          <div class="home-active-icon">${icon(ICON_FLAG)}</div>
          <div class="home-active-header-text">
            <div class="home-active-eyebrow">Session in progress</div>
            <div class="home-active-ball">Ball ${nextBallNumber} of ${activeSession.target_ball_count}</div>
          </div>
        </div>
        <div class="home-active-meta">
          ${metaItemHtml(icon(ICON_CLUB_SMALL), activeSession.current_club)}
          ${metaItemHtml(icon(ICON_CLOCK), fmtSwing(activeSession.current_swing))}
          ${metaItemHtml(icon(ICON_LIE_SMALL), fmtSetup(activeSession.current_setup))}
          ${metaItemHtml(icon(ICON_SURFACE_SMALL), fmtSurface(activeSession.current_surface))}
        </div>
        <div class="hairline"></div>
        <button class="btn btn-primary btn-hero btn-log-shot" id="resumeBtn">${icon(ICON_PLAY)}<span>Resume Session</span></button>
        <div class="home-active-or"><span>or</span></div>
        <button class="home-active-end" id="endSessionBtn" aria-label="${endLabel}">${icon(ICON_FLAG)}<span>${endLabel}</span></button>
        <div class="home-active-end-note">${escapeHtml(endNote)}</div>
      </div>`;
  }

  const primaryBtnHtml = !activeSession
    ? `<button class="btn btn-primary btn-hero btn-log-shot" id="startBtn"><span>Start Session</span></button>`
    : '';

  const setupLineHtml = (!activeSession && hasDefaults) ? `
    <div class="home-setup-line">
      ${settings.lastBallCount || db.DEFAULT_BALL_COUNT} balls
      <span class="setup-sep">&bull;</span>${settings.lastClub}
      <span class="setup-sep">&bull;</span>${settings.lastSetup === 'tee' ? 'Tee' : 'Ground'}
      <span class="setup-sep">&bull;</span>${{ half: 'Half', 'three-quarter': '3/4', full: 'Full' }[settings.lastSwing] || 'Full'}
    </div>
    <button class="home-edit-setup" id="editSetupBtn">Edit setup <span>&rsaquo;</span></button>
  ` : '';

  let lastSessionHtml = '';
  if (recent && !activeSession) {
    const shots = db.getShotsForSession(recent.session_id);
    lastSessionHtml = `
      <div class="hairline"></div>
      <button class="home-last-session" id="lastSessionRow">
        ${icon(ICON_CLOCK)}
        <span class="home-last-session-text">Last session &middot; ${fmtDate(recent.date)} &middot; ${shots.length} balls &middot; ${escapeHtml(clubSummaryLabel(shots, recent.default_club))}</span>
        <span class="home-last-session-view">View <span>&rarr;</span></span>
      </button>`;
  }

  root.innerHTML = `
    <div class="screen home-screen">
      <div class="home-hero-bg">
        <img class="home-hero-img" src="graphics/home/range_hero.webp" alt="" />
        <div class="home-hero-scrim"></div>
        <div class="home-hero-content">
          <h1 class="home-brand-mark">NEXT BALL</h1>
          <div class="home-brand-tagline">Find your groove.</div>
        </div>
      </div>

      ${activeCardHtml}
      ${primaryBtnHtml}
      ${setupLineHtml}
      ${lastSessionHtml}
    </div>
  `;

  qs('#startBtn', root)?.addEventListener('click', () => {
    if (hasDefaults) startWithDefaults(settings);
    else location.hash = '#/start';
  });
  qs('#resumeBtn', root)?.addEventListener('click', () => { location.hash = '#/active'; });
  qs('#editSetupBtn', root)?.addEventListener('click', () => { location.hash = '#/start'; });
  qs('#lastSessionRow', root)?.addEventListener('click', () => { location.hash = `#/history/${recent.session_id}`; });
  qs('#endSessionBtn', root)?.addEventListener('click', () => openEndSessionSheet(activeSession, root));
}

// Ending/discarding from Home deliberately reuses the exact same
// finalization Active screen's own End Session uses (db.finishSession +
// wake-lock/weather cleanup) — this is not a competing implementation.
// Zero-shot sessions additionally go through the existing deleteSession()
// (built for History's Delete Session feature), which already refuses to
// delete an active/paused session as a safety guard; finishing first
// satisfies that guard cleanly rather than weakening it, so a 0-shot
// session never lingers as a visible empty History entry.
//
// Per explicit product decision: ending from Home stays on Home afterward
// (does NOT route through Session Check-In/Summary) — the user explicitly
// chose to end from Home, and check-in is a skippable ratings-only step
// with no other side effects, so nothing is lost by skipping it here.
function openEndSessionSheet(session, homeRoot) {
  const shots = db.getShotsForSession(session.session_id);
  const zeroShot = shots.length === 0;
  const title = zeroShot ? 'Discard this session?' : 'End this session?';
  const confirmLabel = zeroShot ? 'Discard Session' : 'End Session';
  const body = zeroShot
    ? 'No shots have been logged. This session will be removed.'
    : `You&rsquo;ve logged ${shots.length} of ${session.target_ball_count} balls.<br/>The session will be saved with the shots recorded so far.`;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="endSessionTitle" aria-describedby="endSessionBody">
      <h2 id="endSessionTitle">${title}</h2>
      <p id="endSessionBody" class="tiny muted" style="margin-bottom:var(--space-4);">${body}</p>
      <div class="stack">
        <button class="btn btn-outline" id="cancelEndBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmEndBtn" aria-label="${confirmLabel}, permanently">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#cancelEndBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelEndBtn', backdrop).addEventListener('click', close);

  qs('#confirmEndBtn', backdrop).addEventListener('click', () => {
    db.finishSession(session.session_id);
    if (zeroShot) {
      try { db.deleteSession(session.session_id); } catch (e) { /* best-effort — session is at least finished/inactive either way */ }
    }
    disableWakeLock();
    stopWeatherTracking();
    close();
    renderHome(homeRoot);
  });
}
