// Swing capture — camera, arming, motion trigger and auto-stop.
//
// Every camera resource in the app is owned here, and the rule that governs
// all of it is simple: the camera runs only while the golfer has explicitly
// armed it, and stops the moment it is no longer needed. There is no
// background camera, no rolling buffer, and nothing recorded before arming
// (swing-lab-spec.md §21).
//
// Loaded lazily. A range session that never records must never pay for any
// of this — no camera, no stream, no permission prompt (§25).

// Recording is capped so a failed auto-stop cannot fill the device. Eight
// seconds is comfortably longer than address-to-finish plus runway, and
// short enough that the worst case costs a few megabytes rather than a
// gigabyte.
export const MAX_RECORDING_MS = 8000;

// Held after the trigger fires. A swing from takeaway to a settled finish is
// roughly 1.5-2.5 s (swing-lab-spec.md §3.1, §7.2); this keeps the whole of
// it plus follow-through, without recording the walk back to the bag.
export const POST_TRIGGER_MS = 3000;

// How long the armed state waits for a swing before giving up, so an
// abandoned arm does not hold the camera open indefinitely.
export const ARM_TIMEOUT_MS = 120000;

// Motion trigger. Frames are sampled small and compared cheaply — this is a
// frame-difference detector, not pose estimation. It never leaves the
// device, never records while armed, and only ever answers one question:
// did a lot of pixels just change?
const MOTION_SAMPLE_W = 64;
const MOTION_SAMPLE_H = 48;
const MOTION_INTERVAL_MS = 80;
// Fraction of sampled pixels that must change materially. Tuned to ignore
// breathing and a waggle while catching a takeaway; §23.4's alignment
// tolerance is the equivalent open question for this and wants real range
// testing before the number is treated as settled.
const MOTION_PIXEL_THRESHOLD = 28;
const MOTION_FRACTION = 0.06;
// Consecutive motion frames required, so a passing cart or a bird does not
// start a recording.
const MOTION_CONSECUTIVE = 2;

export const CAMERA_VIEWS = ['down_the_line', 'face_on'];

export const VIEW_COPY = {
  down_the_line: { label: 'Down the Line', hint: 'On the target line, about hand height.' },
  face_on: { label: 'Face On', hint: 'Facing you, about chest height.' },
};

// Preferred constraints. Frame rate is REQUESTED, never promised: §5 is
// explicit that the resulting media decides what capability the recording
// has, and the spike found iOS reports frame rate unreliably. Whatever
// arrives is measured afterwards and recorded as fact.
function constraintsFor() {
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 120, min: 30 },
    },
  };
}

// Picks a container the device will actually produce. Deliberately NOT
// canPlayType, which the spike found answers "unsupported" for formats iOS
// records and plays perfectly.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const type of candidates) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* keep trying */ }
  }
  return null;
}

let stream = null;
let recorder = null;

export function isStreaming() { return !!stream; }

// Opens the camera. Only ever called from a user action.
//
// Returns a typed reason rather than throwing, because every failure here is
// an ordinary thing a phone does — permission refused, camera busy with
// another app, no camera at all — and none of them may damage the range
// session (§4).
export async function openCamera() {
  if (stream) return { ok: true, stream, reused: true };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraintsFor());
    return { ok: true, stream };
  } catch (err) {
    stream = null;
    const name = err?.name || '';
    const reason = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
      : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable'
      : name === 'NotReadableError' ? 'in_use'
      : 'failed';
    return { ok: false, reason, error: name };
  }
}

// Stops every track. Called on cancel, on completion, on navigation away and
// on backgrounding — the camera light going out is the golfer's proof that
// nothing is watching.
export function closeCamera() {
  try { recorder?.state === 'recording' && recorder.stop(); } catch { /* already stopped */ }
  recorder = null;
  if (stream) {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    stream = null;
  }
}

// What the camera actually gave us, as opposed to what was asked for.
export function actualTrackSettings() {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.getSettings) return null;
  const s = track.getSettings();
  return { width: s.width ?? null, height: s.height ?? null, frameRate: s.frameRate ?? null };
}

