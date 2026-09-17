import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';

// Lessons, the Active Swing Focus and the session snapshot —
// docs/lesson-spec.md §2, §3, §4.1, §5.2.
//
// The invariant these tests exist to protect: editing a lesson corrects the
// PRESENT (the active focus follows) and never the PAST (a session keeps
// the wording it was actually practised under).

function reload(db) {
  db.__resetForTests();
  return import('../js/db.js');
}

const LESSON = {
  date: '2026-09-13',
  instructor_name: 'Gaza',
  cues: ['Pressure left', 'Stay over it', 'Extend through'],
};

describe('Lesson model — §2', () => {
  test('a date and one cue is a complete lesson; everything else is optional', async () => {
    const db = await resetDB();
    const l = db.createLesson({ date: '2026-09-13', cues: ['Stay over it'] });
    assert.ok(l.lesson_id);
    assert.equal(l.instructor_name, null);
    assert.deepEqual(l.topics, []);
    assert.deepEqual(l.drills, []);
    assert.equal(l.notes, '');
    assert.equal(l.status, 'active');
    assert.deepEqual(l.video_ids, []);
  });

  test('a lesson without a date, or without a cue, is refused', async () => {
    const db = await resetDB();
    assert.equal(db.createLesson({ cues: ['Stay over it'] }), null);
    assert.equal(db.createLesson({ date: '2026-09-13' }), null);
    assert.equal(db.createLesson({ date: '2026-09-13', cues: ['   '] }), null);
    assert.equal(db.listLessons().length, 0);
  });

  test('the three-cue cap is enforced by the model — §2.1', async () => {
    const db = await resetDB();
    const l = db.createLesson({ date: '2026-09-13', cues: ['one', 'two', 'three', 'four', 'five'] });
    assert.equal(l.cues.length, db.MAX_LESSON_CUES);
    assert.equal(db.MAX_LESSON_CUES, 3);
    assert.deepEqual(l.cues.map((c) => c.text), ['one', 'two', 'three']);
    assert.deepEqual(l.cues.map((c) => c.order), [1, 2, 3]);
  });

  test('cue and note text is stored verbatim — §2.2', async () => {
    const db = await resetDB();
    const l = db.createLesson({
      date: '2026-09-13',
      cues: ['  stay over it  ', 'PRESSURE left!!', 'dont slide'],
      notes: '  weight fwd. dont get lazy w the 7i  ',
    });
    // Only surrounding whitespace — typing noise — is removed. Case,
    // punctuation, grammar and shorthand are untouched.
    assert.deepEqual(l.cues.map((c) => c.text), ['stay over it', 'PRESSURE left!!', 'dont slide']);
    assert.equal(l.notes, 'weight fwd. dont get lazy w the 7i');
  });

  test('drills are optional, uncapped, and shaped like cues', async () => {
    const db = await resetDB();
    const none = db.createLesson({ date: '2026-09-13', cues: ['a'] });
    assert.deepEqual(none.drills, []);
    const many = db.createLesson({ date: '2026-09-14', cues: ['a'], drills: ['d1', 'd2', 'd3', 'd4', 'd5'] });
    assert.equal(many.drills.length, 5);
    assert.deepEqual(many.drills[4], { order: 5, text: 'd5' });
  });

  test('lessons list newest first and survive a reload', async () => {
    const db = await resetDB();
    db.createLesson({ date: '2026-08-01', cues: ['old'] });
    db.createLesson({ date: '2026-09-13', cues: ['new'] });
    const fresh = await reload(db);
    assert.deepEqual(fresh.listLessons().map((l) => l.date), ['2026-09-13', '2026-08-01']);
  });

  test('editing preserves created_at and tracks updated_at — §2.3', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    const edited = db.updateLesson(l.lesson_id, { cues: ['Pressure left', 'Stay OVER it'], notes: 'n' });
    assert.equal(edited.created_at, l.created_at);
    assert.ok(edited.updated_at >= l.updated_at);
    assert.deepEqual(edited.cues.map((c) => c.text), ['Pressure left', 'Stay OVER it']);
  });

  test('an edit that would leave a lesson with no cues is refused, not applied', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    const edited = db.updateLesson(l.lesson_id, { cues: [] });
    assert.equal(edited.cues.length, 3);
  });

  test('instructor names are offered by frequency then recency, ignoring test data — §2.4', async () => {
    const db = await resetDB();
    db.createLesson({ date: '2026-01-01', instructor_name: 'Gaza', cues: ['a'] });
    db.createLesson({ date: '2026-02-01', instructor_name: 'Gaza', cues: ['a'] });
    db.createLesson({ date: '2026-03-01', instructor_name: 'Pat', cues: ['a'] });
    db.createLesson({ date: '2026-04-01', instructor_name: 'Fixture', cues: ['a'], data_source: 'test' });
    assert.deepEqual(db.recentInstructorNames(), ['Gaza', 'Pat']);
  });
});

