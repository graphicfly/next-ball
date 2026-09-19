import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import { LM, CONFIDENCE, CAPABILITY, assessQuality, effectiveFps, groupVisibility, roundForConfidence } from '../js/swingEvidence.js';
import { detectPhases } from '../js/swingPhases.js';
import { measureSwing, buildObservations, topObservation } from '../js/swingMeasure.js';
import { buildEvidence, findCandidates } from '../js/swingAnalysis.js';

// The deterministic evidence layer.
//
// All of this is pure functions over a landmark series, which is the point:
// the pose model needs a browser, but the rules that decide what the engine
// is ALLOWED to say do not, and those rules are where the damage would be.
// A measurement shown with false precision is worse than one withheld.

// ---- synthetic swing builder -------------------------------------------
// Produces a landmark series shaped like a real swing: settle, backswing,
// a fast downswing, settle again. Visibility is controllable per group so
// wrist occlusion can be reproduced exactly as the spike measured it.
function makeSwing({
  fps = 30, durationS = 3, wristVis = 0.9, hipVis = 0.95,
  shoulderVis = 0.99, peakAtS = 1.6, view = 'face_on',
} = {}) {
  const n = Math.round(fps * durationS);
  const series = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // Hands: rise to the top just before the peak, then sweep down fast.
    const toPeak = (t - peakAtS);
    const backswing = Math.max(0, 1 - Math.abs(t - (peakAtS - 0.6)) / 0.7);
    const handY = t < peakAtS - 0.6 ? 0.62 - backswing * 0.35
      : t < peakAtS ? 0.27 + (t - (peakAtS - 0.6)) * 0.55
        : Math.min(0.75, 0.6 + toPeak * 0.4);
    const handX = 0.5 + Math.sin(t * 2.2) * 0.08;
    const sway = Math.sin(t * 1.4) * 0.012;

    const p = (x, y, v) => ({ x, y, z: 0, visibility: v });
    const landmarks = new Array(33).fill(null).map(() => p(0.5, 0.5, 0.2));
    landmarks[LM.nose] = p(0.5 + sway * 1.2, 0.18 + Math.abs(sway) * 0.4, 0.98);
    landmarks[LM.leftShoulder] = p(0.42 + sway, 0.33, shoulderVis);
    landmarks[LM.rightShoulder] = p(0.58 + sway, 0.33, shoulderVis);
    landmarks[LM.leftElbow] = p(0.40 + sway, 0.45, 0.8);
    landmarks[LM.rightElbow] = p(0.60 + sway, 0.45, 0.8);
    landmarks[LM.leftWrist] = p(handX - 0.02, handY, wristVis);
    landmarks[LM.rightWrist] = p(handX + 0.02, handY, wristVis);
    landmarks[LM.leftHip] = p(0.45 + sway, 0.58, hipVis);
    landmarks[LM.rightHip] = p(0.55 + sway, 0.58, hipVis);
    landmarks[LM.leftKnee] = p(0.45, 0.75, 0.9);
    landmarks[LM.rightKnee] = p(0.55, 0.75, 0.9);
    landmarks[LM.leftAnkle] = p(0.45, 0.92, 0.9);
    landmarks[LM.rightAnkle] = p(0.55, 0.92, 0.9);
    series.push({ timeMs: t * 1000, landmarks });
  }
  series.view = view;
  return series;
}

// Compresses the downswing into two frames so the fast phase is as narrow
// as real 30 fps footage, where impact occupies one to two frames.
function sharpen(series, peakAtS, fps) {
  const peakIdx = Math.round(peakAtS * fps);
  return series.map((f, i) => {
    if (!f.landmarks) return f;
    const lm = f.landmarks.map((l) => ({ ...l }));
    const far = Math.abs(i - peakIdx) > 1;
    if (far) {
      // Everything outside the two peak frames is nearly still.
      lm[LM.leftWrist] = { ...lm[LM.leftWrist], x: 0.48, y: 0.6 };
      lm[LM.rightWrist] = { ...lm[LM.rightWrist], x: 0.52, y: 0.6 };
    }
    return { ...f, landmarks: lm };
  });
}