// Watches for the start of a swing.
//
// Only runs while armed, and stops the instant it fires or is cancelled.
// Returns a stop() so every caller can guarantee teardown.
// The whole of the trigger decision, as a pure function over two frames.
//
// Extracted so it can be tested: the thresholds are the part most likely to
// be wrong, and they are the part hardest to exercise through a camera. It
// compares luma only, every fourth pixel — enough to see an arm move, cheap
// enough to run a dozen times a second on a phone.
export function frameChangeFraction(previous, frame) {
  if (!previous || !frame || previous.length !== frame.length) return 0;
  let changed = 0;
  let sampled = 0;
  for (let i = 0; i < frame.length; i += 16) {
    const a = (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
    const b = (previous[i] + previous[i + 1] + previous[i + 2]) / 3;
    if (Math.abs(a - b) > MOTION_PIXEL_THRESHOLD) changed += 1;
    sampled += 1;
  }
  return sampled ? changed / sampled : 0;
}

export function isMotion(previous, frame) {
  return frameChangeFraction(previous, frame) > MOTION_FRACTION;
}

export const MOTION_TUNING = {
  pixelThreshold: MOTION_PIXEL_THRESHOLD,
  fraction: MOTION_FRACTION,
  consecutive: MOTION_CONSECUTIVE,
  intervalMs: MOTION_INTERVAL_MS,
};

export function watchForSwingStart(video, onTrigger, { onTimeout } = {}) {
  let stopped = false;
  let previous = null;
  let consecutive = 0;
  const canvas = document.createElement('canvas');
  canvas.width = MOTION_SAMPLE_W;
  canvas.height = MOTION_SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const timeout = setTimeout(() => { if (!stopped) { stop(); onTimeout?.(); } }, ARM_TIMEOUT_MS);
  const interval = setInterval(() => {
    if (stopped) return;
    if (!video.videoWidth) return;
    try {
      ctx.drawImage(video, 0, 0, MOTION_SAMPLE_W, MOTION_SAMPLE_H);
      const frame = ctx.getImageData(0, 0, MOTION_SAMPLE_W, MOTION_SAMPLE_H).data;
      if (previous) {
        consecutive = isMotion(previous, frame) ? consecutive + 1 : 0;
        if (consecutive >= MOTION_CONSECUTIVE) { stop(); onTrigger(); return; }
      }
      previous = frame;
    } catch { /* a frame we cannot read is simply skipped */ }
  }, MOTION_INTERVAL_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    clearTimeout(timeout);
  }
  return stop;
}

// Records until stopped, auto-stopping after the swing window and hard-
// stopping at the safety cap.
//
// Resolves with a Blob and the timing that produced it, or a typed failure.
// Never rejects: a failed recording must leave the range session untouched.
export function recordSwing({ onStop } = {}) {
  return new Promise((resolve) => {
    if (!stream) { resolve({ ok: false, reason: 'no_stream' }); return; }
    const mimeType = pickMimeType();
    const chunks = [];
    const startedAt = performance.now();
    let settled = false;
    let autoStopTimer = null;
    let safetyTimer = null;

    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      resolve({ ok: false, reason: 'recorder_unsupported' });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(autoStopTimer);
      clearTimeout(safetyTimer);
      resolve(result);
    };

    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = () => finish({ ok: false, reason: 'recorder_error' });
    recorder.onstop = () => {
      const durationMs = Math.round(performance.now() - startedAt);
      const blob = new Blob(chunks, { type: mimeType || 'video/mp4' });
      onStop?.();
      if (!blob.size) { finish({ ok: false, reason: 'empty_recording', durationMs }); return; }
      finish({ ok: true, blob, mimeType: blob.type, durationMs, settings: actualTrackSettings() });
    };

    const stop = () => { try { recorder?.state === 'recording' && recorder.stop(); } catch { finish({ ok: false, reason: 'stop_failed' }); } };

    try { recorder.start(); } catch { finish({ ok: false, reason: 'start_failed' }); return; }

    // The normal path: stop once the swing has played out.
    autoStopTimer = setTimeout(stop, POST_TRIGGER_MS);
    // The guarantee: a failed auto-stop can never record indefinitely.
    safetyTimer = setTimeout(stop, MAX_RECORDING_MS);

    recordSwing.stopNow = stop;
  });
}

// Manual stop — "tap anywhere to stop" and the fallback when the trigger
// never fires.
export function stopRecording() {
  try { recordSwing.stopNow?.(); } catch { /* nothing recording */ }
}
