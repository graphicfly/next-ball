import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import { buildRecordingContext, buildSwingAnalysisContext } from '../js/swingContext.js';

// Swing capture and the analysis context contract (V4.3).
//
// The camera itself needs getUserMedia and MediaRecorder, neither of which
// exists in Node, so its behaviour is verified on a device. What is asserted
// here is everything that can be: the privacy rules encoded in the module,
// the timing guarantees, and the context contract — which is pure logic and
// is where the subtle bugs would live.

const read = (f) => fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const SESSION = {
  date: '2026-09-19', start_time: '10:00', target_ball_count: 30,
  default_club: '9i', default_setup: 'ground', default_surface: 'mat', default_swing: 'full',
};
const SHOT = { club: '9i', setup: 'ground', surface: 'mat', swing_length: 'full', strike: 'solid', direction: 'straight', height: 'medium', distance_yards: 125 };

describe('The camera runs only when explicitly armed', () => {
  const src = code('swingCapture.js');

  test('there is exactly one place that opens the camera', () => {
    // Two mentions: the feature check and the single call behind it.
    const calls = src.match(/await navigator\.mediaDevices\.getUserMedia\(/g) || [];
    assert.equal(calls.length, 1, 'exactly one getUserMedia call');
  });

  test('recording has both an auto-stop and a hard safety cap', () => {
    // A failed auto-stop must never record indefinitely (§9).
    assert.match(src, /POST_TRIGGER_MS/);
    assert.match(src, /MAX_RECORDING_MS/);
    const mod = read('swingCapture.js');
    const cap = Number(mod.match(/MAX_RECORDING_MS = (\d+)/)[1]);
    const auto = Number(mod.match(/POST_TRIGGER_MS = (\d+)/)[1]);
    assert.ok(cap > auto, 'the safety cap must outlast the normal stop');
    assert.ok(cap <= 15000, 'a runaway recording must stay small');
  });

  test('arming gives up rather than holding the camera open forever', () => {
    assert.match(src, /ARM_TIMEOUT_MS/);
  });

  test('closeCamera stops every track', () => {
    assert.match(src, /getTracks\(\)/);
    assert.match(src, /track\.stop\(\)/);
  });

  test('the trigger is frame difference, not pose or a rolling buffer', () => {
    // Deliberately the smallest thing that works: it answers only "did a
    // lot of pixels change", and only while armed.
    assert.match(src, /getImageData/);
    assert.ok(!src.includes('PoseLandmarker'), 'no pose model while arming');
    assert.ok(!src.includes('MediaSource'), 'no rolling buffer');
  });

  test('frame rate is requested but never asserted as fact', () => {
    assert.match(src, /frameRate: \{ ideal/);
    // What actually arrived is measured instead.
    assert.match(src, /actualTrackSettings/);
  });

  test('container choice does not consult canPlayType', () => {
    assert.ok(!src.includes('canPlayType'));
    assert.match(src, /MediaRecorder\.isTypeSupported/);
  });
});

describe('A range session without video costs nothing extra', () => {
  test('the Range Session screen imports no camera or media code', () => {
    const active = code('screens/active.js');
    for (const forbidden of ['swingCapture.js', 'swingMedia.js', 'media.js', 'mediaMeta.js']) {
      assert.ok(!active.includes(`from '../${forbidden}'`), `active.js must not import ${forbidden}`);
    }
  });

  test('the capture screen is a separate lazily-routed module', () => {
    assert.match(code('app.js'), /#\\\/swing\\\/capture\$/);
  });
});

describe('Recording context is frozen; shot outcome is read live', () => {
  test('the recording context copies what was true at capture', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    db.updateSession(s.session_id, { current_club: '7i', current_drill: 'Ladder', current_target_distance: 150 });
    const ctx = buildRecordingContext(db.getSession(s.session_id));
    assert.equal(ctx.club, '7i');
    assert.equal(ctx.drill, 'Ladder');
    assert.equal(ctx.target_distance_yards, 150);
  });

  test('changing session defaults afterwards does not rewrite it', async () => {
    const db = await resetDB();
    const s = db.createSession(SESSION);
    db.updateSession(s.session_id, { current_club: '7i' });
    const frozen = buildRecordingContext(db.getSession(s.session_id));

    const v = db.createSwingVideo({ media_ref: 'm', range_session_id: s.session_id, practice_context: frozen, club: '7i' });
    db.updateSession(s.session_id, { current_club: 'PW', current_drill: 'Something else' });

    const ctx = buildSwingAnalysisContext(v.swing_video_id);
    // History must not move when the session moves on (§10, §20).
    assert.equal(ctx.recording_context.club, '7i');
    assert.equal(ctx.club, '7i');
  });
});

describe('The analysis context is the same shape from every entry point', () => {
  async function pendingVideo(db) {
    const s = db.createSession(SESSION);
    const v = db.createSwingVideo({
      media_ref: 'swing/x/original', range_session_id: s.session_id,
      camera_view: 'down_the_line', club: '9i', fps: 29.998, duration_ms: 4000,
      practice_context: buildRecordingContext(db.getSession(s.session_id)),
    });
    db.setPendingSwingVideo(v.swing_video_id);
    return { s, v };
  }

  test('a pending swing analyses with no outcome, and none is invented', async () => {
    const db = await resetDB();
    const { v } = await pendingVideo(db);
    const ctx = buildSwingAnalysisContext(v.swing_video_id);

    assert.equal(ctx.association_state, 'pending');
    assert.equal(ctx.has_outcome, false);
    assert.equal(ctx.shot_outcome, null);
    // The movement half is fully present — analysis is possible without a shot.
    assert.equal(ctx.camera_view, 'down_the_line');
    assert.equal(ctx.media.fps, 29.998);
    assert.ok(ctx.recording_context);
  });

  test('once the shot is logged the same swing gains its outcome', async () => {
    const db = await resetDB();
    const { s, v } = await pendingVideo(db);
    const shot = db.addShot(s.session_id, SHOT);

    const ctx = buildSwingAnalysisContext(v.swing_video_id);
    assert.equal(ctx.association_state, 'linked');
    assert.equal(ctx.has_outcome, true);
    assert.equal(ctx.shot_outcome.shot_id, shot.shot_id);
    assert.equal(ctx.shot_outcome.strike, 'solid');
    assert.equal(ctx.shot_outcome.distance_yards, 125);
  });

  test('a corrected shot outcome is read live, not frozen', async () => {
    const db = await resetDB();
    const { s, v } = await pendingVideo(db);
    const shot = db.addShot(s.session_id, SHOT);
    db.updateShot(s.session_id, shot.shot_id, { strike: 'thin', distance_yards: 108 });

    const ctx = buildSwingAnalysisContext(v.swing_video_id);
    assert.equal(ctx.shot_outcome.strike, 'thin');
    assert.equal(ctx.shot_outcome.distance_yards, 108);
    // And the recording context is still the original.
    assert.equal(ctx.recording_context.club, '9i');
  });

  test('an unpaired swing still analyses', async () => {
    const db = await resetDB();
    const { s, v } = await pendingVideo(db);
    db.finishSession(s.session_id);

    const ctx = buildSwingAnalysisContext(v.swing_video_id);
    assert.equal(ctx.association_state, 'unpaired');
    assert.equal(ctx.has_outcome, false);
    assert.ok(ctx.recording_context, 'it keeps everything except an outcome');
  });

  test('the active focus travels as a snapshot, with its lesson resolved beside it', async () => {
    const db = await resetDB();
    const lesson = db.createLesson({ date: '2026-09-18', instructor_name: 'Gaza', cues: ['Stay over it'], drills: ['10 half swings'] });
    db.setActiveSwingFocus(lesson.lesson_id);
    const s = db.createSession(SESSION);
    const v = db.createSwingVideo({
      media_ref: 'm', range_session_id: s.session_id,
      active_focus_snapshot: db.swingFocusSnapshot(),
    });

    db.updateLesson(lesson.lesson_id, { cues: ['Stay over it longer'] });

    const ctx = buildSwingAnalysisContext(v.swing_video_id);
    // The wording as practised, not as later corrected (lesson-spec §5.2).
    assert.equal(ctx.active_focus_snapshot.cue_text, 'Stay over it');
    // The lesson is resolved for its drills, which are reference material.
    assert.equal(ctx.lesson.instructor_name, 'Gaza');
    assert.equal(ctx.lesson.drills[0].text, '10 half swings');
  });

  test('a missing video yields null rather than a half-built context', async () => {
    const db = await resetDB();
    assert.equal(buildSwingAnalysisContext('nope'), null);
  });

  test('there is one builder — screens do not assemble payloads themselves', () => {
    const builder = read('swingContext.js');
    assert.match(builder, /export function buildSwingAnalysisContext/);
    // Any screen that analyses must go through it.
    const capture = code('screens/swingCaptureScreen.js');
    assert.ok(!capture.includes('shot_outcome'), 'screens must not build context inline');
  });
});

describe('The motion trigger threshold', () => {
  // Extracted as a pure function precisely so it can be tested. Driving it
  // through a real camera is a device job; the arithmetic is not.
  let frameChangeFraction, isMotion, MOTION_TUNING;
  test('load', async () => {
    ({ frameChangeFraction, isMotion, MOTION_TUNING } = await import('../js/swingCapture.js'));
    assert.equal(typeof frameChangeFraction, 'function');
  });

  const frame = (fill) => {
    const px = 64 * 48;
    const d = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = fill; d[i + 3] = 255; }
    return d;
  };
  // A frame where only a fraction of pixels moved, the rest identical.
  const partial = (base, movedFraction, delta) => {
    const d = frame(base);
    const step = Math.max(1, Math.round(1 / movedFraction));
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      if (n % step === 0) { d[i] = d[i + 1] = d[i + 2] = base + delta; }
      n += 1;
    }
    return d;
  };

  test('an identical frame is not motion — a still golfer must not trigger', async () => {
    const a = frame(120);
    assert.equal(frameChangeFraction(a, frame(120)), 0);
    assert.equal(isMotion(a, frame(120)), false);
  });

  test('gentle noise below the pixel threshold is not motion', async () => {
    // Sensor noise and breathing move pixels a little, everywhere.
    const a = frame(120);
    const b = frame(120 + MOTION_TUNING.pixelThreshold - 5);
    assert.equal(isMotion(a, b), false);
  });

  test('a whole-frame change is unambiguously motion', async () => {
    assert.equal(isMotion(frame(40), frame(200)), true);
    assert.equal(frameChangeFraction(frame(40), frame(200)), 1);
  });

  test('a small moving region triggers, a tiny one does not', async () => {
    const base = frame(120);
    const big = partial(120, 0.25, 90);    // an arm sweeping through frame
    const tiny = partial(120, 0.01, 90);   // a bird, a cart in the distance
    assert.equal(isMotion(base, big), true);
    assert.equal(isMotion(base, tiny), false);
  });

  test('mismatched or missing frames are never motion', async () => {
    assert.equal(frameChangeFraction(null, frame(10)), 0);
    assert.equal(frameChangeFraction(frame(10), null), 0);
    assert.equal(frameChangeFraction(new Uint8ClampedArray(8), frame(10)), 0);
  });

  test('a single motion frame is not enough to start recording', async () => {
    // Consecutive frames are required so one flash cannot start a take.
    assert.ok(MOTION_TUNING.consecutive >= 2);
  });
});