describe('Frame timing comes from real timestamps, never index over fps', () => {
  test('effective fps is measured from the series itself', () => {
    const s = makeSwing({ fps: 30 });
    assert.ok(Math.abs(effectiveFps(s) - 30) < 0.5);
  });

  test('variable frame rate is measured, not averaged into a fiction', () => {
    // A clip that runs 30 fps then stutters. The nominal average would
    // describe a rate no part of it actually ran at.
    const s = [];
    let t = 0;
    for (let i = 0; i < 30; i++) { s.push({ timeMs: t, landmarks: [] }); t += 33.3; }
    for (let i = 0; i < 10; i++) { s.push({ timeMs: t, landmarks: [] }); t += 100; }
    const eff = effectiveFps(s, 24);
    // Median-based, so the stutter does not drag the estimate to a lie.
    assert.ok(eff > 25 && eff < 32, `expected ~30, got ${eff}`);
  });

  test('a fallback is used only when timestamps cannot answer', () => {
    assert.equal(effectiveFps([], 29.97), 29.97);
    assert.equal(effectiveFps(null, 60), 60);
  });
});

describe('Capability is decided by real temporal resolution', () => {
  test('30 fps footage is Standard and is never rejected', () => {
    const q = assessQuality(makeSwing({ fps: 30 }), { fps: 30, cameraView: 'face_on' });
    assert.equal(q.analysable, true);
    assert.equal(q.capability, CAPABILITY.STANDARD);
  });

  test('60 fps footage unlocks Full', () => {
    const q = assessQuality(makeSwing({ fps: 60 }), { fps: 60, cameraView: 'face_on' });
    assert.equal(q.capability, CAPABILITY.FULL);
  });

  test('120 fps is accepted and is not required', () => {
    assert.equal(assessQuality(makeSwing({ fps: 120 }), { fps: 120 }).capability, CAPABILITY.FULL);
  });

  test('a clip with no trackable body is not analysable', () => {
    const blind = makeSwing().map((f) => ({ timeMs: f.timeMs, landmarks: null }));
    const q = assessQuality(blind, { fps: 30 });
    assert.equal(q.analysable, false);
    assert.ok(q.issues.includes('subject_not_tracked'));
  });

  test('quality describes capabilities rather than passing judgement', () => {
    const q = assessQuality(makeSwing({ fps: 30 }), { fps: 30 });
    // No 'good'/'bad' anywhere — a usable 30 fps clip is Standard.
    assert.ok(!('verdict' in q));
    assert.ok('capability' in q && 'visibility' in q && 'issues' in q);
  });
});

