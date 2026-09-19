import { LM, VISIBLE, CONFIDENCE, CAPABILITY, supportLevel, roundForConfidence } from './swingEvidence.js';

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
export function measureSwing(series, phases, quality, { cameraView = 'unknown' } = {}) {
  const view = cameraView;
  const frames = (series || []).filter((f) => Array.isArray(f.landmarks));
  const out = [];
  if (!frames.length) return out;

  const scale = shoulderWidth(frames);
  const byName = Object.fromEntries((phases || []).map((p) => [p.phase, p]));
  const at = (name) => {
    const p = byName[name];
    return p && p.frame_index != null ? series[p.frame_index] : null;
  };
  const supportFor = (key, needs, requiresFull = false) =>
    supportLevel({ view, needs, requiresFull, quality, matrix: MATRIX[key] });

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

  const backswingMs = address && top ? top.timeMs - address.timeMs : null;
  out.push(measurement('backswing_ms', {
    value: backswingMs, unit: 'ms',
    confidence: supportFor('backswing_ms', ['shoulders'], true),
    method: 'address_to_top_timestamps',
    note: needsFull ? 'Withheld below 60 fps.' : null,
  }));

  const downswingMs = top && impact ? impact.timeMs - top.timeMs : null;
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
