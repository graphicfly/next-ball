import * as db from '../db.js';
import { qs, fmtSetup, fmtSurface, fmtSwing, fmtDurationWords, escapeHtml, trapSheetFocus, todayLocalDate, nowLocalTime, presentSheet } from '../ui.js';
import { enableWakeLock, disableWakeLock } from '../wakeLock.js';
import { startWeatherTracking, stopWeatherTracking } from '../sessionWeather.js';
import { startLocationResolution } from '../sessionLocation.js';
import { finalizeSessionGoal } from '../sessionAnalysis.js';
import { isRangePracticable } from '../roundAnalysis.js';
import { setPendingPlanId } from '../state.js';
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
const ICON_TARGET_SMALL = '<circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" fill="currentColor" />';
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
  // Re-read rather than trusting the `activeSession` the render pass closed
  // over: that value is stale the instant a first tap creates a session, so
  // a double tap on the Home card used to create a second one — and every
  // session after the newest was orphaned, since Home only ever offers to
  // resume the latest. Checking live storage here makes the create
  // idempotent for any number of rapid taps, without a debounce timer on
  // the app's most-used control.
  const existing = db.getActiveSession();
  if (existing) { location.hash = '#/active'; return; }

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
// `focusText` is the Active Swing Focus, shown only on the Range card and
// only when one is set (lesson-spec.md §3.0).
//
// It takes the description's line rather than adding one of its own. Home
// at 393x664 already overflows with a saved plan, so an extra line here
// would make a measured problem worse — and the description it replaces is
// generic copy about what a range session is, while the focus is what this
// particular session is for. Same footprint, more information.
//
// It is deliberately NOT separately tappable: Current Focus is context for
// practice, not a third destination competing with the two session choices.
// The way to the lesson is History, where lessons live (§5A).
function choiceCardHtml({ id, variant, eyebrow, title, description, iconPaths, focusText = null }) {
  return `
    <button class="session-choice ${variant}" id="${id}">
      <span class="session-choice-badge">${icon(iconPaths)}</span>
      <span class="session-choice-text">
        <span class="session-choice-eyebrow">${eyebrow}</span>
        <span class="session-choice-title">${title}</span>
        ${focusText
          ? `<span class="session-choice-focus"><span class="session-choice-focus-label">Focus</span><span class="session-choice-focus-text">${escapeHtml(focusText)}</span></span>`
          : `<span class="session-choice-desc">${description}</span>`}
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

  // A saved practice plan is reachable from Home (§7.2) — without this a
  // plan saved today would be unfindable days later, which is the whole
  // point of persisting it. Deliberately a quiet row, not a third card: it
  // is a reminder, not a fourth thing competing with the two choices. It
  // opens the plan and never starts a session on its own.
  const activePlan = db.getActivePlan();
  const planRowHtml = (activePlan && !activeSession && !activeRound) ? `
    <button class="plan-row" id="savedPlanBtn">
      <span class="plan-row-badge">${icon(ICON_TARGET_SMALL)}</span>
      <span class="plan-row-text">
        <span class="plan-row-eyebrow">Practice plan saved</span>
        <span class="plan-row-title">${escapeHtml(activePlan.focus_title)}</span>
      </span>
      <span class="plan-row-chevron">&rsaquo;</span>
    </button>` : '';

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

  // Everything sits inside a .scroll container. Without one the screen
  // cannot scroll at all, so once the hero plus two choice cards grew
  // taller than the viewport — which they do on a real phone, where
  // Safari's own chrome takes a slice off the top and bottom — the last
  // card was simply clipped behind the bottom nav with no way to reach it.
  root.innerHTML = `
    <div class="screen home-screen">
      <div class="scroll home-scroll">
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
        focusText: db.getActiveSwingFocus()?.cue_text || null,
      })}
      ${choiceCardHtml({
        id: 'courseChoiceBtn',
        variant: 'secondary',
        eyebrow: 'PLAY',
        title: 'Course Session',
        description: 'Track holes, score, clubs used, and on-course notes.',
        iconPaths: ICON_COURSE_FLAG,
      })}

      ${planRowHtml}
      ${setupLineHtml}
      <div class="home-build-tag tiny center" id="buildTag">${BUILD_VERSION}</div>
      </div>
    </div>
  `;

  // TEMPORARY (V4.3 Phase 1 validation). An installed PWA has no address
  // bar, so an unlinked development route is unreachable from inside it —
  // which is exactly where the media tier has to be validated, since
  // storage persistence is granted differently for installed apps.
  //
  // Five taps on the build version. Deliberately obscure rather than
  // hidden-in-code: nothing is discoverable by accident, and it is one line
  // to remove along with the dev route and screen.
  let buildTaps = 0;
  let buildTapTimer = null;
  qs('#buildTag', root)?.addEventListener('click', () => {
    buildTaps += 1;
    clearTimeout(buildTapTimer);
    buildTapTimer = setTimeout(() => { buildTaps = 0; }, 2000);
    if (buildTaps >= 5) {
      buildTaps = 0;
      location.hash = '#/dev/media';
    }
  });

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
    // §7.7: the sheet appears ONLY when there is an outstanding plan that
    // can actually be practiced on a range. For the majority case — no plan
    // — this tap goes straight through exactly as it always has.
    if (activePlan && activePlan.status === 'saved' && isRangePracticable(activePlan.focus_type)) {
      openRangeStartSheet(activePlan, startRangeSession);
      return;
    }
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
  qs('#savedPlanBtn', root)?.addEventListener('click', () => { location.hash = `#/course/plan/${activePlan.round_id}`; });
  qs('#endSessionBtn', root)?.addEventListener('click', () => openEndSessionSheet(activeSession, () => renderHome(root)));
  qs('#endRoundBtn', root)?.addEventListener('click', () => openEndRoundSheet(activeRound, () => renderHome(root)));
}