describe('Phase detection survives the wrists disappearing', () => {
  test('with good hands, phases are detected from hand kinematics', () => {
    const { phases, signals } = detectPhases(makeSwing({ wristVis: 0.95 }));
    assert.equal(signals.primary, 'hands');
    assert.equal(signals.fell_back_to_body, false);
    const top = phases.find((p) => p.phase === 'top');
    assert.ok(top.frame_index != null, 'top is found');
    assert.equal(top.detected_by, 'hands_kinematics:reversal');
  });

  test('at DTL wrist visibility the engine falls back to the body, not to nothing', () => {
    // 42% is what the spike measured Down-the-Line.
    const { phases, signals } = detectPhases(makeSwing({ wristVis: 0.2 }), { cameraView: 'down_the_line' });
    assert.equal(signals.primary, 'shoulders');
    assert.equal(signals.fell_back_to_body, true);
    const top = phases.find((p) => p.phase === 'top');
    const impact = phases.find((p) => p.phase === 'impact');
    assert.ok(top.frame_index != null, 'top still found without hands');
    assert.ok(impact.frame_index != null, 'impact still found without hands');
  });

  test('a body-derived phase is labelled approximate, never exact', () => {
    const { phases } = detectPhases(makeSwing({ wristVis: 0.2 }));
    const top = phases.find((p) => p.phase === 'top');
    assert.equal(top.exactness, 'approximate');
    assert.notEqual(top.confidence, CONFIDENCE.HIGH);
  });

  test('impact is approximate when too few frames span the fast phase', () => {
    // The 30 fps reality the spike measured on real swings: one to four
    // frames above 75% of peak. Reproduced with a sharp downswing.
    const s = makeSwing({ fps: 30 });
    const { phases, signals } = detectPhases(sharpen(s, 1.6, 30));
    assert.ok(signals.frames_in_fast_phase <= 4, `expected a narrow peak, got ${signals.frames_in_fast_phase}`);
    const impact = phases.find((p) => p.phase === 'impact');
    assert.equal(impact.exactness, 'approximate');
  });

  test('a phase that cannot be found is absent, not invented', () => {
    const noHips = makeSwing({ hipVis: 0.1 });
    const { phases } = detectPhases(noHips);
    const transition = phases.find((p) => p.phase === 'transition');
    assert.equal(transition.frame_index, null);
    assert.equal(transition.exactness, 'unavailable');
    assert.equal(transition.confidence, CONFIDENCE.UNSUPPORTED);
  });

  test('every phase carries confidence and a stated method', () => {
    const { phases } = detectPhases(makeSwing());
    for (const p of phases) {
      assert.ok('confidence' in p, `${p.phase} has confidence`);
      assert.ok('exactness' in p, `${p.phase} has exactness`);
      assert.ok(p.detected_by, `${p.phase} states how it was found`);
    }
  });

  test('a clip with nothing trackable returns all phases unavailable', () => {
    const { phases } = detectPhases(makeSwing().map((f) => ({ timeMs: f.timeMs, landmarks: null })));
    assert.ok(phases.every((p) => p.exactness === 'unavailable'));
  });

  test('timestamps on phases come from the series, not from frame arithmetic', () => {
    const s = makeSwing({ fps: 30 });
    const { phases } = detectPhases(s);
    const top = phases.find((p) => p.phase === 'top');
    assert.equal(top.time_ms, s[top.frame_index].timeMs);
  });
});

describe('Measurements respect the approved matrix, the view and the capability', () => {
  const q30 = (view) => assessQuality(makeSwing({ fps: 30 }), { fps: 30, cameraView: view });
  const q60 = (view) => assessQuality(makeSwing({ fps: 60 }), { fps: 60, cameraView: view });
  const run = (view, quality, opts = {}) => {
    const s = makeSwing({ fps: quality.capability === CAPABILITY.FULL ? 60 : 30, ...opts });
    const { phases } = detectPhases(s, { cameraView: view });
    return measureSwing(s, phases, quality, { cameraView: view });
  };
  const get = (ms, key) => ms.find((m) => m.key === key);

  test('hip sway is Face-On only; hip depth is Down-the-Line only', () => {
    const fo = run('face_on', q30('face_on'));
    const dtl = run('down_the_line', q30('down_the_line'));
    assert.ok(!get(fo, 'hip_sway').withheld, 'sway measured face-on');
    assert.ok(get(dtl, 'hip_sway').withheld, 'sway withheld DTL');
    assert.ok(!get(dtl, 'hip_depth').withheld, 'depth measured DTL');
    assert.ok(get(fo, 'hip_depth').withheld, 'depth withheld face-on');
  });

  test('elbow spacing is withheld Down-the-Line', () => {
    assert.ok(get(run('down_the_line', q30('down_the_line')), 'elbow_spacing').withheld);
  });

  test('tempo is withheld at 30 fps and available at 60', () => {
    const slow = run('face_on', q30('face_on'));
    const fast = run('face_on', q60('face_on'));
    // At 30 fps the fast phase is one to four frames, so a ratio is noise.
    assert.ok(get(slow, 'tempo_ratio').withheld, 'ratio withheld at 30 fps');
    assert.ok(get(slow, 'backswing_ms').withheld);
    assert.ok(!get(fast, 'tempo_ratio').withheld, 'ratio available at 60 fps');
  });

  test('total swing duration survives at Standard — it is frame timing only', () => {
    assert.ok(!get(run('face_on', q30('face_on')), 'swing_duration').withheld);
  });

  test('nothing is reported in inches', () => {
    const all = [...run('face_on', q30('face_on')), ...run('down_the_line', q30('down_the_line'))];
    for (const m of all) {
      assert.ok(!/inch|cm|mm|metre|meter|yard/i.test(m.unit || ''), `${m.key} must not use physical units`);
    }
    // Spatial measurements are body-relative and therefore scale-free.
    assert.equal(get(run('face_on', q30('face_on')), 'head_lateral').unit, 'shoulder_widths');
  });

  test('rotation is reported as a proxy, never as degrees', () => {
    const m = get(run('face_on', q30('face_on')), 'shoulder_rotation');
    assert.equal(m.unit, 'relative_change');
    assert.match(m.note, /not an angle/);
  });

  test('there is no swing score and no good/bad verdict', () => {
    const all = run('face_on', q30('face_on'));
    assert.ok(!all.some((m) => /score/i.test(m.key)));
    for (const m of all) {
      assert.ok(!/good|bad|poor|correct|wrong|fault/i.test(JSON.stringify(m)), `${m.key} must not judge`);
    }
  });

  test('a withheld measurement is present with a null value, not missing', () => {
    const m = get(run('down_the_line', q30('down_the_line')), 'hip_sway');
    assert.ok(m, 'the key still exists');
    assert.equal(m.value, null);
    assert.equal(m.withheld, true);
  });

  test('low confidence is not shown with false precision', () => {
    assert.equal(roundForConfidence(1.23456, CONFIDENCE.HIGH), 1.23);
    assert.equal(roundForConfidence(1.23456, CONFIDENCE.MEDIUM), 1.2);
    assert.equal(roundForConfidence(1.23456, CONFIDENCE.LOW), 1);
    assert.equal(roundForConfidence(1.23456, CONFIDENCE.UNSUPPORTED), null);
  });
});

