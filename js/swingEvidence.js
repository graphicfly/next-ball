// Capability, quality and confidence — the rules that decide what the
// engine is ALLOWED to say, before it says anything.
//
// Pure functions over a landmark series. No camera, no model, no DOM, so
// every rule here is testable, and the rules are where the mistakes would
// be: a measurement shown with false precision is worse than one withheld
// (swing-lab-spec.md §9).
//
// The layered vocabulary the brief names:
//
//   MEASUREMENT    what was calculated
//   OBSERVATION    a deterministic sentence supported by measurements
//   CONFIDENCE     how far either may be trusted
//   INTERPRETATION not here. A later phase, and never this one.

// Landmark indices, MediaPipe Pose (33 points). Only the groups
// swing-lab-spec.md §8.1 actually names.
export const LM = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

export const GROUPS = {
  head: [LM.nose],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  elbows: [LM.leftElbow, LM.rightElbow],
  wrists: [LM.leftWrist, LM.rightWrist],
  hips: [LM.leftHip, LM.rightHip],
  knees: [LM.leftKnee, LM.rightKnee],
  ankles: [LM.leftAnkle, LM.rightAnkle],
};

// A landmark below this is not evidence. Matches the spike's reporting
// threshold, so measured visibility percentages mean the same thing here.
export const VISIBLE = 0.5;

export const CAPABILITY = { STANDARD: 'standard', FULL: 'full' };
export const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNSUPPORTED: 'unsupported' };

// §3.1a: frame rate selects a capability level. It does not pass or fail a
// video — both real test clips were 30 fps, and rejecting them would have
// withheld everything from the footage golfers actually shoot.
export const FULL_CAPABILITY_MIN_FPS = 60;

// Effective temporal resolution, not the nominal number.
//
// iPhone footage is variable frame rate, so an average fps can be a figure
// that no part of the clip actually ran at. Where real frame timestamps
// exist they decide; the container's average is the fallback.
export function effectiveFps(series, fallbackFps = null) {
  const times = (series || []).map((f) => f.timeMs).filter((t) => Number.isFinite(t));
  if (times.length < 3) return fallbackFps;
  const deltas = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return fallbackFps;
  // Median rather than mean: one long gap from a dropped frame should not
  // drag the whole estimate down.
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median > 0 ? +(1000 / median).toFixed(3) : fallbackFps;
}

// Per-group visibility across the analysed window, as a fraction of frames
// in which the group was tracked above VISIBLE.
export function groupVisibility(series) {
  const out = {};
  const frames = (series || []).filter((f) => Array.isArray(f.landmarks));
  for (const [name, idx] of Object.entries(GROUPS)) {
    if (!frames.length) { out[name] = 0; continue; }
    let seen = 0;
    for (const f of frames) {
      const vals = idx.map((i) => f.landmarks[i]?.visibility ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (mean >= VISIBLE) seen += 1;
    }
    out[name] = +(seen / frames.length).toFixed(3);
  }
  return out;
}

// What the recording can support, described as capabilities rather than as
// a verdict on the video (§14). A usable 30 fps clip is Standard, not bad.
export function assessQuality(series, { fps = null, cameraView = 'unknown', durationMs = null } = {}) {
  const frames = (series || []).filter((f) => Array.isArray(f.landmarks));
  const total = (series || []).length;
  const coverage = total ? +(frames.length / total).toFixed(3) : 0;
  const visibility = groupVisibility(series);
  const effFps = effectiveFps(series, fps);

  const issues = [];
  // A body the model cannot find in most frames is the one condition that
  // genuinely blocks analysis.
  if (coverage < 0.5) issues.push('subject_not_tracked');
  if (frames.length < 8) issues.push('too_few_frames');
  if (visibility.hips < VISIBLE) issues.push('lower_body_not_visible');
  if (durationMs != null && durationMs < 500) issues.push('clip_too_short');

  const analysable = !issues.includes('subject_not_tracked') && !issues.includes('too_few_frames');
  const capability = (effFps != null && effFps >= FULL_CAPABILITY_MIN_FPS - 1)
    ? CAPABILITY.FULL
    : CAPABILITY.STANDARD;

  return {
    analysable,
    capability,
    effectiveFps: effFps,
    nominalFps: fps,
    poseCoverage: coverage,
    framesWithPose: frames.length,
    framesTotal: total,
    visibility,
    cameraView,
    issues,
  };
}

// Whether a measurement is supported at all, before any number exists.
//
// Three gates, and a measurement must clear all of them: the view must
// support it (§8.2's matrix), the landmarks it needs must actually be
// visible, and the temporal resolution must be sufficient when it is a
// timing measurement.
export function supportLevel({ view, needs = [], requiresFull = false, quality, matrix }) {
  const viewSupport = matrix?.[view];
  if (!viewSupport || viewSupport === 'unsupported') return CONFIDENCE.UNSUPPORTED;
  if (requiresFull && quality.capability !== CAPABILITY.FULL) return CONFIDENCE.UNSUPPORTED;

  const vis = needs.map((g) => quality.visibility[g] ?? 0);
  const worst = vis.length ? Math.min(...vis) : 1;
  if (worst < 0.35) return CONFIDENCE.UNSUPPORTED;

  // The view's own ceiling caps everything built on it: an approximate
  // landmark cannot produce a reliable number however clean the frames are.
  const ceiling = viewSupport === 'reliable' ? CONFIDENCE.HIGH
    : viewSupport === 'approximate' ? CONFIDENCE.MEDIUM
    : CONFIDENCE.LOW;

  const observed = worst >= 0.85 ? CONFIDENCE.HIGH
    : worst >= 0.6 ? CONFIDENCE.MEDIUM
    : CONFIDENCE.LOW;

  return lowerOf(ceiling, observed);
}

const ORDER = [CONFIDENCE.UNSUPPORTED, CONFIDENCE.LOW, CONFIDENCE.MEDIUM, CONFIDENCE.HIGH];
export function lowerOf(a, b) {
  return ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
}

// How many decimals a confidence level earns.
//
// §9: never show a low-confidence value with false numerical precision. A
// number is a claim about how well something was measured, and the decimals
// are part of the claim.
export function roundForConfidence(value, confidence) {
  if (value == null || !Number.isFinite(value)) return null;
  if (confidence === CONFIDENCE.HIGH) return +value.toFixed(2);
  if (confidence === CONFIDENCE.MEDIUM) return +value.toFixed(1);
  if (confidence === CONFIDENCE.LOW) return Math.round(value);
  return null;
}
