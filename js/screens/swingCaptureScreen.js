import * as db from '../db.js';
import { qs, qsa, escapeHtml, toast } from '../ui.js';
import * as capture from '../swingCapture.js';
import * as swingMedia from '../swingMedia.js';
import { getSessionCameraView, setSessionCameraView, clearSessionCameraView, setLastCapturedSwing } from '../state.js';
import { buildRecordingContext } from '../swingContext.js';

// Swing capture — Camera Setup, Armed and Recording.
//
// One screen holding three states, because they are one continuous act from
// the golfer's point of view: point the phone, step in, swing. Splitting
// them across routes would tear down and rebuild the camera between each.
//
// The camera is open only while this screen is. Leaving it by any route —
// Cancel, back, navigation, backgrounding — closes it.

const STATE = { SETUP: 'setup', ARMED: 'armed', RECORDING: 'recording', SAVING: 'saving' };

const ERROR_COPY = {
  denied: 'Camera access is off for Next Ball. Turn it on in Settings to record swings.',
  unavailable: 'No camera is available on this device.',
  in_use: 'The camera is busy in another app.',
  unsupported: 'This browser cannot record video.',
  failed: 'The camera could not be opened.',
};

export function renderSwingCapture(root) {
  const session = db.getActiveSession();
  // Recording belongs to a live range session; without one there is no
  // context to attach a swing to.
  if (!session) { location.hash = '#/home'; return; }

  const club = session.current_club || session.default_club || '';
  let view = getSessionCameraView() || 'down_the_line';
  let state = getSessionCameraView() ? STATE.ARMED : STATE.SETUP;
  let stopWatching = null;
  let teardownDone = false;
  const myHash = location.hash;

  // Everything that must stop, in one place, so no exit path can leak the
  // camera. Idempotent — several of these fire together on navigation.
  function teardown() {
    if (teardownDone) return;
    teardownDone = true;
    try { stopWatching?.(); } catch { /* already stopped */ }
    stopWatching = null;
    capture.closeCamera();
    window.removeEventListener('hashchange', onHashChange);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function onHashChange() {
    if (location.hash !== myHash) teardown();
  }
  // Backgrounding while armed or recording must release the camera. iOS may
  // tear the stream down anyway; doing it deliberately means the state the
  // golfer returns to is one we chose.
  function onVisibility() {
    if (document.visibilityState !== 'hidden') return;
    if (state === STATE.RECORDING) capture.stopRecording();
    else if (state === STATE.ARMED) { teardown(); location.hash = '#/active'; }
  }
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('visibilitychange', onVisibility);

  function shell(inner) { root.innerHTML = `<div class="screen capture-screen">${inner}</div>`; }

  // ---------- Camera Setup (frame 2) ----------
  function renderSetup() {
    state = STATE.SETUP;
    shell(`
      <div class="capture-stage">
        <video id="preview" playsinline muted autoplay class="capture-video"></video>
        <div class="capture-guide" aria-hidden="true"><span class="capture-guide-line"></span></div>
        <div class="capture-error" id="cameraError" hidden></div>
      </div>
      <div class="capture-panel">
        <div class="capture-views" role="radiogroup" aria-label="Camera view">
          ${capture.CAMERA_VIEWS.map((v) => `
            <button class="capture-view ${v === view ? 'selected' : ''}" role="radio"
                    aria-checked="${v === view}" data-view="${v}">
              ${escapeHtml(capture.VIEW_COPY[v].label)}
            </button>`).join('')}
        </div>
        <p class="capture-hint" id="viewHint">${escapeHtml(capture.VIEW_COPY[view].hint)}</p>
        <button class="btn btn-primary btn-hero" id="useSetupBtn">Use This Setup</button>
        <button class="capture-cancel" id="cancelBtn">Cancel</button>
      </div>
    `);

    qsa('.capture-view', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        view = btn.dataset.view;
        qsa('.capture-view', root).forEach((b) => {
          const on = b === btn;
          b.classList.toggle('selected', on);
          b.setAttribute('aria-checked', String(on));
        });
        qs('#viewHint', root).textContent = capture.VIEW_COPY[view].hint;
      });
    });

    qs('#useSetupBtn', root).addEventListener('click', () => {
      setSessionCameraView(view);
      renderArmed();
    });
    qs('#cancelBtn', root).addEventListener('click', exit);
    startPreview();
  }

  async function startPreview() {
    const res = await capture.openCamera();
    if (!res.ok) { showCameraError(res.reason); return; }
    const el = qs('#preview', root);
    if (!el) return;              // navigated away while the prompt was up
    el.srcObject = res.stream;
    try { await el.play(); } catch { /* autoplay blocked; controls still work */ }
  }

  function showCameraError(reason) {
    const box = qs('#cameraError', root);
    if (!box) return;
    box.hidden = false;
    box.textContent = ERROR_COPY[reason] || ERROR_COPY.failed;
    // A camera that cannot open must not strand the golfer in a dead screen.
    const cta = qs('#useSetupBtn', root);
    if (cta) cta.disabled = true;
    clearSessionCameraView();
  }

  // ---------- Armed (frame 3) ----------
  function renderArmed() {
    state = STATE.ARMED;
    shell(`
      <div class="capture-stage">
        <video id="preview" playsinline muted autoplay class="capture-video dim"></video>
        <div class="capture-context">${escapeHtml(capture.VIEW_COPY[view].label)}${club ? ` &middot; ${escapeHtml(club)}` : ''}</div>
        <div class="capture-center" role="status" aria-live="polite">
          <div class="capture-pulse" aria-hidden="true"><span></span></div>
          <div class="capture-state ready">READY</div>
          <p class="capture-copy">Step into position<br/>and take your swing.</p>
        </div>
      </div>
      <div class="capture-panel">
        <p class="capture-hint">Starts when you move &middot;
          <button class="capture-link" id="changeSetupBtn">Change setup</button>
        </p>
        <button class="capture-cancel" id="cancelBtn">Cancel</button>
      </div>
    `);

    qs('#changeSetupBtn', root).addEventListener('click', () => {
      stopWatching?.();
      stopWatching = null;
      clearSessionCameraView();
      renderSetup();
    });
    qs('#cancelBtn', root).addEventListener('click', exit);
    armCamera();
  }

  async function armCamera() {
    const res = await capture.openCamera();
    if (!res.ok) { renderSetup(); setTimeout(() => showCameraError(res.reason), 0); return; }
    const el = qs('#preview', root);
    if (!el) return;
    el.srcObject = res.stream;
    try { await el.play(); } catch { /* preview only */ }

    stopWatching = capture.watchForSwingStart(el, () => {
      stopWatching = null;
      renderRecording();
    }, {
      // An arm left running is not an error; it just stops waiting.
      onTimeout: () => { toast('Recording cancelled'); exit(); },
    });
  }

  // ---------- Recording (frame 4) ----------
  function renderRecording() {
    state = STATE.RECORDING;
    shell(`
      <div class="capture-stage" id="stopSurface">
        <video id="preview" playsinline muted autoplay class="capture-video dim"></video>
        <div class="capture-context">${escapeHtml(capture.VIEW_COPY[view].label)}${club ? ` &middot; ${escapeHtml(club)}` : ''}</div>
        <div class="capture-center" role="status" aria-live="assertive">
          <div class="capture-dot" aria-hidden="true"></div>
          <div class="capture-state recording">RECORDING</div>
          <p class="capture-copy">Take your swing.<br/>This stops on its own.</p>
        </div>
      </div>
      <div class="capture-panel">
        <p class="capture-hint">Tap anywhere to stop</p>
      </div>
    `);

    reattachPreview();

    // The manual fallback, on the whole stage rather than a button — the
    // golfer is stepping back to the phone, not aiming at a target.
    const stopNow = () => capture.stopRecording();
    qs('#stopSurface', root).addEventListener('click', stopNow);
    qs('#stopSurface', root).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stopNow(); }
    });

    capture.recordSwing().then(onRecordingComplete);
  }

  async function reattachPreview() {
    const el = qs('#preview', root);
    if (!el) return;
    const res = await capture.openCamera();     // reuses the open stream
    if (res.ok) { el.srcObject = res.stream; try { await el.play(); } catch { /* preview only */ } }
  }

  // ---------- Save ----------
  async function onRecordingComplete(result) {
    if (location.hash !== myHash) { teardown(); return; }
    state = STATE.SAVING;

    if (!result.ok) {
      teardown();
      // A failed recording is told plainly and costs the golfer nothing.
      toast(result.reason === 'empty_recording' ? 'Nothing was recorded' : "That swing couldn't be recorded");
      location.hash = '#/active';
      return;
    }

    shell(`
      <div class="capture-stage">
        <div class="capture-center" role="status" aria-live="polite">
          <div class="capture-state">SAVING</div>
          <p class="capture-copy">Keeping your swing.</p>
        </div>
      </div>
    `);
    // The camera is closed before the save, not after: the golfer should see
    // the light go out as soon as there is nothing left to film.
    capture.closeCamera();

    const live = db.getActiveSession() || session;
    const saved = await swingMedia.importSwingVideo(result.blob, {
      range_session_id: live.session_id,
      club: live.current_club || live.default_club || null,
      camera_view: view,
      // A COPY of everything true at the moment of recording. Session
      // defaults change during a session; this must not (§10).
      practice_context: buildRecordingContext(live),
      active_focus_snapshot: db.swingFocusSnapshot(),
      association_state: 'pending',
    });

    teardown();

    if (!saved.ok) {
      toast(saved.reason === 'quota' ? 'Not enough storage for that swing' : "That swing couldn't be saved");
      location.hash = '#/active';
      return;
    }

    // Pending until the next shot is logged — never attached backwards.
    db.setPendingSwingVideo(saved.video.swing_video_id);
    setLastCapturedSwing(saved.video.swing_video_id);
    location.hash = '#/active';
  }

  function exit() {
    teardown();
    location.hash = '#/active';
  }

  if (state === STATE.ARMED) renderArmed(); else renderSetup();
}
