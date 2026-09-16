import * as db from '../db.js';
import { qs, fmtSetup, fmtSurface, fmtSwing, fmtDurationWords, escapeHtml, trapSheetFocus, todayLocalDate, nowLocalTime } from '../ui.js';
import { enableWakeLock, disableWakeLock } from '../wakeLock.js';
import { startWeatherTracking, stopWeatherTracking } from '../sessionWeather.js';
import { startLocationResolution } from '../sessionLocation.js';
import { finalizeSessionGoal } from '../sessionAnalysis.js';
import { BUILD_VERSION } from '../version.js';

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICON_CLOCK = '<circle cx="12" cy="13" r="8.5" /><path d="M12 9v4l3 2" /><path d="M9.5 3.2h5" />';
const ICON_PLAY = '<path d="M8 5.5v13l11-6.5Z" />';
const ICON_FLAG = '<path d="M6 21V4" /><path d="M6 4.5h12l-3 4 3 4H6" />';
// A pyramid of range balls in a tray — Reference A's Range Session badge.
const ICON_RANGE_BALLS = '<circle cx="12" cy="7.2" r="1.9" /><circle cx="9" cy="11.4" r="1.9" /><circle cx="15" cy="11.4" r="1.9" /><path d="M4.6 15h14.8l-2.2 4.6H6.8Z" />';
// A flagstick standing in a hole — Reference A's Course Session badge.
const ICON_COURSE_FLAG = '<path d="M9 19.5V5.2" /><path d="M9 5.2h8.4l-2.4 3 2.4 3H9" /><ellipse cx="9" cy="19.9" rx="4.6" ry="1.7" />';
const ICON_CHEVRON = '<path d="M9 5.5 15.5 12 9 18.5" />';
// Small, simple line glyphs for the compact session-metadata row — deliberately
// plainer than Active screen's illustrated context-strip icons (which carry
// their own fills/shading); this row is secondary context on Home, not the
// main event, so it stays minimal per the mockup.
const ICON_CLUB_SMALL = '<path d="M16.5 3.5 9 15" /><ellipse cx="7.7" cy="16.8" rx="2.6" ry="1.7" transform="rotate(-25 7.7 16.8)" />';
const ICON_LIE_SMALL = '<path d="M3 17c2.5-3.5 5-3.5 7.5 0s5 3.5 7.5 0" />';
const ICON_SURFACE_SMALL = '<rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)" />';
// Distinct from ICON_CLOCK (used for swing length above) — this one reads
// as "time elapsed," not "swing tempo," so the two meanings never share a
// glyph within the same metadata row.
const ICON_ELAPSED = '<path d="M7 3h10M7 21h10" /><path d="M7 3c0 4 3 5 5 6-2 1-5 2-5 6M17 3c0 4-3 5-5 6 2 1 5 2 5 6" />';

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

// Reference A's two choice cards. Both are entirely tappable with a trailing
// chevron; Range Session is the screen's single filled-accent primary and
// Course Session the secondary surface, because range practice remains the
// core loop and Course Mode is an additional path, not a replacement (§4.1).
function choiceCardHtml({ id, variant, eyebrow, title, description, iconPaths }) {
  return `
    <button class="session-choice ${variant}" id="${id}">
      <span class="session-choice-badge">${icon(iconPaths)}</span>
      <span class="session-choice-text">
        <span class="session-choice-eyebrow">${eyebrow}</span>
        <span class="session-choice-title">${title}</span>
        <span class="session-choice-desc">${description}</span>
      </span>
      <svg class="session-choice-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_CHEVRON}</svg>
    </button>`;
}

