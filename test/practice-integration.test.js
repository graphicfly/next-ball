import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import * as P from '../js/practice.js';

const APP = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HOME = fs.readFileSync(new URL('../js/screens/home.js', import.meta.url), 'utf8');
const PRACTICE_SCREEN = fs.readFileSync(new URL('../js/screens/practice.js', import.meta.url), 'utf8');

describe('Practice architecture', () => {
  test('Home offers Practice and Play a Round, and nothing else grows', () => {
    // practice-spec.md §1: Home holds exactly two choices. Three mode cards
    // would worsen an overflow lesson-spec.md §3.0 already recorded.
    assert.match(HOME, /id: 'practiceChoiceBtn'/);
    assert.match(HOME, /title: 'Practice'/);
    assert.match(HOME, /title: 'Play a Round'/);
    assert.ok(!/id: 'chippingChoiceBtn'|id: 'puttingChoiceBtn'/.test(HOME), 'modes do not get their own Home cards');
  });

  test('Practice opens a select screen holding all three modes', () => {
    assert.match(PRACTICE_SCREEN, /id: 'rangeRow'/);
    assert.match(PRACTICE_SCREEN, /id: 'chippingRow'/);
    assert.match(PRACTICE_SCREEN, /id: 'puttingRow'/);
    assert.match(PRACTICE_SCREEN, /Contact · Direction · Distance/);
    assert.match(PRACTICE_SCREEN, /Contact · Proximity/);
    assert.match(PRACTICE_SCREEN, /Makes · Pace · Proximity/);
  });

  test('every practice route is reachable', () => {
    for (const r of ['#\\/practice', '#\\/chipping\\/setup', '#\\/putting\\/select', '#\\/practice\\/summary']) {
      assert.ok(APP.includes(r), `${r} is not routed`);
    }
  });

  test('Range still reaches its own flow untouched', () => {
    assert.match(PRACTICE_SCREEN, /startRangeFlow/);
    assert.ok(APP.includes('#\\/start'), 'the range start route is unchanged');
    assert.ok(APP.includes('#\\/active'), 'the active range session route is unchanged');
  });

  test('skill area is derived from mode, never stored twice', () => {
    assert.equal(P.skillAreaFor('range'), 'full_swing');
    assert.equal(P.skillAreaFor('chipping'), 'short_game');
    assert.equal(P.skillAreaFor('putting'), 'putting');
  });
});

describe('Focus is snapshotted, and history does not move with it', () => {
  test('a session copies the Focus as it was', async () => {
    const db = await resetDB();
    const lesson = db.createLesson({ instructor_name: 'Coach', date: '2026-09-01', cues: [{ order: 1, text: 'Land it on your spot.' }] });
    db.setActiveSwingFocus(lesson.lesson_id, 1);
    const s = db.createPracticeSession({
      mode: 'chipping', practice_type: 'standard',
      setup: { club: 'GW', lie: 'rough', surface: 'grass', distance_yds: 15 },
      focus_snapshot: db.swingFocusSnapshot(),
    });
    assert.equal(s.focus_snapshot.cue_text, 'Land it on your spot.');
  });

  test('editing the lesson later does NOT rewrite what was practised', async () => {
    const db = await resetDB();
    const lesson = db.createLesson({ instructor_name: 'Coach', date: '2026-09-01', cues: [{ order: 1, text: 'Land it on your spot.' }] });
    db.setActiveSwingFocus(lesson.lesson_id, 1);
    const s = db.createPracticeSession({
      mode: 'putting', kind: 'short', practice_type: 'short',
      setup: { distance_ft: 5, surface: 'green' },
      focus_snapshot: db.swingFocusSnapshot(),
    });
    // The same rule lesson-spec.md §5.2 set for swing_focus_id, and for the
    // same reason: correcting a cue's wording must not change what a past
    // session was hit under.
    db.updateLesson(lesson.lesson_id, { cues: [{ order: 1, text: 'Completely different wording.' }] });
    db.__resetForTests();
    assert.equal(db.getPracticeSession(s.session_id).focus_snapshot.cue_text, 'Land it on your spot.');
  });

  test('there is no parallel Focus model', () => {
    const files = ['../js/practice.js', '../js/screens/chippingSetup.js', '../js/screens/puttingSetup.js'];
    for (const f of files) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.ok(!/ChippingFocus|PuttingFocus|createPracticeFocus/.test(src), `${f} invents a second Focus model`);
    }
  });
});