// §7.7 — the choice between practicing the saved plan and an ordinary
// session. The plan is listed first and carries the accent, because it is
// the new information and the only reason this sheet exists; the normal
// session is a plain row directly beneath it.
//
// The plan is never forced: there is no auto-apply, no pre-selected option,
// and choosing the normal session leaves the plan completely untouched —
// still outstanding, still offered next time.
function openRangeStartSheet(plan, startNormal) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rangeStartTitle">
      <h2 id="rangeStartTitle">Start a range session</h2>
      <button class="plan-start-option" id="usePlanBtn">
        <span class="plan-start-badge">${icon(ICON_TARGET_SMALL)}</span>
        <span class="plan-start-text">
          <span class="plan-start-eyebrow">Use saved practice plan</span>
          <span class="plan-start-title">${escapeHtml(plan.focus_title)}</span>
          <span class="plan-start-sub">Created from your last round</span>
        </span>
        <span class="plan-start-chevron">&rsaquo;</span>
      </button>
      <button class="plan-start-option plain" id="normalSessionBtn">
        <span class="plan-start-text">
          <span class="plan-start-title">Start Normal Range Session</span>
        </span>
        <span class="plan-start-chevron">&rsaquo;</span>
      </button>
      <button class="btn btn-outline" id="cancelRangeStartBtn" style="margin-top:var(--space-2);">Cancel</button>
    </div>
  `;
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);

  function close() {
    untrap();
    backdrop.remove();
  }

  // Dismissing never applies the plan and never blocks the golfer — it
  // simply returns them to Home with everything as it was.
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelRangeStartBtn', backdrop).addEventListener('click', close);

  qs('#normalSessionBtn', backdrop).addEventListener('click', () => {
    close();
    startNormal();
  });

  qs('#usePlanBtn', backdrop).addEventListener('click', () => {
    close();
    // Session Setup is where the plan becomes a session: it pre-fills from
    // the plan and stays fully editable (§7.8). The plan is marked started
    // there, at the moment the session actually exists, so backing out of
    // Setup cannot strand it.
    setPendingPlanId(plan.plan_id);
    location.hash = '#/start';
  });
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
  resolvePlanForFinishedSession(session.session_id, shots.length);
  disableWakeLock();
  stopWeatherTracking();
}

// Completion is automatic — the golfer is never asked whether they finished
// their practice, and the app never grades adherence (§7.11).
//
// A session discarded with nothing logged is not practice, so its plan
// returns to `saved` rather than being marked completed: abandoning a
// session must never claim the plan was done, and the plan should still be
// waiting the next time the golfer goes to the range.
export function resolvePlanForFinishedSession(sessionId, shotCount) {
  const plan = db.getPlanForSession(sessionId);
  if (!plan || plan.status !== 'started') return null;
  if (shotCount > 0) return db.resolvePlan(plan.plan_id, 'completed');
  return db.reopenPlan(plan.plan_id);
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
  if (!presentSheet(backdrop)) return;
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
  if (!presentSheet(backdrop)) return;
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
  if (!presentSheet(backdrop)) return;
  const untrap = trapSheetFocus(backdrop, close);
  qs('#cancelEndBtn', backdrop).focus();

  function close() {
    untrap();
    backdrop.remove();
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  qs('#cancelEndBtn', backdrop).addEventListener('click', close);

  qs('#confirmEndBtn', backdrop).addEventListener('click', () => {
    // Goes through the one shared implementation rather than repeating it.
    // This sheet used to carry its own copy, which is exactly how a newly
    // added end-of-session step (resolving the practice plan) ended up
    // running on one finish path and not the other.
    finishActivity(session);
    close();
    onDone(zeroShot);
  });
}
