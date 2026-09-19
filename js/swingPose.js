// Pose extraction — the spike's proven approach, promoted to production.
//
// Loaded only by swingAnalysis.js, and only when a golfer chooses Analyze.
// Nothing here is imported by the range path.
//
// Three findings from the spike are encoded here rather than rediscovered:
//
//   1. Seek-stepping, not playback. requestVideoFrameCallback is bound to
//      playback, so when per-frame work is slower than realtime the video
//      runs on and frames are missed SILENTLY. The spike's first run
//      "succeeded" having analysed 2 frames of 145. Seeking advances only
//      when the previous frame's work has finished, so coverage does not
//      depend on how fast the model is.
//
//   2. Timestamps must never rewind. A landmarker keeps one clock for its
//      lifetime; restarting a pass at zero fails the whole graph and
//      surfaces as empty results that look exactly like "no golfer in
//      frame". The counter only ever moves forward.
//
//   3. Real frame times, not index/fps. The footage is variable frame rate,
//      so every sample carries the video's own currentTime (§4).

const VERSION = '0.10.14';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const MODEL_NAME = 'mediapipe_pose_landmarker_lite';
export const MODEL_VERSION = VERSION;

const SEEK_TIMEOUT_MS = 2500;
// A pass jumps the clock forward by this much, so successive passes stay
// monotonic without ever rewinding (finding 2).
const PASS_GAP_MS = 60000;

let landmarker = null;
let lastTs = 0;
let decoder = null;

export async function initPose() {
  if (landmarker) return { ok: true, reused: true };
  const vision = await import(/* @vite-ignore */ BUNDLE);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
  landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return { ok: true };
}

export function isReady() { return !!landmarker; }

export function closePose() {
  try { landmarker?.close?.(); } catch { /* best effort */ }
  landmarker = null;
}

// Frees the decoding <video> between passes. The model is kept — it is
// expensive to load and cheap to hold — but a decoder holding a 100 MB clip
// is not.
export function releaseDecoder() {
  if (!decoder) return;
  try {
    decoder.pause();
    decoder.removeAttribute('src');
    decoder.load();
  } catch { /* best effort */ }
  decoder = null;
}

function seekTo(video, seconds) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    // A seek that never lands must not hang the whole analysis.
    const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    try { video.currentTime = seconds; } catch { done(false); }
  });
}

// Walks a clip and returns a landmark series.
//
// `step` of 1 is the dense pass; larger values are the coarse scan. Frames
// carry the video's OWN timestamp, and the landmark coordinates are already
// normalised to the DISPLAYED orientation, because they come from the
// decoded frame the browser hands back — which has rotation metadata
// applied (§5). Container dimensions are recorded separately on the video
// and are never used for analysis coordinates.
export async function extractSeries(url, { step = 1, startMs = 0, endMs = null, signal, onProgress } = {}) {
  if (!landmarker) throw new Error('pose engine not initialised');

  const video = decoder || document.createElement('video');
  decoder = video;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  if (video.src !== url) video.src = url;

  await new Promise((resolve) => {
    if (video.readyState >= 1) { resolve(); return; }
    const done = () => { video.removeEventListener('loadedmetadata', done); resolve(); };
    video.addEventListener('loadedmetadata', done);
    setTimeout(done, 8000);
  });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration) return [];

  const from = Math.max(0, (startMs || 0) / 1000);
  const to = endMs != null ? Math.min(duration, endMs / 1000) : duration;
  // Nominal only, and only to decide where to sample. Every recorded
  // timestamp comes from the video itself.
  const nominalFps = 30;
  const stride = (step / nominalFps);
  const planned = Math.max(1, Math.ceil((to - from) / stride));

  const canvas = document.createElement('canvas');
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  // Downscaled for throughput; aspect preserved so normalised coordinates
  // stay true. MediaPipe returns 0-1 coordinates, so the analysis is
  // resolution-independent either way.
  const scale = Math.min(1, 480 / Math.max(w, h));
  canvas.width = Math.max(2, Math.round(w * scale));
  canvas.height = Math.max(2, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  const series = [];
  let done = 0;
  lastTs += PASS_GAP_MS;

  for (let t = from; t <= to + 1e-6; t += stride) {
    if (signal?.aborted) break;
    const landed = await seekTo(video, Math.min(t, Math.max(0, duration - 0.001)));
    done += 1;
    if (!landed) continue;

    // The video's own clock — correct under variable frame rate, where
    // index/fps would drift.
    const timeMs = video.currentTime * 1000;
    let result = null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const ts = Math.max(lastTs + 1, Math.round(timeMs) + lastTs);
      lastTs = ts;
      result = landmarker.detectForVideo(canvas, ts);
    } catch { /* an unreadable frame is skipped, not fatal */ }

    series.push({
      timeMs,
      landmarks: result?.landmarks?.[0] || null,
    });
    if (onProgress && done % 5 === 0) onProgress({ done, planned, fraction: Math.min(1, done / planned) });
  }
  onProgress?.({ done, planned, fraction: 1 });
  return series;
}