export function renderHome(root) {
  const activeSession = db.getActiveSession();
  // Only one activity may be active or paused at a time (§4.1). Both are
  // read here so the banner can name whichever one it is, and so tapping the
  // other choice card can warn about exactly what would end.
  const activeRound = db.getActiveRound();
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

    // Warning-soft fill + warning accent edge per docs/ux-spec.md §3.12 —
    // this slot sits directly under the hero as Home's brightest element
    // whenever a session is paused/in-progress, since it's the screen's
    // answer to "what do I do next." Resume stays accent green (the banner
    // itself is amber, the action is not); End Session is a plain tertiary
    // text action, never colored as a destructive/danger control — ending
    // a session with shots logged just saves it, it doesn't discard anything.
    const elapsedWords = fmtDurationWords((Date.now() - new Date(activeSession.created_at).getTime()) / 1000);

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
          ${elapsedWords ? metaItemHtml(icon(ICON_ELAPSED), elapsedWords) : ''}
        </div>
        <div class="hairline"></div>
        <button class="btn btn-primary btn-hero btn-log-shot" id="resumeBtn">${icon(ICON_PLAY)}<span>Resume Session</span></button>
        <button class="home-active-end tertiary-link" id="endSessionBtn" aria-label="${endLabel}" style="width:100%; margin-top:var(--space-2);">${endLabel}</button>
        <div class="home-active-end-note">${escapeHtml(endNote)}</div>
      </div>`;
  }

  // A paused round gets the same §3.12 banner treatment as a paused range
  // session, naming the round and the hole reached so the two are never
  // ambiguous.
  let activeRoundCardHtml = '';
  if (activeRound && !activeSession) {
    const holesPlayed = db.roundHolesPlayed(activeRound.round_id);
    const currentHole = Math.min(holesPlayed + 1, activeRound.hole_count);
    const zeroHole = holesPlayed === 0;
    const endLabel = zeroHole ? 'Discard Round' : 'End Round';
    const endNote = zeroHole
      ? 'No holes have been played.'
      : `Round will be saved with ${holesPlayed} hole${holesPlayed === 1 ? '' : 's'}.`;

    activeRoundCardHtml = `
      <div class="card home-active-card">
        <div class="home-active-header">
          <div class="home-active-icon">${icon(ICON_FLAG)}</div>
          <div class="home-active-header-text">
            <div class="home-active-eyebrow">Round in progress</div>
            <div class="home-active-ball">Hole ${currentHole} of ${activeRound.hole_count}</div>
          </div>
        </div>
        <div class="home-active-meta">
          ${activeRound.course_name ? metaItemHtml(icon(ICON_FLAG), activeRound.course_name) : ''}
        </div>
        <div class="hairline"></div>
        <button class="btn btn-primary btn-hero btn-log-shot" id="resumeRoundBtn">${icon(ICON_PLAY)}<span>Resume Round</span></button>
        <button class="home-active-end tertiary-link" id="endRoundBtn" aria-label="${endLabel}" style="width:100%; margin-top:var(--space-2);">${endLabel}</button>
        <div class="home-active-end-note">${escapeHtml(endNote)}</div>
      </div>`;
  }

  // The setup line stays available because "Edit setup" is the only route to
  // Session Setup for a returning golfer — tapping Range Session starts
  // immediately from saved defaults, exactly as Start Session does today
  // (§4.1, "existing Range Session behavior is unchanged"), so removing this
  // would take away the one chance to change club or ball count first.
  const setupLineHtml = (!activeSession && !activeRound && hasDefaults) ? `
    <div class="home-setup-line">
      ${settings.lastBallCount || db.DEFAULT_BALL_COUNT} balls
      <span class="setup-sep">&bull;</span>${settings.lastClub}
      <span class="setup-sep">&bull;</span>${settings.lastSetup === 'tee' ? 'Tee' : 'Ground'}
      <span class="setup-sep">&bull;</span>${{ half: 'Half', 'three-quarter': '3/4', full: 'Full' }[settings.lastSwing] || 'Full'}
    </div>
    <button class="home-edit-setup" id="editSetupBtn">Edit setup <span>&rsaquo;</span></button>
  ` : '';

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
      ${activeRoundCardHtml}

      <div class="session-choice-header">
        <div class="session-choice-heading">Choose your session</div>
        <div class="session-choice-sub">Where do you want to play today?</div>
      </div>

      ${choiceCardHtml({
        id: 'rangeChoiceBtn',
        variant: 'primary',
        eyebrow: 'PRACTICE',
        title: 'Range Session',
        description: 'Log shots, drills, training aids, and practice goals.',
        iconPaths: ICON_RANGE_BALLS,
      })}
      ${choiceCardHtml({
        id: 'courseChoiceBtn',
        variant: 'secondary',
        eyebrow: 'PLAY',
        title: 'Course Session',
        description: 'Track holes, score, clubs used, and on-course notes.',
        iconPaths: ICON_COURSE_FLAG,
      })}

      ${setupLineHtml}
      <div class="home-build-tag tiny center">${BUILD_VERSION}</div>
    </div>
  `;

  const startRangeSession = () => {
    if (hasDefaults) startWithDefaults(settings);
    else location.hash = '#/start';
  };

  qs('#rangeChoiceBtn', root).addEventListener('click', () => {
    // A paused ROUND blocks a new range session — one activity at a time.
    if (activeRound) {
      confirmSwitchActivity(root, {
        title: 'End your round first?',
        body: roundEndBody(activeRound),
        confirmLabel: 'End Round & Practice',
        onConfirm: () => { endRound(activeRound); startRangeSession(); },
      });
      return;
    }
    if (activeSession) { location.hash = '#/active'; return; }
    startRangeSession();
  });

  qs('#courseChoiceBtn', root).addEventListener('click', () => {
    if (activeRound) { location.hash = '#/course/round'; return; }
    if (activeSession) {
      confirmSwitchActivity(root, {
        title: 'End your range session first?',
        body: sessionEndBody(activeSession),
        confirmLabel: 'End Session & Play',
        onConfirm: () => {
          finishActivity(activeSession);
          location.hash = '#/course/select';
        },
      });
      return;
    }
    location.hash = '#/course/select';
  });

  qs('#resumeBtn', root)?.addEventListener('click', () => { location.hash = '#/active'; });
  qs('#resumeRoundBtn', root)?.addEventListener('click', () => { location.hash = '#/course/round'; });
  qs('#editSetupBtn', root)?.addEventListener('click', () => { location.hash = '#/start'; });
  qs('#endSessionBtn', root)?.addEventListener('click', () => openEndSessionSheet(activeSession, () => renderHome(root)));
  qs('#endRoundBtn', root)?.addEventListener('click', () => openEndRoundSheet(activeRound, () => renderHome(root)));
}

