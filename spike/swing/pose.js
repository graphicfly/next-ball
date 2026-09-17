// MediaPipe Tasks Vision loader — SPIKE ONLY.
//
// Loaded from a CDN as an ES module, which is the only way to use it in a
// repository with no build system. That constraint is real: MediaPipe's
// npm package expects a bundler, and the .mjs bundle is the escape hatch.
//
// A production version would vendor these files (as vendor/maplibre already
// is) and MUST NOT precache them — the model is several megabytes and the
// app shell is ~1 MB.

const VERSION = '0.10.14';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

// The landmarks swing-lab-spec.md §8.1 actually names. Everything else in
// the 33-point model is noise for this purpose.
export const GROUPS = {
  head: [0],
  shoulders: [11, 12],
  elbows: [13, 14],
  wrists: [15, 16],
  hips: [23, 24],
  knees: [25, 26],
  ankles: [27, 28],
};

let landmarker = null;
let loadedWith = null;

export async function initPose({ model = 'lite', delegate = 'GPU' } = {}) {
  const t0 = performance.now();
  const vision = await import(/* @vite-ignore */ BUNDLE);
  const tImport = performance.now();
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
  const tWasm = performance.now();
  landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.lite, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  const tReady = performance.now();
  loadedWith = { model, delegate };
  return {
    ok: true, model, delegate,
    importMs: Math.round(tImport - t0),
    wasmMs: Math.round(tWasm - tImport),
    modelMs: Math.round(tReady - tWasm),
    totalMs: Math.round(tReady - t0),
  };
}

export function isReady() { return !!landmarker; }
export function config() { return loadedWith; }

// MediaPipe's VIDEO running mode requires timestamps that only ever
// increase. It does not throw when they go backwards — it returns an empty
// result, which looks exactly like "no person in frame". A second analysis
// run over the same clip therefore reported zero landmarks on every frame
// and looked like a model failure rather than a misuse.
//
// So the caller's media time is used for ordering only, and a monotonic
// counter is what MediaPipe actually receives.
let lastTs = 0;

// Starting a new run must NOT rewind the counter. MediaPipe's graph keeps
// its own clock for the life of the landmarker, so sending a lower
// timestamp after a previous run does not start a new timeline — it fails
// the whole graph with "current minimum expected timestamp is 167001 but
// received 1000". Resetting to zero is the intuitive fix and it is wrong.
//
// Instead the counter jumps forward by a wide gap, which is monotonic (so
// the graph accepts it) and discontinuous (so per-frame tracking treats the
// next frame as a new scene rather than a continuation).
const RUN_GAP_MS = 60000;

export function resetTimeline() { lastTs += RUN_GAP_MS; }

export function detect(source, timestampMs) {
  if (!landmarker) throw new Error('pose not initialised');
  const ts = timestampMs > lastTs ? timestampMs : lastTs + 1;
  lastTs = ts;
  return landmarker.detectForVideo(source, ts);
}

export function close() {
  try { landmarker?.close?.(); } catch { /* best effort */ }
  landmarker = null;
}