describe('Observations describe; they never prescribe', () => {
  test('observations cite the measurements that support them', () => {
    const s = makeSwing({ fps: 60 });
    const q = assessQuality(s, { fps: 60, cameraView: 'face_on' });
    const { phases } = detectPhases(s);
    const ms = measureSwing(s, phases, q, { cameraView: 'face_on' });
    const obs = buildObservations(ms, phases, q);
    assert.ok(obs.length > 0);
    for (const o of obs) assert.ok(Array.isArray(o.cites) && o.cites.length, 'every observation cites evidence');
  });

  test('no observation gives instruction', () => {
    const s = makeSwing({ fps: 30, wristVis: 0.2 });
    const q = assessQuality(s, { fps: 30, cameraView: 'down_the_line' });
    const { phases } = detectPhases(s, { cameraView: 'down_the_line' });
    const obs = buildObservations(measureSwing(s, phases, q, { cameraView: 'down_the_line' }), phases, q);
    for (const o of obs) {
      assert.ok(!/\byou should\b|\bkeep your\b|\btry to\b|\bfix\b|\bneed to\b/i.test(o.text), `prescriptive: ${o.text}`);
    }
  });

  test('poor hand tracking is stated as a fact about the footage', () => {
    const s = makeSwing({ wristVis: 0.1 });
    const q = assessQuality(s, { fps: 30, cameraView: 'down_the_line' });
    const { phases } = detectPhases(s, { cameraView: 'down_the_line' });
    const obs = buildObservations(measureSwing(s, phases, q, { cameraView: 'down_the_line' }), phases, q);
    assert.ok(obs.some((o) => /tracked in \d+% of frames/.test(o.text)));
  });
});

