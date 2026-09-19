import * as db from './db.js';
import * as media from './media.js';
import { assessQuality, effectiveFps } from './swingEvidence.js';
import { detectPhases } from './swingPhases.js';
import { measureSwing, buildObservations } from './swingMeasure.js';

// The analysis engine boundary (§25).
//
// One entry point. The UI hands over a swing video id and receives
// structured evidence; it never learns how landmarks are produced, and no
// screen contains analysis logic.
//
// LAZY BY CONSTRUCTION (§2). Nothing in this module is imported by the
// range path, and the pose model is fetched on first use — not at startup,
// not when a session begins, not when a video is recorded. A golfer who
// never analyses never downloads it.

export const ANALYSIS_VERSION = 1;
export const MEASUREMENT_VERSION = 1;

// Honest states, not a fake percentage (§20). Progress is reported as a
// fraction only during the passes, where frames analysed over frames
// planned is a real ratio.
export const STAGE = {
  PREPARING_VIDEO: 'preparing_video',
  FINDING_SWINGS: 'finding_swings',
  ANALYZING_MOVEMENT: 'analyzing_movement',
  BUILDING_RESULTS: 'building_results',
  COMPLETE: 'complete',
  FAILED: 'failed',
};

// Coarse pass samples every Nth frame to locate candidate swings; the dense
// pass then walks every frame of the chosen window only. The spike measured
// this turning ~87 s of work into 11 s + 2.6 s, which is why it is the
// architecture and not an optimisation (§3).
const COARSE_STEP = 6;
const DENSE_PADDING_S = 0.6;   // runway kept either side of a detected swing
const MIN_CANDIDATE_GAP_S = 1.5;

let poseModule = null;

// Loaded once, on demand. Kept behind a function so the import cost is paid
// by the first analysis and never by app startup.
async function loadPose() {
  if (poseModule) return poseModule;
  poseModule = await import('./swingPose.js');
  return poseModule;
}

export function isEngineLoaded() { return !!poseModule; }

// Locates candidate swings by sampling the clip coarsely and looking for
// bursts of hand or body speed.
//
// Candidates are RETURNED, never silently merged or discarded (§22). An
// in-session recording normally resolves to one; an imported range session
// may hold several, and each is independently analysable.
export function findCandidates(coarseSeries) {
  const pts = (coarseSeries || []).filter((f) => Array.isArray(f.landmarks));
  if (pts.length < 4) return [];

  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    const a = bodyPoint(pts[i - 1]);
    const b = bodyPoint(pts[i]);
    const dt = (pts[i].timeMs - pts[i - 1].timeMs) / 1000;
    if (!a || !b || dt <= 0) continue;
    speeds.push({ timeMs: pts[i].timeMs, v: Math.hypot(b.x - a.x, b.y - a.y) / dt });
  }
  if (!speeds.length) return [];

  const vmax = Math.max(...speeds.map((s) => s.v));
  if (vmax <= 0) return [];
  const threshold = vmax * 0.45;

  const peaks = speeds.filter((s) => s.v >= threshold);
  const candidates = [];
  for (const p of peaks) {
    const last = candidates[candidates.length - 1];
    // Peaks close together belong to one swing, not several.
    if (last && (p.timeMs - last.peakMs) / 1000 < MIN_CANDIDATE_GAP_S) {
      if (p.v > last.peak) { last.peakMs = p.timeMs; last.peak = p.v; }
      continue;
    }
    candidates.push({ peakMs: p.timeMs, peak: p.v });
  }

  return candidates.map((c, i) => ({
    index: i,
    peak_ms: c.peakMs,
    // A window wide enough to hold address through finish around the peak.
    start_ms: Math.max(0, c.peakMs - (1.4 + DENSE_PADDING_S) * 1000),
    end_ms: c.peakMs + (1.0 + DENSE_PADDING_S) * 1000,
    strength: +(c.peak / vmax).toFixed(3),
  }));
}

function bodyPoint(frame) {
  const l = frame.landmarks?.[15], r = frame.landmarks?.[16];
  if ((l?.visibility ?? 0) >= 0.5 && (r?.visibility ?? 0) >= 0.5) return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  // Falls back to the shoulder line, which the spike measured at 100% in
  // both views — the same resilience §7.1 requires of phase detection.
  const ls = frame.landmarks?.[11], rs = frame.landmarks?.[12];
  if ((ls?.visibility ?? 0) >= 0.5 && (rs?.visibility ?? 0) >= 0.5) return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  return null;
}

