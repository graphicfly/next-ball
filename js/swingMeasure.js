import { LM, VISIBLE, CONFIDENCE, CAPABILITY, supportLevel, roundForConfidence, lowerOf } from './swingEvidence.js';

// The measurement engine (swing-lab-spec.md §8.2).
//
// Only measurements the approved matrix lists, only in the views it lists
// them for, and only at the capability their timing requires. Nothing here
// judges a position, scores a swing, or compares the golfer to anyone —
// those are all explicitly out of scope, and two of them are things the
// spec forbids outright.
//
// SCALE (§12, §3.2). Two-dimensional video carries no absolute scale, so
// nothing is reported in inches. Everything spatial is BODY-RELATIVE — a
// fraction of shoulder width or stance width — which is scale-free,
// comparable between recordings, and honest. Fabricating inches from pixel
// scaling would be inventing a unit, and the unit is itself a claim.

// The approved matrix, as data. 'reliable' | 'approximate' | 'camera' |
// 'unsupported', straight from §8.2 including the corrections the spike
// forced on hand-derived measurements in Down-the-Line.
// Mirrors MAX_SCALE_DRIFT in swingAnalysis.js, kept here so this module
// stays independent of where the swing was located.
export const TRACKING_DRIFT_LIMIT = 1.5;

const MATRIX = {
  head_lateral:      { face_on: 'reliable',    down_the_line: 'approximate' },
  head_vertical:     { face_on: 'reliable',    down_the_line: 'reliable' },
  head_depth:        { face_on: 'unsupported', down_the_line: 'reliable' },
  posture_change:    { face_on: 'approximate', down_the_line: 'reliable' },
  shoulder_rotation: { face_on: 'approximate', down_the_line: 'camera' },
  hip_rotation:      { face_on: 'approximate', down_the_line: 'camera' },
  hip_sway:          { face_on: 'reliable',    down_the_line: 'unsupported' },
  hip_depth:         { face_on: 'unsupported', down_the_line: 'reliable' },
  knee_flex:         { face_on: 'approximate', down_the_line: 'approximate' },
  hand_path_range:   { face_on: 'reliable',    down_the_line: 'approximate' },
  elbow_spacing:     { face_on: 'reliable',    down_the_line: 'unsupported' },
  swing_duration:    { face_on: 'reliable',    down_the_line: 'reliable' },
  backswing_ms:      { face_on: 'reliable',    down_the_line: 'reliable' },
  downswing_ms:      { face_on: 'reliable',    down_the_line: 'reliable' },
  tempo_ratio:       { face_on: 'reliable',    down_the_line: 'reliable' },
};

const vis = (f, i) => (f?.landmarks?.[i]?.visibility ?? 0) >= VISIBLE;
const pt = (f, i) => (vis(f, i) ? f.landmarks[i] : null);