describe('Two-pass candidate detection', () => {
  test('a single swing resolves to one candidate', () => {
    const coarse = makeSwing({ fps: 30, durationS: 4, peakAtS: 2 }).filter((_, i) => i % 6 === 0);
    const candidates = findCandidates(coarse);
    assert.equal(candidates.length, 1);
  });

  test('candidates are returned rather than merged or discarded', () => {
    // Two swings in one clip, well separated.
    const a = makeSwing({ fps: 30, durationS: 4, peakAtS: 1.5 });
    const b = makeSwing({ fps: 30, durationS: 4, peakAtS: 1.5 }).map((f) => ({ ...f, timeMs: f.timeMs + 6000 }));
    const coarse = [...a, ...b].filter((_, i) => i % 6 === 0);
    const candidates = findCandidates(coarse);
    assert.ok(candidates.length >= 2, `expected multiple candidates, got ${candidates.length}`);
    for (const c of candidates) assert.ok(c.end_ms > c.start_ms);
  });

  test('a clip with no swing yields no candidates rather than a false one', () => {
    const still = makeSwing({ durationS: 3 }).map((f) => ({
      timeMs: f.timeMs,
      landmarks: f.landmarks.map((l) => ({ ...l, x: 0.5, y: 0.5 })),
    })).filter((_, i) => i % 6 === 0);
    assert.equal(findCandidates(still).length, 0);
  });

  test('the dense window keeps runway either side of the peak', () => {
    const coarse = makeSwing({ durationS: 5, peakAtS: 2.5 }).filter((_, i) => i % 6 === 0);
    const [c] = findCandidates(coarse);
    assert.ok(c.peak_ms - c.start_ms > 1500, 'address is inside the window');
    assert.ok(c.end_ms - c.peak_ms > 1000, 'finish is inside the window');
  });
});

describe('buildEvidence composes the whole deterministic layer', () => {
  test('a usable 30 fps Face-On swing produces Standard evidence', () => {
    const s = makeSwing({ fps: 30 });
    const ev = buildEvidence(s, { cameraView: 'face_on', fps: 30, durationMs: 3000 });
    assert.equal(ev.quality.capability, CAPABILITY.STANDARD);
    assert.ok(ev.phases.length > 0);
    assert.ok(ev.measurements.length > 0);
    assert.ok(ev.observations.length > 0);
  });

  test('an unanalysable clip yields quality and nothing invented', () => {
    const ev = buildEvidence(makeSwing().map((f) => ({ timeMs: f.timeMs, landmarks: null })), { fps: 30 });
    assert.equal(ev.quality.analysable, false);
    assert.deepEqual(ev.measurements, []);
    assert.deepEqual(ev.phases, []);
  });
});

describe('The pose module encodes the spike findings it was born from', () => {
  const raw = fs.readFileSync(new URL('../js/swingPose.js', import.meta.url), 'utf8');
  // Comments explain at length WHY playback-bound walking is wrong, so they
  // are stripped: a warning in prose must not satisfy a test about code.
  const src = raw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  test('extraction seeks rather than riding playback', () => {
    // Playback-bound walking drops frames silently when work is slower
    // than realtime — the spike "succeeded" on 2 frames of 145 that way.
    assert.match(src, /seekTo/);
    assert.ok(!src.includes('requestVideoFrameCallback'), 'dense analysis must not be playback-bound');
  });

  test('the landmarker clock never rewinds', () => {
    // Rewinding fails the whole graph and looks exactly like "no golfer".
    assert.match(src, /PASS_GAP_MS/);
    assert.match(src, /lastTs \+= PASS_GAP_MS/);
  });

  test('frame time comes from the video, not from index arithmetic', () => {
    assert.match(src, /video\.currentTime \* 1000/);
  });

  test('a seek that never lands cannot hang the analysis', () => {
    assert.match(src, /SEEK_TIMEOUT_MS/);
  });
});

describe('The engine is not loaded by the app starting', () => {
  const read = (f) => fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');

  test('no eagerly-loaded module imports the engine', () => {
    for (const f of ['app.js', 'screens/active.js', 'screens/home.js', 'db.js']) {
      const src = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      assert.ok(!src.includes("from './swingPose.js'") && !src.includes("from '../swingPose.js'"),
        `${f} must not import the pose engine`);
      assert.ok(!src.includes("from './swingAnalysis.js'") && !src.includes("from '../swingAnalysis.js'"),
        `${f} must not import the analysis engine`);
    }
  });

  test('the engine itself imports pose lazily', () => {
    const src = read('swingAnalysis.js');
    assert.match(src, /await import\('\.\/swingPose\.js'\)/);
    assert.ok(!/^import .*swingPose/m.test(src), 'pose must not be a static import');
  });
});

