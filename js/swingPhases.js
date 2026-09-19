import { LM, VISIBLE, CONFIDENCE, lowerOf } from './swingEvidence.js';

// Swing checkpoint detection (swing-lab-spec.md §7, §7.1).
//
// The rule that shapes all of this: WRISTS ARE NOT LOAD-BEARING. The spike
// measured hand visibility at 67-73% Face-On and 42% Down-the-Line, worst
// near impact, where the hands pass behind the body. Detecting phases from
// hands alone would fail at exactly the moment that matters most, and it
// would fail quietly.
//
// So every phase has a primary signal and a fallback built on landmarks
// measured at 100% in both views — shoulders and hips. A phase found only
// by fallback is labelled approximate and carries lower confidence; a phase
// that cannot be found is ABSENT rather than guessed.

export const PHASES = ['address', 'takeaway', 'top', 'transition', 'downswing', 'impact', 'follow_through', 'finish'];

export const EXACTNESS = { EXACT: 'exact', APPROXIMATE: 'approximate', UNAVAILABLE: 'unavailable' };

// Midpoint of a landmark pair, or null when neither is visible enough to
// trust. Returning null rather than a default is deliberate: an invented
// coordinate propagates silently into every measurement downstream.
function midpoint(frame, aIdx, bIdx) {
  const a = frame.landmarks?.[aIdx];
  const b = frame.landmarks?.[bIdx];
  const aOk = (a?.visibility ?? 0) >= VISIBLE;
  const bOk = (b?.visibility ?? 0) >= VISIBLE;
  if (aOk && bOk) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vis: Math.min(a.visibility, b.visibility) };
  if (aOk) return { x: a.x, y: a.y, vis: a.visibility * 0.7 };
  if (bOk) return { x: b.x, y: b.y, vis: b.visibility * 0.7 };
  return null;
}

// A time series of one tracked point, with real timestamps carried through.
// Frames where the point is not visible become nulls rather than being
// dropped, so indices stay aligned with the source series.
function track(series, pick) {
  return series.map((f) => {
    const p = pick(f);
    return p ? { t: f.timeMs, x: p.x, y: p.y, vis: p.vis } : null;
  });
}

// Speed between consecutive visible samples, in normalised units per
// second. Timing comes from real timestamps, never from frame index over
// nominal fps — the footage is variable frame rate (§4).
function speedSeries(points) {
  const out = new Array(points.length).fill(null);
  let prev = null;
  let prevI = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (prev) {
      const dt = (p.t - prev.t) / 1000;
      if (dt > 0) out[i] = { t: p.t, v: Math.hypot(p.x - prev.x, p.y - prev.y) / dt, from: prevI, to: i };
    }
    prev = p; prevI = i;
  }
  return out;
}

function coverage(points) {
  const seen = points.filter(Boolean).length;
  return points.length ? seen / points.length : 0;
}

const phase = (name, frame, series, confidence, exactness, method) => ({
  phase: name,
  frame_index: frame,
  time_ms: frame != null && series[frame] ? series[frame].timeMs : null,
  confidence,
  exactness,
  detected_by: method,
});

const absent = (name, reason) => ({
  phase: name, frame_index: null, time_ms: null,
  confidence: CONFIDENCE.UNSUPPORTED, exactness: EXACTNESS.UNAVAILABLE, detected_by: reason,
});