function pairMid(f, a, b) {
  const p = pt(f, a), q = pt(f, b);
  if (!p || !q) return null;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

// The scale everything spatial is expressed against. Shoulder width is the
// most reliably visible span in both views (§8.1: 100% in both), which is
// why it and not height is the reference.
function shoulderWidth(frames) {
  const widths = frames
    .map((f) => {
      const l = pt(f, LM.leftShoulder), r = pt(f, LM.rightShoulder);
      return l && r ? Math.hypot(l.x - r.x, l.y - r.y) : null;
    })
    .filter((w) => w && w > 0.01);
  if (!widths.length) return null;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

// Vertical extent, shoulders to ankles — the rotation-invariant ruler used
// to judge whether a frame shows the same body at the same distance. Falls
// back to the hips when the feet are out of shot.
function frameExtent(f) {
  const sh = midOf(pt(f, LM.leftShoulder), pt(f, LM.rightShoulder));
  const an = midOf(pt(f, LM.leftAnkle), pt(f, LM.rightAnkle));
  if (sh && an) return Math.abs(an.y - sh.y);
  const hp = midOf(pt(f, LM.leftHip), pt(f, LM.rightHip));
  if (sh && hp) return Math.abs(hp.y - sh.y);
  return 0;
}

function midOf(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function bodyExtent(frames) {
  const v = frames.map(frameExtent).filter((x) => x > 0.01).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

function measurement(key, { value, unit, confidence, note = null, method }) {
  return {
    key,
    value: roundForConfidence(value, confidence),
    unit,
    confidence,
    method,
    note,
    // A withheld measurement is present in the output with a null value, so
    // a consumer can tell "not supported here" from "not computed".
    withheld: confidence === CONFIDENCE.UNSUPPORTED || value == null,
  };
}

function rangeOf(frames, pick) {
  const vals = frames.map(pick).filter((v) => v != null && Number.isFinite(v));
  if (vals.length < 2) return null;
  return Math.max(...vals) - Math.min(...vals);
}

// Everything §8.2 approves, computed where the view, landmarks and timing
// allow, and explicitly withheld where they do not.
export function measureSwing(series, phases, quality, { cameraView = 'unknown', trackingDrift = 1 } = {}) {
  const view = cameraView;
  const out = [];
  if (!Array.isArray(series) || !series.length) return out;

  // Measure the SWING, not the window around it.
  //
  // The dense window deliberately carries runway either side so address and
  // finish are inside it — which means it also carries the golfer walking
  // in, setting up, and stepping away. Measuring across all of that
  // produced a head travel of 3.1 shoulder widths on real footage, which is
  // physically impossible and was the golfer entering frame, not moving
  // their head.
  //
  // So the span is address to finish where both were detected, and the
  // whole window only as a fallback.
  const byPhase = Object.fromEntries((phases || []).map((p) => [p.phase, p]));
  const startIdx = byPhase.address?.frame_index ?? 0;
  const endIdx = byPhase.finish?.frame_index ?? series.length - 1;
  const span = (endIdx > startIdx + 2) ? series.slice(startIdx, endIdx + 1) : series;

  const allFrames = span.filter((f) => Array.isArray(f.landmarks));
  if (!allFrames.length) return out;

  // Drop frames where the pose has jumped.
  //
  // MediaPipe tracks one person; on range footage it can latch onto a
  // different golfer in a neighbouring bay, or lose the subject and snap
  // back. Those frames are not the golfer moving, and including them
  // produced a head travel of 2.9 shoulder widths on real footage — an
  // impossible number that looks like a measurement.
  //
  // The tell is body SCALE: a golfer's shoulder width cannot change much
  // between adjacent frames, so a frame whose width departs sharply from
  // the clip's median is a different body or a broken detection.
  // Frames are kept or dropped on VERTICAL body extent, not shoulder width.
  // Shoulder width collapses as the shoulders turn, so filtering on it threw
  // away most of a real face-on swing and left too little to measure.
  const median = bodyExtent(allFrames);
  const frames = median
    ? allFrames.filter((f) => {
      const e = frameExtent(f);
      return e > 0 && e > median * 0.6 && e < median * 1.6;
    })
    : allFrames;
  if (!frames.length) return out;

  // How much of the window survived. A heavily filtered window means the
  // tracking was unstable, and everything built on it says so.
  const stability = allFrames.length ? frames.length / allFrames.length : 0;
  const scale = shoulderWidth(frames);
  const at = (name) => {
    const p = byPhase[name];
    return p && p.frame_index != null ? series[p.frame_index] : null;
  };
  // Every spatial measurement is expressed in shoulder widths, so it is
  // only as sound as the tracked body. Two things can undermine it: the
  // body's apparent size drifting across the window (TRACKING_DRIFT_LIMIT,
  // measured when the swing was located), and frames within the window
  // showing a body of the wrong size at all. On real range footage where
  // the golfer was too far from the camera, both were true and the result
  // was a head that travelled three shoulder widths. A number like that is
  // not a soft measurement to be hedged; it is not a measurement.
  const steady = trackingDrift <= TRACKING_DRIFT_LIMIT;
  const supportFor = (key, needs, requiresFull = false) => {
    const level = supportLevel({ view, needs, requiresFull, quality, matrix: MATRIX[key] });
    if (!steady || stability < 0.6) return CONFIDENCE.UNSUPPORTED;
    if (stability < 0.85) return lowerOf(level, CONFIDENCE.LOW);
    return level;
  };

  // ---- Posture / head ----
  // Body-relative, never inches (§3.2).
  const headX = (f) => { const n = pt(f, LM.nose); return n ? n.x : null; };
  const headY = (f) => { const n = pt(f, LM.nose); return n ? n.y : null; };

  const lateral = scale ? safeDiv(rangeOf(frames, headX), scale) : null;
  out.push(measurement('head_lateral', {
    value: lateral, unit: 'shoulder_widths',
    confidence: supportFor('head_lateral', ['head', 'shoulders']),
    method: 'nose_x_range_over_shoulder_width',
  }));

  const vertical = scale ? safeDiv(rangeOf(frames, headY), scale) : null;
  out.push(measurement('head_vertical', {
    value: vertical, unit: 'shoulder_widths',
    confidence: supportFor('head_vertical', ['head', 'shoulders']),
    method: 'nose_y_range_over_shoulder_width',
  }));

  // Depth is only observable when the camera looks down the target line.
  out.push(measurement('head_depth', {
    value: view === 'down_the_line' && scale ? safeDiv(rangeOf(frames, headX), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('head_depth', ['head', 'shoulders']),
    method: 'nose_x_range_dtl_proxy',
    note: view === 'face_on' ? 'Depth is not observable face-on.' : null,
  }));

  // ---- Rotation ----
  // Approximate at best, and never in degrees implying precision: rotation
  // about the vertical axis is poorly observed in 2D (§8.2 consequence 2).
  const shoulderSpan = (f) => {
    const l = pt(f, LM.leftShoulder), r = pt(f, LM.rightShoulder);
    return l && r ? Math.abs(l.x - r.x) : null;
  };
  const hipSpan = (f) => {
    const l = pt(f, LM.leftHip), r = pt(f, LM.rightHip);
    return l && r ? Math.abs(l.x - r.x) : null;
  };
  out.push(measurement('shoulder_rotation', {
    value: scale ? safeDiv(rangeOf(frames, shoulderSpan), scale) : null,
    unit: 'relative_change',
    confidence: supportFor('shoulder_rotation', ['shoulders']),
    method: 'shoulder_span_foreshortening',
    note: 'A 2D proxy for rotation, not an angle.',
  }));
  out.push(measurement('hip_rotation', {
    value: scale ? safeDiv(rangeOf(frames, hipSpan), scale) : null,
    unit: 'relative_change',
    confidence: supportFor('hip_rotation', ['hips']),
    method: 'hip_span_foreshortening',
    note: 'A 2D proxy for rotation, not an angle.',
  }));

  // ---- Lower body ----
  const hipX = (f) => { const m = pairMid(f, LM.leftHip, LM.rightHip); return m ? m.x : null; };
  out.push(measurement('hip_sway', {
    value: view === 'face_on' && scale ? safeDiv(rangeOf(frames, hipX), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('hip_sway', ['hips', 'shoulders']),
    method: 'hip_centre_x_range',
  }));
  out.push(measurement('hip_depth', {
    value: view === 'down_the_line' && scale ? safeDiv(rangeOf(frames, hipX), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('hip_depth', ['hips', 'shoulders']),
    method: 'hip_centre_x_range_dtl',
    note: view === 'down_the_line' ? 'Early-extension proxy.' : null,
  }));

  const kneeY = (f) => { const m = pairMid(f, LM.leftKnee, LM.rightKnee); return m ? m.y : null; };
  out.push(measurement('knee_flex', {
    value: scale ? safeDiv(rangeOf(frames, kneeY), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('knee_flex', ['knees', 'shoulders']),
    method: 'knee_centre_y_range',
  }));

  // ---- Arms / hands ----
  // Everything here inherits the wrist weakness the spike measured, and in
  // Down-the-Line that is severe.
  const handMid = (f) => pairMid(f, LM.leftWrist, LM.rightWrist);
  const handY = (f) => { const m = handMid(f); return m ? m.y : null; };
  out.push(measurement('hand_path_range', {
    value: scale ? safeDiv(rangeOf(frames, handY), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('hand_path_range', ['wrists', 'shoulders']),
    method: 'hand_centre_y_range',
  }));

  const elbowGap = (f) => {
    const l = pt(f, LM.leftElbow), r = pt(f, LM.rightElbow);
    return l && r ? Math.hypot(l.x - r.x, l.y - r.y) : null;
  };
  out.push(measurement('elbow_spacing', {
    value: view === 'face_on' && scale ? safeDiv(rangeOf(frames, elbowGap), scale) : null,
    unit: 'shoulder_widths',
    confidence: supportFor('elbow_spacing', ['elbows', 'shoulders']),
    method: 'elbow_separation_range',
  }));

  // ---- Tempo ----
  // Timing comes from real timestamps. Backswing, downswing and the ratio
  // all require Full capability: at 30 fps the fast phase is one to four
  // frames (§3.1, measured), so a ratio built on it is noise.
  const address = at('address'), top = at('top'), impact = at('impact'), finish = at('finish');
  const needsFull = quality.capability !== CAPABILITY.FULL;

  const totalMs = address && finish ? finish.timeMs - address.timeMs : null;
  out.push(measurement('swing_duration', {
    value: totalMs, unit: 'ms',
    // Total duration is frame timing only — it survives at Standard.
    confidence: supportFor('swing_duration', ['shoulders']),
    method: 'address_to_finish_timestamps',
  }));

  // A phase-detection failure produces a duration, not an error, and the
  // duration looks exactly like a measurement. A backswing of 17 ms once
  // reached the screen at HIGH confidence with a tempo of 0.0:1 beside it.
  // No golfer takes the club back in a sixtieth of a second, so a timing
  // outside human range is treated as evidence that the phases are wrong.
  const PLAUSIBLE_BACKSWING_MS = [200, 3000];
  const PLAUSIBLE_DOWNSWING_MS = [100, 1500];
  const plausible = (v, [lo, hi]) => (v != null && v >= lo && v <= hi ? v : null);

  const backswingMs = plausible(address && top ? top.timeMs - address.timeMs : null, PLAUSIBLE_BACKSWING_MS);
  out.push(measurement('backswing_ms', {
    value: backswingMs, unit: 'ms',
    confidence: supportFor('backswing_ms', ['shoulders'], true),
    method: 'address_to_top_timestamps',
    note: needsFull ? 'Withheld below 60 fps.' : null,
  }));

  const downswingMs = plausible(top && impact ? impact.timeMs - top.timeMs : null, PLAUSIBLE_DOWNSWING_MS);
  out.push(measurement('downswing_ms', {
    value: downswingMs, unit: 'ms',
    confidence: supportFor('downswing_ms', ['shoulders'], true),
    method: 'top_to_impact_timestamps',
    note: needsFull ? 'Withheld below 60 fps.' : null,
  }));

  const ratio = backswingMs && downswingMs && downswingMs > 0 ? backswingMs / downswingMs : null;
  out.push(measurement('tempo_ratio', {
    value: ratio, unit: 'ratio',
    confidence: supportFor('tempo_ratio', ['shoulders'], true),
    method: 'backswing_over_downswing',
    note: needsFull ? 'Withheld below 60 fps.' : null,
  }));

  return out;
}

function safeDiv(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

// Deterministic observations (§26).
//
// Descriptions of what was measured, never prescriptions. "Head position
// varied more during the downswing than at address" is an observation;
// "keep your head still" is coaching, and coaching belongs to the
// interpretation layer that does not exist yet and must respect the
// instructor's words when it does.
export function buildObservations(measurements, phases, quality) {
  const out = [];
  const byKey = Object.fromEntries((measurements || []).map((m) => [m.key, m]));
  const usable = (k) => byKey[k] && !byKey[k].withheld && byKey[k].confidence !== CONFIDENCE.LOW;

  // Said first, and said plainly, because it explains an otherwise empty
  // result and it is the one thing the golfer can act on while still
  // standing on the range: move the camera, not the swing.
  if (quality && quality.tracking_steady === false) {
    out.push({
      text: 'Your body could not be tracked steadily through this clip, so no positions were measured. '
        + 'This usually means the camera was too far away, the framing cut part of you off, or someone '
        + 'else moved through the shot. Film again from about 8 feet with your whole body in frame.',
      cites: ['tracking_drift'],
    });
  }

  if (usable('swing_duration')) {
    out.push({
      text: `The analysed swing lasted ${(byKey.swing_duration.value / 1000).toFixed(2)} seconds.`,
      cites: ['swing_duration'],
    });
  }
  if (usable('tempo_ratio')) {
    out.push({
      text: `Backswing to downswing ran about ${byKey.tempo_ratio.value.toFixed(1)} to 1.`,
      cites: ['tempo_ratio'],
    });
  }
  const impact = (phases || []).find((p) => p.phase === 'impact');
  if (impact && impact.exactness === 'approximate') {
    out.push({
      text: 'Impact is approximate at this frame rate — too few frames span the fastest part of the swing.',
      cites: ['impact'],
    });
  }
  if (quality?.visibility?.wrists != null && quality.visibility.wrists < 0.5) {
    out.push({
      text: `Hands were tracked in ${Math.round(quality.visibility.wrists * 100)}% of frames, so hand measurements are limited.`,
      cites: ['visibility.wrists'],
    });
  }
  return out;
}

// The single most notable thing the evidence supports (§26, "STOOD OUT").
//
// Ranked, deterministic, and never prescriptive. It describes what was
// measured and, where the footage limited the measurement, says so — which
// is itself the most useful thing to lead with when it is true.
//
// Everything here is a statement about THIS recording. Nothing compares the
// golfer to an ideal, and nothing infers mechanics from the shot result.
export function topObservation(measurements, phases, quality) {
  const by = Object.fromEntries((measurements || []).map((m) => [m.key, m]));
  const ok = (k) => by[k] && !by[k].withheld && by[k].value != null;
  const impact = (phases || []).find((p) => p.phase === 'impact');

  // 0. If the body was never tracked steadily, nothing below it is true.
  //    This has to lead, because the alternative is a screen that looks
  //    merely empty when it is actually telling the golfer to move the
  //    camera.
  if (quality?.tracking_steady === false) {
    return {
      text: 'Your body could not be tracked steadily in this clip, so nothing was measured. '
        + 'Film again from about 8 feet with your whole body in frame.',
      cites: ['tracking_drift'],
      kind: 'limitation',
    };
  }

  // 1. A tempo ratio is the most trustworthy number the system produces,
  //    so when the frames exist to support it, it leads.
  if (ok('tempo_ratio')) {
    return {
      text: `This swing had a ${by.tempo_ratio.value.toFixed(1)}:1 backswing-to-downswing tempo.`,
      cites: ['tempo_ratio'],
      kind: 'measurement',
    };
  }

  // 2. A limitation the golfer should know about beats a weaker number.
  if (quality?.visibility?.wrists != null && quality.visibility.wrists < 0.5) {
    return {
      text: `Your lower body tracked more reliably than your hands in this recording — hands were visible in ${Math.round(quality.visibility.wrists * 100)}% of frames.`,
      cites: ['visibility.wrists', 'visibility.hips'],
      kind: 'limitation',
    };
  }
  if (impact && impact.exactness === 'approximate' && quality?.capability === 'standard') {
    return {
      text: `Impact timing and fast hand movement are limited at ${Math.round(quality.effectiveFps || 30)} fps.`,
      cites: ['impact', 'capability'],
      kind: 'limitation',
    };
  }

  // 3. Head stability, stated as the measurement it is — a fraction of
  //    shoulder width — never as an instruction about keeping it still.
  if (ok('head_lateral') && ok('head_vertical')) {
    const worst = Math.max(by.head_lateral.value, by.head_vertical.value);
    const steady = worst < 0.25;
    return {
      text: steady
        ? 'Your head position stayed relatively stable through the swing.'
        : `Your head moved about ${worst.toFixed(2)} of a shoulder width through the swing.`,
      cites: ['head_lateral', 'head_vertical'],
      kind: 'measurement',
    };
  }

  if (ok('swing_duration')) {
    return {
      text: `The analysed swing lasted ${(by.swing_duration.value / 1000).toFixed(2)} seconds.`,
      cites: ['swing_duration'],
      kind: 'measurement',
    };
  }
  return null;
}

// Measurements grouped for display, with unsupported ones dropped entirely
// rather than rendered as empty cards.
export const MEASUREMENT_GROUPS = [
  { title: 'Head / Posture', keys: ['head_lateral', 'head_vertical', 'head_depth', 'posture_change'] },
  { title: 'Rotation', keys: ['shoulder_rotation', 'hip_rotation'] },
  { title: 'Lower Body', keys: ['hip_sway', 'hip_depth', 'knee_flex'] },
  { title: 'Arms / Hands', keys: ['hand_path_range', 'elbow_spacing'] },
];

export const MEASUREMENT_LABELS = {
  head_lateral: 'Side-to-side head movement',
  head_vertical: 'Up-and-down head movement',
  head_depth: 'Head toward / away from ball',
  posture_change: 'Posture change',
  shoulder_rotation: 'Shoulder turn (proxy)',
  hip_rotation: 'Hip turn (proxy)',
  hip_sway: 'Hip sway',
  hip_depth: 'Hip depth',
  knee_flex: 'Knee movement',
  hand_path_range: 'Hand path range',
  elbow_spacing: 'Elbow separation',
  swing_duration: 'Total swing',
  backswing_ms: 'Backswing',
  downswing_ms: 'Downswing',
  tempo_ratio: 'Ratio',
};

// Body-relative units read as a fraction of shoulder width, which is the
// honest description — never converted to inches (§12).
export function formatMeasurement(m) {
  if (!m || m.withheld || m.value == null) return null;
  if (m.unit === 'ms') return `${Math.round(m.value)} ms`;
  if (m.unit === 'ratio') return `${m.value.toFixed(1)}:1`;
  if (m.unit === 'shoulder_widths') return `${m.value.toFixed(2)} × shoulder width`;
  if (m.unit === 'relative_change') return `${m.value.toFixed(2)} (relative)`;
  return String(m.value);
}