describe('Practice data is additive and nothing existing is disturbed', () => {
  test('an index written before Practice existed simply gains the array', async () => {
    const db = await resetDB();
    // Force the index to disk first: a fresh store has not written one yet.
    db.updateSettings({ theme: 'dark' });
    const raw = JSON.parse(localStorage.getItem('rangelog_index_v1'));
    delete raw.practice_sessions;
    localStorage.setItem('rangelog_index_v1', JSON.stringify(raw));
    db.__resetForTests();
    assert.deepEqual(db.listPracticeSessions(), [], 'normalize-on-load, no migration');
    const s = db.createPracticeSession({ mode: 'chipping', practice_type: 'standard', setup: {} });
    assert.ok(s, 'and it is writable immediately');
  });

  test('range sessions, rounds and lessons still work alongside practice', async () => {
    const db = await resetDB();
    const range = db.createSession({ date: '2026-09-19', start_time: '10:00', default_club: '7i' });
    db.addShot(range.session_id, { club: '7i', strike: 'solid', direction: 'straight' });
    const lesson = db.createLesson({ instructor_name: 'Coach', date: '2026-09-01', cues: [{ order: 1, text: 'Cue' }] });
    const practice = db.createPracticeSession({ mode: 'chipping', practice_type: 'standard', setup: { club: 'GW', surface: 'grass', lie: 'rough', distance_yds: 10 } });
    db.addChip(practice.session_id, { contact: 'solid', prox_bucket: 'in_3' });

    db.__resetForTests();
    assert.equal(db.getShotsForSession(range.session_id).length, 1, 'range shots survive');
    assert.ok(db.getLesson(lesson.lesson_id), 'lessons survive');
    assert.equal(db.listChips(practice.session_id).length, 1, 'chips survive');
  });

  test('deleting a practice session takes its chunk and nothing else', async () => {
    const db = await resetDB();
    const range = db.createSession({ date: '2026-09-19', start_time: '10:00', default_club: '7i' });
    db.addShot(range.session_id, { club: '7i', strike: 'solid', direction: 'straight' });
    const p = db.createPracticeSession({ mode: 'putting', kind: 'short', practice_type: 'short', setup: { distance_ft: 5, surface: 'green' } });
    db.addPutt(p.session_id, { result: 'made' });

    assert.equal(db.deletePracticeSession(p.session_id), true);
    db.__resetForTests();
    assert.equal(db.getPracticeSession(p.session_id), null);
    assert.equal(localStorage.getItem(`rangelog_putts_v1_${p.session_id}`), null, 'the chunk goes with it');
    assert.equal(db.getShotsForSession(range.session_id).length, 1, 'the range session is untouched');
  });

  test('practice sessions appear in History without a second archive', () => {
    const history = fs.readFileSync(new URL('../js/screens/history.js', import.meta.url), 'utf8');
    assert.match(history, /listPracticeSessions/);
    assert.match(history, /id: 'chipping', label: 'Chipping'/);
    assert.match(history, /id: 'putting', label: 'Putting'/);
  });
});

describe('Swing Lab is untouched by this work', () => {
  // The recording and analysis pipeline is frozen pending a real range test.
  const FROZEN = [
    '../js/swingCapture.js', '../js/swingPose.js', '../js/swingPhases.js',
    '../js/swingMeasure.js', '../js/swingAnalysis.js', '../js/swingEvidence.js',
    '../js/swingMedia.js', '../js/screens/swingCaptureScreen.js',
    '../js/screens/swingResult.js', '../js/screens/swingPreview.js',
  ];

  test('no frozen module imports anything from Practice', () => {
    for (const f of FROZEN) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.ok(!/from '\.\.?\/practice(Summary|Progress|Boundary)?\.js'/.test(src),
        `${f} has been coupled to Practice`);
    }
  });

  test('Practice imports nothing from the swing pipeline', () => {
    const mine = ['../js/practice.js', '../js/practiceSummary.js', '../js/practiceProgress.js',
      '../js/practiceBoundary.js', '../js/screens/practice.js', '../js/screens/chippingSetup.js',
      '../js/screens/chippingSession.js', '../js/screens/puttingSetup.js',
      '../js/screens/puttingSession.js', '../js/screens/practiceSummaryScreen.js'];
    for (const f of mine) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      assert.ok(!/swing(Capture|Pose|Phases|Measure|Analysis|Evidence|Media)/.test(src),
        `${f} reaches into the frozen pipeline`);
    }
  });

  test('every swing route still exists', () => {
    for (const r of ['#\\/swing\\/capture', '#\\/swing\\/preview', '#\\/swing\\/analyze', '#\\/swing\\/result', '#\\/swing-lab']) {
      assert.ok(APP.includes(r), `${r} was disturbed`);
    }
  });

  test('swing video records are unaffected by a practice session', async () => {
    const db = await resetDB();
    const v = db.createSwingVideo({ media_ref: 'm', camera_view: 'face_on', club: '7i' });
    const p = db.createPracticeSession({ mode: 'chipping', practice_type: 'standard', setup: { club: 'GW', surface: 'grass', lie: 'rough', distance_yds: 10 } });
    db.addChip(p.session_id, { contact: 'solid', prox_bucket: 'in_3' });
    db.__resetForTests();
    const after = db.getSwingVideo(v.swing_video_id);
    assert.equal(after.camera_view, 'face_on');
    assert.equal(after.club, '7i');
  });
});