// Detects checkpoints from a landmark series.
//
// `series` entries are { timeMs, landmarks } — real decoded timestamps, not
// frame indices scaled by a nominal rate.
export function detectPhases(series, { cameraView = 'unknown' } = {}) {
  if (!Array.isArray(series) || series.length < 5) {
    return { phases: PHASES.map((p) => absent(p, 'too_few_frames')), signals: null };
  }

  const hands = track(series, (f) => midpoint(f, LM.leftWrist, LM.rightWrist));
  const shoulders = track(series, (f) => midpoint(f, LM.leftShoulder, LM.rightShoulder));
  const hips = track(series, (f) => midpoint(f, LM.leftHip, LM.rightHip));

  const handCover = coverage(hands);
  const shoulderCover = coverage(shoulders);
  const hipCover = coverage(hips);

  // Hands lead only when they are actually there for most of the window.
  // Below that the body drives detection, which is the whole point of §7.1.
  const handsUsable = handCover >= 0.6;
  const primary = handsUsable ? hands : shoulders;
  const primaryName = handsUsable ? 'hands' : 'shoulders';

  if (coverage(primary) < 0.4 && hipCover < 0.4) {
    return { phases: PHASES.map((p) => absent(p, 'landmarks_not_tracked')), signals: null };
  }

  const speed = speedSeries(primary);
  const hipSpeed = speedSeries(hips);
  const valid = speed.filter(Boolean);
  if (!valid.length) return { phases: PHASES.map((p) => absent(p, 'no_motion_signal')), signals: null };

  const peak = valid.reduce((a, b) => (b.v > a.v ? b : a));
  const vmax = peak.v;
  const peakIndex = speed.findIndex((s) => s === peak);

  // Top FIRST, then address backwards from it.
  //
  // Searching forward from the start of the window for "the first motion"
  // finds the golfer walking into frame, setting up, or waggling — all of
  // which are motion. On real footage that put address 40 frames before the
  // swing and made head travel read as 3.1 shoulder widths, which was the
  // golfer arriving, not moving their head.
  //
  // The top is unambiguous (a direction reversal at the highest point), so
  // it anchors everything: address is the last settled frame in the second
  // or so before it, which is the address position by definition.
  const topIdx = findReversal(primary, 0, peakIndex);

  const quiet = vmax * 0.08;
  const ADDRESS_LOOKBACK_MS = 1600;
  const addressIdx = findAddress(speed, series, topIdx, quiet, ADDRESS_LOOKBACK_MS);
  let motionStart = addressIdx != null
    ? nextMovingAfter(speed, addressIdx, quiet)
    : speed.findIndex((s) => s && s.v > quiet);
  if (motionStart < 0) motionStart = addressIdx ?? 0;

  // Impact: maximum speed inside the downswing. At Standard capability this
  // is a window rather than a frame (§7.1), which the exactness records.
  const impactIdx = peakIndex >= 0 ? peakIndex : null;

  // Transition: lower body moving before the hands reverse (§7). Genuinely
  // hard below 120 fps, so it is reported approximate at best and absent
  // when the hips are not tracked.
  const transitionIdx = topIdx != null ? findHipLead(hipSpeed, topIdx) : null;

  const finishIdx = findSettle(speed, impactIdx ?? peakIndex, vmax);
  const takeawayIdx = motionStart >= 0 ? motionStart : null;
  const downswingIdx = topIdx != null && impactIdx != null && impactIdx > topIdx
    ? Math.round((topIdx + impactIdx) / 2) : null;
  const followIdx = impactIdx != null && finishIdx != null && finishIdx > impactIdx
    ? Math.round((impactIdx + finishIdx) / 2) : null;

  // Confidence floors. A body-derived detection is honest but coarser than
  // a hand-derived one, and everything anchored to it inherits that.
  const base = handsUsable ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
  const exact = handsUsable ? EXACTNESS.EXACT : EXACTNESS.APPROXIMATE;
  const method = `${primaryName}_kinematics`;

  // How many frames actually span the fast part decides whether impact can
  // claim precision at all. One frame at peak is the 30 fps reality the
  // spike measured, and it is reported as approximate rather than exact.
  const fastFrames = valid.filter((s) => s.v >= vmax * 0.75).length;
  const impactConfidence = fastFrames >= 4 ? base : lowerOf(base, CONFIDENCE.MEDIUM);
  const impactExact = fastFrames >= 4 ? exact : EXACTNESS.APPROXIMATE;

  const phases = [
    addressIdx != null ? phase('address', addressIdx, series, base, exact, `${method}:settled`) : absent('address', 'no_settled_frame'),
    takeawayIdx != null ? phase('takeaway', takeawayIdx, series, base, exact, `${method}:motion_onset`) : absent('takeaway', 'no_motion_onset'),
    topIdx != null ? phase('top', topIdx, series, base, exact, `${method}:reversal`) : absent('top', 'no_reversal'),
    transitionIdx != null
      ? phase('transition', transitionIdx, series, CONFIDENCE.LOW, EXACTNESS.APPROXIMATE, 'hip_lead')
      : absent('transition', hipCover < 0.5 ? 'hips_not_tracked' : 'not_resolvable'),
    downswingIdx != null ? phase('downswing', downswingIdx, series, base, EXACTNESS.APPROXIMATE, `${method}:descent`) : absent('downswing', 'no_window'),
    impactIdx != null ? phase('impact', impactIdx, series, impactConfidence, impactExact, `${method}:peak_speed`) : absent('impact', 'no_peak'),
    followIdx != null ? phase('follow_through', followIdx, series, base, EXACTNESS.APPROXIMATE, `${method}:post_impact`) : absent('follow_through', 'no_window'),
    finishIdx != null ? phase('finish', finishIdx, series, base, exact, `${method}:settle`) : absent('finish', 'no_settle'),
  ];

  return {
    phases,
    signals: {
      primary: primaryName,
      hand_coverage: +handCover.toFixed(3),
      shoulder_coverage: +shoulderCover.toFixed(3),
      hip_coverage: +hipCover.toFixed(3),
      peak_speed: +vmax.toFixed(3),
      frames_in_fast_phase: fastFrames,
      // The honest reason a golfer's DTL swing was detected from the body:
      // the hands were not there to detect it from.
      fell_back_to_body: !handsUsable,
    },
  };
}