describe('Active Swing Focus — §3', () => {
  test('defaults to cue 1, and any cue on that lesson can be chosen', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    assert.equal(db.getActiveSwingFocus(), null);
    assert.equal(db.setActiveSwingFocus(l.lesson_id).cue_text, 'Pressure left');
    assert.equal(db.setActiveSwingFocus(l.lesson_id, 3).cue_text, 'Extend through');
  });

  test('resolving a focus carries the lesson context and the supporting cues', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 2);
    const focus = db.getActiveSwingFocus();
    assert.equal(focus.instructor_name, 'Gaza');
    assert.equal(focus.lesson_date, '2026-09-13');
    // Never shown on Home; available one tap away on the Lesson Summary.
    assert.deepEqual(focus.supporting_cues.map((c) => c.text), ['Pressure left', 'Extend through']);
  });

  test('only one focus exists app-wide — a newer lesson replaces it', async () => {
    const db = await resetDB();
    const a = db.createLesson({ date: '2026-08-01', cues: ['old cue'] });
    const b = db.createLesson({ date: '2026-09-13', cues: ['new cue'] });
    db.setActiveSwingFocus(a.lesson_id);
    db.setActiveSwingFocus(b.lesson_id);
    assert.equal(db.getActiveSwingFocus().lesson_id, b.lesson_id);
    assert.equal(db.getActiveSwingFocus().cue_text, 'new cue');
  });

  test('the focus persists across reloads and never expires on its own', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 2);
    const fresh = await reload(db);
    assert.equal(fresh.getActiveSwingFocus().cue_text, 'Stay over it');
  });

  test('the golfer can clear it, and clearing does not touch the lesson — §11.2', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id);
    db.clearActiveSwingFocus();
    assert.equal(db.getActiveSwingFocus(), null);
    assert.equal(db.getLesson(l.lesson_id).cues.length, 3);
  });

  test('a focus pointing at a deleted cue falls back rather than pointing at nothing', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 3);
    db.updateLesson(l.lesson_id, { cues: ['Pressure left'] });
    assert.equal(db.getActiveSwingFocus().cue_order, 1);
    assert.equal(db.getActiveSwingFocus().cue_text, 'Pressure left');
  });

  test('a focus whose lesson is gone resolves to null instead of throwing', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id);
    db.deleteLesson(l.lesson_id);
    assert.equal(db.getActiveSwingFocus(), null);
  });
});