function sessionEndBody(session) {
  const shots = db.getShotsForSession(session.session_id);
  return shots.length === 0
    ? 'Your range session has no shots logged and will be discarded.'
    : `Your range session will be saved with ${shots.length} shot${shots.length === 1 ? '' : 's'}.`;
}

function roundEndBody(round) {
  const holes = db.roundHolesPlayed(round.round_id);
  return holes === 0
    ? 'Your round has no holes played and will be discarded.'
    : `Your round at ${escapeHtml(round.course_name)} will be saved with ${holes} hole${holes === 1 ? '' : 's'}.`;
}

// Ends a range session the same way Home's own End Session does, including
// discarding a session with nothing logged.
function finishActivity(session) {
  const shots = db.getShotsForSession(session.session_id);
  db.finishSession(session.session_id);
  finalizeSessionGoal(session.session_id);
  if (shots.length === 0) {
    try { db.deleteSession(session.session_id); } catch (e) { /* best-effort — it is at least finished */ }
  }
  disableWakeLock();
  stopWeatherTracking();
}

// Same rule for a round: a round with no holes played is discarded rather
// than kept as an empty record (§8).
function endRound(round) {
  const holes = db.roundHolesPlayed(round.round_id);
  db.finishRound(round.round_id);
  if (holes === 0) {
    try { db.deleteRound(round.round_id); } catch (e) { /* best-effort */ }
  }
  disableWakeLock();
}

// §4.1: the other choice card stays tappable while something is paused, but
// it never silently discards it — this names exactly what will end first.
function confirmSwitchActivity(root, { title, body, confirmLabel, onConfirm }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="switchActivityTitle" aria-describedby="switchActivityBody">
      <h2 id="switchActivityTitle">${title}</h2>
      <p id="switchActivityBody" class="tiny muted" style="margin-bottom:var(--space-4);">${body}<br/>Only one session or round can be in progress at a time.</p>
      <div class="stack">
        <button class="btn btn-outline" id="cancelSwitchBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmSwitchBtn">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#cancelSwitchBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelSwitchBtn', backdrop).addEventListener('click', close);
  qs('#confirmSwitchBtn', backdrop).addEventListener('click', () => {
    close();
    onConfirm();
  });
}

// The round-side counterpart to openEndSessionSheet — same confirmation
// shape, same zero-activity discard rule.
export function openEndRoundSheet(round, onDone) {
  const holes = db.roundHolesPlayed(round.round_id);
  const zeroHole = holes === 0;
  const title = zeroHole ? 'Discard this round?' : 'End this round?';
  const confirmLabel = zeroHole ? 'Discard Round' : 'End Round';
  const body = zeroHole
    ? 'No holes have been played. This round will be removed.'
    : `You&rsquo;ve played ${holes} of ${round.hole_count} holes.<br/>The round will be saved with the holes recorded so far.`;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="endRoundTitle" aria-describedby="endRoundBody">
      <h2 id="endRoundTitle">${title}</h2>
      <p id="endRoundBody" class="tiny muted" style="margin-bottom:var(--space-4);">${body}</p>
      <div class="stack">
        <button class="btn btn-outline" id="cancelEndRoundBtn">Cancel</button>
        <button class="btn btn-danger" id="confirmEndRoundBtn" aria-label="${confirmLabel}, permanently">${confirmLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const untrap = trapSheetFocus(backdrop, close);
  qs('#cancelEndRoundBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelEndRoundBtn', backdrop).addEventListener('click', close);
  qs('#confirmEndRoundBtn', backdrop).addEventListener('click', () => {
    endRound(round);
    close();
    onDone(zeroHole);
  });
}

// Shared by Home, Active, and Shot Entry — the single place "end/discard a
// session" is implemented, so every entry point gets the same confirmation
// and the same zero-shot cleanup. Zero-shot sessions go through the
// existing deleteSession() (built for History's Delete Session feature),
// which already refuses to delete an active/paused session as a safety
// guard; finishing first satisfies that guard cleanly rather than
// weakening it, so a 0-shot session never lingers as a visible empty
// History entry with fabricated 0% metrics.
//
// `onDone(zeroShot)` runs after the session is finished (and, if zeroShot,
// deleted) — callers decide where to go next: Home stays on Home (ending
// from Home is an explicit choice, and Check-In has nothing else to offer
// here), while Active/Shot Entry route to Check-In for a real session or
// straight back to Home for a discarded one.
export function openEndSessionSheet(session, onDone) {
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
    finalizeSessionGoal(session.session_id);
    if (zeroShot) {
      try { db.deleteSession(session.session_id); } catch (e) { /* best-effort — session is at least finished/inactive either way */ }
    }
    disableWakeLock();
    stopWeatherTracking();
    close();
    onDone(zeroShot);
  });
}