// Builds the evidence from an already-extracted landmark series.
//
// Separated from extraction so the whole deterministic layer — quality,
// capability, phases, measurements, observations — is testable without a
// browser, a camera or a model.
export function buildEvidence(series, { cameraView = 'unknown', fps = null, durationMs = null, window = null } = {}) {
  const quality = assessQuality(series, { fps, cameraView, durationMs });
  if (!quality.analysable) {
    return { quality, phases: [], measurements: [], observations: [], signals: null };
  }
  const { phases, signals } = detectPhases(series, { cameraView });
  const measurements = measureSwing(series, phases, quality, { cameraView });
  const observations = buildObservations(measurements, phases, quality);
  return { quality, phases, measurements, observations, signals, window };
}

// The public entry point.
//
// Returns structured evidence and persists a versioned record. Never
// throws: a failed analysis must leave the video and the shot untouched
// (§21), so every failure is a typed result the caller can act on.
export async function analyzeSwing(swingVideoId, { onStage, signal, candidateIndex = 0 } = {}) {
  const started = performance.now();
  const timing = { modelMs: null, coarseMs: null, denseMs: null, totalMs: null, framesAnalysed: 0 };
  const stage = (s, extra) => onStage?.(s, extra);

  const video = db.getSwingVideo(swingVideoId);
  if (!video) return fail('no_record', timing, started);

  stage(STAGE.PREPARING_VIDEO);
  const blob = await media.getMedia(video.media_ref);
  if (!blob) {
    // Discovering eviction is a side effect of trying to read; the record
    // says so rather than the analysis pretending the video is there.
    db.markSwingVideoMissing(swingVideoId);
    return fail('media_missing', timing, started);
  }

  let pose;
  try {
    const t0 = performance.now();
    pose = await loadPose();
    await pose.initPose();
    timing.modelMs = Math.round(performance.now() - t0);
  } catch (err) {
    return fail('engine_load_failed', timing, started, err);
  }

  try {
    const url = URL.createObjectURL(blob);
    try {
      stage(STAGE.FINDING_SWINGS);
      const t1 = performance.now();
      const coarse = await pose.extractSeries(url, { step: COARSE_STEP, signal, onProgress: (p) => stage(STAGE.FINDING_SWINGS, p) });
      timing.coarseMs = Math.round(performance.now() - t1);
      if (signal?.aborted) return fail('cancelled', timing, started);

      const candidates = findCandidates(coarse);
      const chosen = candidates[candidateIndex] || null;

      stage(STAGE.ANALYZING_MOVEMENT);
      const t2 = performance.now();
      const dense = await pose.extractSeries(url, {
        step: 1,
        startMs: chosen?.start_ms ?? 0,
        endMs: chosen?.end_ms ?? null,
        signal,
        onProgress: (p) => stage(STAGE.ANALYZING_MOVEMENT, p),
      });
      timing.denseMs = Math.round(performance.now() - t2);
      timing.framesAnalysed = dense.length;
      if (signal?.aborted) return fail('cancelled', timing, started);

      stage(STAGE.BUILDING_RESULTS);
      const evidence = buildEvidence(dense, {
        cameraView: video.camera_view,
        fps: video.fps,
        durationMs: video.duration_ms,
        window: chosen,
      });

      timing.totalMs = Math.round(performance.now() - started);
      const record = db.createSwingAnalysis({
        swing_video_id: swingVideoId,
        analysis_version: ANALYSIS_VERSION,
        measurement_version: MEASUREMENT_VERSION,
        pose_model: pose.MODEL_NAME,
        pose_model_version: pose.MODEL_VERSION,
        swing_window: chosen,
        camera_view: video.camera_view,
        source: { fps: video.fps, variable_frame_rate: video.variable_frame_rate, duration_ms: video.duration_ms, rotation_deg: video.rotation_deg, display_width: video.display_width, display_height: video.display_height },
        video_quality: evidence.quality,
        capability: evidence.quality.capability,
        detected_phases: evidence.phases,
        measurements: evidence.measurements,
        observations: evidence.observations,
        signals: evidence.signals,
        shot_id: video.shot_id ?? null,
        range_session_id: video.range_session_id ?? null,
        active_focus_snapshot: video.active_focus_snapshot ?? null,
        lesson_id: video.active_focus_snapshot?.lesson_id ?? null,
        timing,
      });

      stage(STAGE.COMPLETE);
      return { ok: true, analysis: record, candidates, timing };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    return fail('analysis_failed', timing, started, err);
  } finally {
    // The model stays loaded for a repeat analysis; the video's frames do
    // not. Releasing the decoder between runs is what keeps a phone from
    // accumulating memory across several swings.
    try { poseModule?.releaseDecoder?.(); } catch { /* best effort */ }
  }
}

function fail(reason, timing, started, err) {
  timing.totalMs = Math.round(performance.now() - started);
  if (err) console.warn('[swing-analysis]', reason, err);
  return { ok: false, reason, timing };
}