describe('The session snapshot — §5.2', () => {
  function startSession(db) {
    return db.createSession({
      date: '2026-09-17', start_time: '10:00', target_ball_count: 50,
      default_club: '7i', default_setup: 'normal', default_surface: 'mat', default_swing: 'full',
    });
  }

  test('a session stores the focus as a copy, with the wording as practised', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 2);
    const s = startSession(db);
    assert.equal(s.swing_focus.cue_text, 'Stay over it');
    assert.equal(s.swing_focus.instructor_name, 'Gaza');
    assert.equal(s.swing_focus.lesson_date, '2026-09-13');
    assert.equal(s.swing_focus.lesson_id, l.lesson_id);
    assert.ok(s.swing_focus.captured_at);
  });

  test('a session started with no focus records null, not an empty object', async () => {
    const db = await resetDB();
    assert.equal(startSession(db).swing_focus, null);
  });

  // The invariant the whole design rests on.
  test('editing a lesson corrects the present and never rewrites the past', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 2);
    const played = startSession(db);

    // Three weeks later the golfer fixes the wording they mis-remembered.
    db.updateLesson(l.lesson_id, { cues: ['Pressure left', 'Stay over it longer', 'Extend through'] });

    const fresh = await reload(db);
    // The past keeps what was actually practised...
    assert.equal(fresh.getSession(played.session_id).swing_focus.cue_text, 'Stay over it');
    // ...and the present shows the correction.
    assert.equal(fresh.getActiveSwingFocus().cue_text, 'Stay over it longer');
  });

  test('deleting the lesson leaves past sessions truthful', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id);
    const played = startSession(db);
    db.deleteLesson(l.lesson_id);
    assert.equal(db.getSession(played.session_id).swing_focus.cue_text, 'Pressure left');
  });
});

describe('Plans gain a discriminated source — §4.1', () => {
  const FOCUS = {
    signal: 'full_swing', focus_title: 'Low-point control',
    focus_rationale: 'Stay over it', goal_text: 'Solid contact with the 9i',
    steps: [{ order: 1, title: '10 half-swings with 9i', detail: '', ball_count: 10 }],
  };

  test('the original round signature still works and is tagged as a round plan', async () => {
    const db = await resetDB();
    const p = db.createPlan('round-1', FOCUS);
    assert.equal(p.source, 'round');
    assert.equal(p.round_id, 'round-1');
    assert.equal(p.lesson_id, null);
    assert.equal(db.getPlanForRound('round-1').plan_id, p.plan_id);
  });

  test('a lesson plan carries its lesson and no round', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    const p = db.createPlan({ source: 'lesson', lessonId: l.lesson_id }, FOCUS);
    assert.equal(p.source, 'lesson');
    assert.equal(p.round_id, null);
    assert.equal(db.getPlanForLesson(l.lesson_id).plan_id, p.plan_id);
    // A lesson plan must never surface as some round's plan.
    assert.equal(db.getPlanForRound(null), null);
    assert.equal(db.getPlanForRound(undefined), null);
  });

  test('a plan that cannot name its source is refused', async () => {
    const db = await resetDB();
    assert.equal(db.createPlan({ source: 'lesson' }, FOCUS), null);
    assert.equal(db.createPlan({ source: 'round' }, FOCUS), null);
    assert.equal(db.createPlan(null, FOCUS), null);
  });

  test('one-outstanding-plan holds across both sources — §7.5', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    const fromRound = db.createPlan('round-1', FOCUS);
    const fromLesson = db.createPlan({ source: 'lesson', lessonId: l.lesson_id }, FOCUS);
    assert.equal(db.getPlan(fromRound.plan_id).status, 'superseded');
    assert.equal(db.getPlan(fromRound.plan_id).superseded_by, fromLesson.plan_id);
    assert.equal(db.getActivePlan().plan_id, fromLesson.plan_id);
  });

  test('a plan stored before lessons existed is normalized to a round plan on load', async () => {
    const db = await resetDB();
    const p = db.createPlan('round-1', FOCUS);
    // Simulate a record written by an earlier version of the app.
    const raw = JSON.parse(localStorage.getItem('rangelog_index_v1'));
    const stored = raw.practice_plans.find((x) => x.plan_id === p.plan_id);
    delete stored.source;
    delete stored.lesson_id;
    localStorage.setItem('rangelog_index_v1', JSON.stringify(raw));

    const fresh = await reload(db);
    const loaded = fresh.getPlan(p.plan_id);
    assert.equal(loaded.source, 'round');
    assert.equal(loaded.lesson_id, null);
  });

  test('deleting a lesson takes its plans and its focus, and nothing else', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    const roundPlan = db.createPlan('round-1', FOCUS);
    const lessonPlan = db.createPlan({ source: 'lesson', lessonId: l.lesson_id }, FOCUS);
    db.setActiveSwingFocus(l.lesson_id);

    const removed = db.deleteLesson(l.lesson_id);
    assert.equal(removed.plans.length, 1);
    assert.equal(removed.plans[0].plan_id, lessonPlan.plan_id);
    assert.equal(db.getPlan(lessonPlan.plan_id), null);
    assert.ok(db.getPlan(roundPlan.plan_id));
    assert.equal(db.getActiveSwingFocus(), null);
  });

  test('restoring an undone delete brings the lesson, its plans and its focus back', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.createPlan({ source: 'lesson', lessonId: l.lesson_id }, FOCUS);
    db.setActiveSwingFocus(l.lesson_id, 2);
    const removed = db.deleteLesson(l.lesson_id);

    assert.equal(db.restoreLesson(removed.lesson, removed.plans, removed.focus), true);
    assert.equal(db.getLesson(l.lesson_id).cues.length, 3);
    assert.ok(db.getPlanForLesson(l.lesson_id));
    assert.equal(db.getActiveSwingFocus().cue_text, 'Stay over it');
  });

  test('an undo does not yank away a focus the golfer chose in the meantime', async () => {
    const db = await resetDB();
    const a = db.createLesson(LESSON);
    const b = db.createLesson({ date: '2026-09-16', cues: ['different cue'] });
    db.setActiveSwingFocus(a.lesson_id);
    const removed = db.deleteLesson(a.lesson_id);
    db.setActiveSwingFocus(b.lesson_id);

    db.restoreLesson(removed.lesson, removed.plans, removed.focus);
    assert.equal(db.getActiveSwingFocus().lesson_id, b.lesson_id);
  });
});