// The last settled frame within a bounded lookback before the top. Bounded
// so that a walk-up, a practice swing or a long wait cannot become address.
function findAddress(speed, series, topIdx, quiet, lookbackMs) {
  if (topIdx == null) return null;
  const topTime = series[topIdx]?.timeMs ?? 0;
  let best = null;
  for (let i = topIdx - 1; i >= 0; i--) {
    const t = series[i]?.timeMs;
    if (t == null) continue;
    if (topTime - t > lookbackMs) break;
    const s = speed[i];
    // Settled, or not yet moving at all.
    if (!s || s.v <= quiet) { best = i; break; }
  }
  // Nothing settled inside the lookback: fall back to its far edge rather
  // than reaching back to the start of the clip.
  if (best == null) {
    for (let i = topIdx - 1; i >= 0; i--) {
      const t = series[i]?.timeMs;
      if (t != null && topTime - t > lookbackMs) return i + 1;
    }
    return 0;
  }
  return best;
}

function nextMovingAfter(speed, fromIdx, quiet) {
  for (let i = fromIdx + 1; i < speed.length; i++) {
    if (speed[i] && speed[i].v > quiet) return i;
  }
  return -1;
}

// Vertical direction reversal — the hands (or shoulders) stop rising and
// start descending. Searched between motion onset and peak speed, which
// brackets the backswing.
function findReversal(points, fromIdx, toIdx) {
  if (toIdx == null || toIdx <= fromIdx) return null;
  let bestIdx = null;
  let bestY = Infinity;
  for (let i = fromIdx; i <= toIdx; i++) {
    const p = points[i];
    if (!p) continue;
    // Normalised coordinates put the top of frame at 0, so the highest
    // point of the swing is the SMALLEST y.
    if (p.y < bestY) { bestY = p.y; bestIdx = i; }
  }
  return bestIdx;
}

// The lower body starting down before the top. Reported as a low-confidence
// approximation because §7 says it needs 120 fps to be meaningful.
function findHipLead(hipSpeed, topIdx) {
  const window = hipSpeed.slice(Math.max(0, topIdx - 6), topIdx + 1).filter(Boolean);
  if (window.length < 3) return null;
  const peak = window.reduce((a, b) => (b.v > a.v ? b : a));
  return hipSpeed.findIndex((s) => s === peak);
}

// Motion settling after impact.
function findSettle(speed, fromIdx, vmax) {
  if (fromIdx == null) return null;
  const quiet = vmax * 0.12;
  for (let i = fromIdx + 1; i < speed.length; i++) {
    const s = speed[i];
    if (s && s.v < quiet) return i;
  }
  return speed.length - 1;
}