describe('Analysis records are versioned and never overwritten', () => {
  const analysisFields = (videoId, version) => ({
    swing_video_id: videoId, analysis_version: version,
    pose_model: 'mediapipe_pose_landmarker_lite', pose_model_version: '0.10.14',
    camera_view: 'face_on', capability: 'standard',
    detected_phases: [{ phase: 'top', frame_index: 12, confidence: 'high' }],
    measurements: [{ key: 'head_lateral', value: 0.12, unit: 'shoulder_widths', confidence: 'high' }],
  });

  test('re-analysing adds a record rather than replacing one', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'm', camera_view: 'face_on' });
    db.createSwingAnalysis(analysisFields(v.swing_video_id, 1));
    db.createSwingAnalysis(analysisFields(v.swing_video_id, 2));

    const all = db.listSwingAnalyses(v.swing_video_id);
    assert.equal(all.length, 2, 'provenance is not silently lost');
    assert.equal(db.getLatestSwingAnalysis(v.swing_video_id).analysis_version, 2);
  });

  test('every analysis names the engine that produced it', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'm' });
    const a = db.createSwingAnalysis(analysisFields(v.swing_video_id, 1));
    assert.equal(a.pose_model, 'mediapipe_pose_landmarker_lite');
    assert.equal(a.pose_model_version, '0.10.14');
    assert.equal(a.measurement_version, 1);
  });

  test('analysing before the shot, then logging it, enriches without recomputing', async () => {
    const db = await resetDB();
    const s = db.createSession({ date: '2026-09-19', start_time: '10:00', target_ball_count: 30, default_club: '9i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const v = db.createSwingVideo({ media_ref: 'm', range_session_id: s.session_id });
    db.setPendingSwingVideo(v.swing_video_id);
    const a = db.createSwingAnalysis(analysisFields(v.swing_video_id, 1));
    assert.equal(a.shot_id, null);

    const shot = db.addShot(s.session_id, { club: '9i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 130 });

    const after = db.getSwingAnalysis(a.swing_analysis_id);
    assert.equal(after.shot_id, shot.shot_id, 'context gained');
    // The deterministic evidence is byte-identical — the movement did not
    // change because an outcome arrived.
    assert.deepEqual(after.measurements, a.measurements);
    assert.deepEqual(after.detected_phases, a.detected_phases);
    assert.equal(db.listSwingAnalyses(v.swing_video_id).length, 1, 'nothing was re-run');
  });

  test('deleting the video removes its analyses and leaves the shot alone', async () => {
    const db = await resetDB();
    const s = db.createSession({ date: '2026-09-19', start_time: '10:00', target_ball_count: 30, default_club: '9i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full' });
    const v = db.createSwingVideo({ media_ref: 'm', range_session_id: s.session_id });
    db.setPendingSwingVideo(v.swing_video_id);
    const shot = db.addShot(s.session_id, { club: '9i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 130 });
    db.createSwingAnalysis(analysisFields(v.swing_video_id, 1));

    db.deleteSwingVideo(v.swing_video_id);

    assert.equal(db.listSwingAnalyses(v.swing_video_id).length, 0);
    assert.equal(db.getShotsForSession(s.session_id)[0].shot_id, shot.shot_id);
    assert.equal(db.getShotsForSession(s.session_id)[0].strike, 'solid');
  });

  test('analyses survive a reload and stay attached to their video', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'm' });
    db.createSwingAnalysis(analysisFields(v.swing_video_id, 1));
    db.__resetForTests();
    const fresh = await import('../js/db.js');
    assert.equal(fresh.listSwingAnalyses(v.swing_video_id).length, 1);
  });

  test('a pre-V4.3 backup restores without an analyses array', async () => {
    const db = await resetDB();
    db.importFullDB({ schemaVersion: 6, sessions: [], shots: [], settings: {} });
    assert.deepEqual(db.listSwingAnalyses('anything'), []);
  });
});

describe('Context never influences measurement', () => {
  test('the measurement engine receives no shot outcome at all', () => {
    const src = fs.readFileSync(new URL('../js/swingMeasure.js', import.meta.url), 'utf8');
    // A fat shot must not make the engine go looking for a fault (§18).
    for (const forbidden of ['strike', 'direction', 'distance_yards', 'shot_id', 'active_focus', 'lesson']) {
      assert.ok(!src.includes(forbidden), `swingMeasure must not reference ${forbidden}`);
    }
  });

  test('phase detection receives no outcome either', () => {
    const src = fs.readFileSync(new URL('../js/swingPhases.js', import.meta.url), 'utf8');
    for (const forbidden of ['strike', 'distance_yards', 'lesson', 'active_focus']) {
      assert.ok(!src.includes(forbidden), `swingPhases must not reference ${forbidden}`);
    }
  });
});

describe('No AI, no coaching, no cloud in this phase', () => {
  const files = ['swingAnalysis.js', 'swingMeasure.js', 'swingPhases.js', 'swingEvidence.js', 'swingPose.js'];
  test('nothing calls an AI provider', () => {
    for (const f of files) {
      const src = fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
      for (const forbidden of ['openai', 'gemini', 'anthropic', 'api.openai', 'generativelanguage']) {
        assert.ok(!src.toLowerCase().includes(forbidden), `${f} must not reference ${forbidden}`);
      }
    }
  });

  test('no ideal-swing benchmark or pro comparison exists', () => {
    for (const f of files) {
      const src = fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
      assert.ok(!/ideal|benchmark|tour average|pro average/i.test(src.replace(/\/\/.*/g, '')), `${f} must not benchmark`);
    }
  });
});

describe('Measurements span the swing, not the window around it', () => {
  // The dense window carries runway so address and finish sit inside it,
  // which means it also carries the golfer walking into and out of shot.
  // Measuring across all of that produced a head travel of 3.1 shoulder
  // widths on real footage — the golfer entering frame, not moving.
  function withApproach(swing) {
    const lead = [];
    for (let i = 0; i < 20; i++) {
      const t = -((20 - i) / 30) * 1000;
      const lm = swing[0].landmarks.map((l) => ({ ...l }));
      // Walking in from the left. Slow — a golfer walks far more slowly
      // than they swing, and a fixture that does otherwise tests the
      // detector against something that never happens.
      const drift = (20 - i) * 0.008;
      for (const p of lm) p.x = Math.max(0, p.x - drift);
      lead.push({ timeMs: t, landmarks: lm });
    }
    return [...lead, ...swing].map((f, i) => ({ ...f, timeMs: (i / 30) * 1000 }));
  }

  test('an approach walk does not inflate head movement', () => {
    const swing = makeSwing({ fps: 30 });
    const padded = withApproach(swing);
    const q = assessQuality(padded, { fps: 30, cameraView: 'face_on' });
    const { phases } = detectPhases(padded);
    const ms = measureSwing(padded, phases, q, { cameraView: 'face_on' });
    const lateral = ms.find((m) => m.key === 'head_lateral');

    // A head cannot travel more than about one shoulder width in a swing.
    assert.ok(lateral.value != null, 'still measured');
    assert.ok(lateral.value < 1.0, `head travel should be plausible, got ${lateral.value}`);
  });

  test('measurements fall back to the whole window when phases are missing', () => {
    const s = makeSwing({ fps: 30 });
    const q = assessQuality(s, { fps: 30, cameraView: 'face_on' });
    // No phases at all — the engine must still produce something rather
    // than dividing by an empty span.
    const ms = measureSwing(s, [], q, { cameraView: 'face_on' });
    assert.ok(ms.length > 0);
    assert.ok(ms.some((m) => !m.withheld));
  });
});

describe('Pose jumps are filtered, not measured', () => {
  // MediaPipe tracks one person. On range footage it can latch onto a
  // golfer in a neighbouring bay, or lose the subject and snap back. Those
  // frames are not the golfer moving, and on real footage they produced a
  // head travel of 2.9 shoulder widths — an impossible number wearing the
  // clothes of a measurement.
  function withPoseJumps(swing, count = 8) {
    return swing.map((f, i) => {
      if (i % 7 !== 0 || count-- <= 0 || !f.landmarks) return f;
      const lm = f.landmarks.map((l) => ({ ...l }));
      // A different, much smaller body somewhere else in frame.
      lm[LM.leftShoulder] = { ...lm[LM.leftShoulder], x: 0.05, y: 0.30 };
      lm[LM.rightShoulder] = { ...lm[LM.rightShoulder], x: 0.11, y: 0.30 };
      lm[LM.nose] = { ...lm[LM.nose], x: 0.08, y: 0.10 };
      return { ...f, landmarks: lm };
    });
  }

  test('a jumping pose does not produce an impossible head travel', () => {
    const s = withPoseJumps(makeSwing({ fps: 30 }));
    const q = assessQuality(s, { fps: 30, cameraView: 'face_on' });
    const { phases } = detectPhases(s);
    const m = measureSwing(s, phases, q, { cameraView: 'face_on' }).find((x) => x.key === 'head_lateral');
    if (!m.withheld) {
      assert.ok(m.value < 1.0, `head travel must stay plausible, got ${m.value}`);
    }
  });

  test('badly unstable tracking withholds spatial measurements entirely', () => {
    // Over 40% of frames showing a different body is not a measurement
    // problem to soften — it is a measurement that should not be made.
    const s = withPoseJumps(makeSwing({ fps: 30 }), 999).map((f, i) =>
      (i % 2 === 0 && f.landmarks ? {
        ...f,
        landmarks: f.landmarks.map((l, j) => (j === LM.leftShoulder ? { ...l, x: 0.02 } : j === LM.rightShoulder ? { ...l, x: 0.06 } : l)),
      } : f));
    const q = assessQuality(s, { fps: 30, cameraView: 'face_on' });
    const { phases } = detectPhases(s);
    const ms = measureSwing(s, phases, q, { cameraView: 'face_on' });
    const spatial = ms.filter((m) => m.unit === 'shoulder_widths');
    assert.ok(spatial.every((m) => m.withheld), 'spatial claims are withheld when tracking is unstable');
  });
});

describe('Unsteady tracking is reported, not quietly measured', () => {
  test('withholds every measurement and explains why', () => {
    const s = makeSwing({ fps: 30 });
    const q = assessQuality(s, { fps: 30, cameraView: 'face_on' });
    // Real footage of a golfer too far from the camera measured 1.98.
    q.tracking_steady = false;
    const { phases } = detectPhases(s);
    const ms = measureSwing(s, phases, q, { cameraView: 'face_on', trackingDrift: 1.98 });
    assert.ok(ms.every((m) => m.withheld), 'nothing is claimed from a body that was not tracked');

    const obs = buildObservations(ms, phases, q);
    assert.ok(obs.length, 'an empty result still explains itself');
    assert.match(obs[0].text, /could not be tracked steadily/);
    // The golfer is still on the range; the note has to be actionable.
    assert.match(obs[0].text, /camera|frame|film/i);
  });

  test('steady tracking is not penalised', () => {
    const s = makeSwing({ fps: 240 });
    const q = assessQuality(s, { fps: 240, cameraView: 'face_on' });
    const { phases } = detectPhases(s);
    const ms = measureSwing(s, phases, q, { cameraView: 'face_on', trackingDrift: 1.05 });
    assert.ok(ms.some((m) => !m.withheld), 'good footage still measures');
    assert.ok(!buildObservations(ms, phases, q).some((o) => /could not be tracked/.test(o.text)));
  });
});

test('the result leads with the tracking problem, not with silence', () => {
  const q = { tracking_steady: false, visibility: { wrists: 0.9 } };
  const top = topObservation([], [], q);
  assert.match(top.text, /could not be tracked steadily/);
  assert.equal(top.kind, 'limitation');
});