describe('Backup and restore — lessons must not be silently dropped', () => {
  test('export carries lessons and the active focus; import restores both', async () => {
    const db = await resetDB();
    const l = db.createLesson(LESSON);
    db.setActiveSwingFocus(l.lesson_id, 3);
    const backup = JSON.parse(JSON.stringify(db.getDB()));
    assert.equal(backup.lessons.length, 1);
    assert.equal(backup.settings.active_swing_focus.cue_order, 3);

    const wiped = await resetDB();
    wiped.importFullDB(backup);
    assert.equal(wiped.listLessons().length, 1);
    assert.equal(wiped.getActiveSwingFocus().cue_text, 'Extend through');
  });

  test('a pre-V4.2 backup restores cleanly rather than erroring', async () => {
    const db = await resetDB();
    db.createLesson(LESSON);
    db.importFullDB({ schemaVersion: 4, sessions: [], shots: [], settings: {} });
    assert.deepEqual(db.listLessons(), []);
    assert.equal(db.getActiveSwingFocus(), null);
  });
});

// §3.1 and §8: three systems can want to tell the golfer what to work on.
// The resolution is a precedence order, not a merge — and Active Focus and
// Next Goal are different axes that must never be treated as alternatives.
// These tests exist because the failure mode is silent: a focus quietly
// retiring a goal would look like tidiness rather than like data loss.
describe('Active Focus and Next Goal coexist — §3.1, §8', () => {
  const LESSON_B = { date: '2026-09-13', instructor_name: 'Gaza', cues: ['Stay over it'] };

  function goalFor(db, sessionId) {
    return db.createGoal(sessionId, {
      type: 'solid_contact', target: 60, club: null,
      text: '60% solid contact', metric: 'solidPct',
    });
  }

  test('setting a focus never retires, alters or supersedes an outstanding goal', async () => {
    const db = await resetDB();
    const goal = goalFor(db, 'session-1');
    const lesson = db.createLesson(LESSON_B);
    db.setActiveSwingFocus(lesson.lesson_id);

    const after = db.getActiveGoal();
    assert.equal(after.goal_id, goal.goal_id);
    assert.equal(after.status, 'active');
    assert.equal(after.superseded_by, null);
    assert.equal(after.resolved_at, null);
  });

  test('a goal is not a focus and a focus is not a goal — neither collapses into the other', async () => {
    const db = await resetDB();
    goalFor(db, 'session-1');
    const lesson = db.createLesson(LESSON_B);
    db.setActiveSwingFocus(lesson.lesson_id);

    // Two live records of two different kinds, in two different collections.
    assert.equal(db.getActiveGoal().text, '60% solid contact');
    assert.equal(db.getActiveSwingFocus().cue_text, 'Stay over it');
    // A cue is never converted into a measurable target (§3.1).
    assert.equal(db.getActiveGoal().metric, 'solidPct');
    assert.equal(db.getActiveSwingFocus().cue_text.includes('%'), false);
  });

  test('clearing the focus leaves the goal standing, and vice versa', async () => {
    const db = await resetDB();
    const goal = goalFor(db, 'session-1');
    const lesson = db.createLesson(LESSON_B);
    db.setActiveSwingFocus(lesson.lesson_id);

    db.clearActiveSwingFocus();
    assert.equal(db.getActiveGoal().goal_id, goal.goal_id);

    db.setActiveSwingFocus(lesson.lesson_id);
    db.resolveGoal(goal.goal_id, 'met');
    assert.equal(db.getActiveGoal(), null);
    assert.equal(db.getActiveSwingFocus().cue_text, 'Stay over it');
  });

  test('a session started with both records both, independently', async () => {
    const db = await resetDB();
    goalFor(db, 'session-1');
    const lesson = db.createLesson(LESSON_B);
    db.setActiveSwingFocus(lesson.lesson_id);

    const s = db.createSession({
      date: '2026-09-17', start_time: '10:00', target_ball_count: 50,
      default_club: '7i', default_setup: 'normal', default_surface: 'mat', default_swing: 'full',
    });
    // The focus is snapshotted onto the session; the goal keeps living in
    // its own collection, evaluated by its own machinery.
    assert.equal(s.swing_focus.cue_text, 'Stay over it');
    assert.equal(s.swing_focus.target, undefined);
    assert.equal(db.getActiveGoal().status, 'active');
  });
});

// Records this app did not write itself — a hand-edited backup, a partial
// file, a file from an older build. db.js repairs their shape on the way in
// so that every reader can rely on it, and never invents content.
describe('A lesson from a damaged backup is repaired, not trusted', () => {
  test('a lesson with no cues array loads with an empty one instead of undefined', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 5, sessions: [], shots: [], settings: {},
      lessons: [{ lesson_id: 'x', date: '2026-09-13', instructor_name: 'Gaza' }],
    });
    const l = db.getLesson('x');
    // History's renderer reads cues[0] and cues.length unguarded; undefined
    // here threw and took down the app's main list screen.
    assert.deepEqual(l.cues, []);
    assert.deepEqual(l.drills, []);
    assert.deepEqual(l.topics, []);
    assert.deepEqual(l.video_ids, []);
    assert.equal(l.notes, '');
  });

  test('repair does not invent content, and the record stays editable', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 5, sessions: [], shots: [], settings: {},
      lessons: [{ lesson_id: 'x', date: '2026-09-13' }],
    });
    assert.equal(db.getLesson('x').cues.length, 0);
    const fixed = db.updateLesson('x', { cues: ['Stay over it'] });
    assert.deepEqual(fixed.cues, [{ order: 1, text: 'Stay over it' }]);
  });

  test('malformed cue entries are dropped rather than kept as junk', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 5, sessions: [], shots: [], settings: {},
      lessons: [{ lesson_id: 'x', date: '2026-09-13', cues: 'not an array' }],
    });
    assert.deepEqual(db.getLesson('x').cues, []);
  });

  // The repair used to run only in loadIndex(), which an import never passes
  // back through — so a restored backup stayed broken until the next reload.
  test('the repair applies at import time, not just on the next reload', async () => {
    const db = await resetDB();
    db.importFullDB({
      schemaVersion: 5, sessions: [], shots: [], settings: {},
      lessons: [{ lesson_id: 'x', date: '2026-09-13' }],
      practice_plans: [{ plan_id: 'p', round_id: 'r', status: 'saved', created_at: '2026-01-01' }],
    });
    // No reload between the import and these reads.
    assert.deepEqual(db.getLesson('x').cues, []);
    assert.equal(db.getPlan('p').source, 'round');
    assert.equal(db.getPlan('p').lesson_id, null);
  });
});
