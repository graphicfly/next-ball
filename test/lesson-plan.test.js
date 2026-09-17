import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import { lessonPracticeFocus } from '../js/lessonPlan.js';
import { isRangePracticable, planBallCount } from '../js/roundAnalysis.js';

// Lesson -> practice plan — docs/lesson-spec.md §4. The screen is DOM and is
// exercised in the browser; every decision it makes comes from the function
// tested here.

const LESSON = { date: '2026-09-13', instructor_name: 'Gaza', cues: ['Stay over it', 'Pressure left'] };

describe('A lesson-derived plan is the same object with a different origin — §4.1', () => {
  test('its reason line is the instructor cue, verbatim — §4.2', async () => {
    const db = await resetDB();
    const lesson = db.createLesson({ ...LESSON, cues: ['  stay over it, dont slide  '] });
    const plan = lessonPracticeFocus(lesson);
    // Not summarised, not capitalised, not tidied into a rationale.
    assert.equal(plan.focus_rationale, 'stay over it, dont slide');
  });

  test('the title names the lesson and never interprets the cue', async () => {
    const db = await resetDB();
    const withCoach = db.createLesson(LESSON);
    const without = db.createLesson({ date: '2026-09-14', cues: ['Stay over it'] });
    assert.equal(lessonPracticeFocus(withCoach).focus_title, 'Lesson with Gaza');
    assert.equal(lessonPracticeFocus(without).focus_title, 'Your lesson');
  });

  test('the goal is about carrying the cue, not a fabricated metric — §3.1', async () => {
    const db = await resetDB();
    const plan = lessonPracticeFocus(db.createLesson(LESSON));
    assert.match(plan.goal_text, /one thought/i);
    assert.doesNotMatch(plan.goal_text, /\d+\s*%/);
  });

  test('it builds from the cue the focus names, not always cue 1', async () => {
    const db = await resetDB();
    const lesson = db.createLesson(LESSON);
    assert.equal(lessonPracticeFocus(lesson, { cueOrder: 2 }).focus_rationale, 'Pressure left');
  });

  test('every lesson plan is practicable on a range — §11.8', async () => {
    const db = await resetDB();
    assert.equal(isRangePracticable(lessonPracticeFocus(db.createLesson(LESSON)).signal), true);
  });
});

describe('Steps are practice structure, never swing advice', () => {
  test('drills become the steps, word for word', async () => {
    const db = await resetDB();
    const lesson = db.createLesson({ ...LESSON, drills: ['10 half swings w 9i', '5 alternating PW/9i'] });
    const steps = lessonPracticeFocus(lesson).steps;
    assert.deepEqual(steps.map((s) => s.title), ['10 half swings w 9i', '5 alternating PW/9i']);
    // The instructor wrote a sentence, not a prescription — inventing a ball
    // count would put a fabricated number in front of the golfer.
    assert.deepEqual(steps.map((s) => s.ball_count), [null, null]);
    assert.equal(planBallCount(steps), null);
  });

  test('without drills, the fallback quotes the cue and never rewrites it', async () => {
    const db = await resetDB();
    const steps = lessonPracticeFocus(db.createLesson(LESSON)).steps;
    assert.equal(steps.length, 3);
    assert.equal(steps[1].title, '20 swings holding “Stay over it”');
    // Real quote characters — an HTML entity would be escaped and shown
    // literally by every renderer in the app.
    assert.doesNotMatch(steps[1].title, /&[a-z]+;/);
    assert.equal(planBallCount(steps), 40);
  });

  test('steps are numbered from 1 in order, whichever path produced them', async () => {
    const db = await resetDB();
    const a = lessonPracticeFocus(db.createLesson({ ...LESSON, drills: ['x', 'y', 'z'] })).steps;
    const b = lessonPracticeFocus(db.createLesson({ date: '2026-09-14', cues: ['c'] })).steps;
    assert.deepEqual(a.map((s) => s.order), [1, 2, 3]);
    assert.deepEqual(b.map((s) => s.order), [1, 2, 3]);
  });
});

describe('Saving a lesson plan — §4.4', () => {
  test('the plan copies the cue, so editing the lesson does not rewrite it', async () => {
    const db = await resetDB();
    const lesson = db.createLesson(LESSON);
    const saved = db.createPlan({ source: 'lesson', lessonId: lesson.lesson_id }, lessonPracticeFocus(lesson));

    db.updateLesson(lesson.lesson_id, { cues: ['Stay over it longer', 'Pressure left'] });

    assert.equal(db.getPlan(saved.plan_id).focus_rationale, 'Stay over it');
    // The present is corrected; the saved plan records what was true when
    // it was made.
    db.setActiveSwingFocus(lesson.lesson_id, 1);
    assert.equal(db.getActiveSwingFocus().cue_text, 'Stay over it longer');
  });

  test('a lesson plan runs the same start-as-range-session path as a round plan', async () => {
    const db = await resetDB();
    const lesson = db.createLesson(LESSON);
    const saved = db.createPlan({ source: 'lesson', lessonId: lesson.lesson_id }, lessonPracticeFocus(lesson));
    assert.equal(db.getActivePlan().plan_id, saved.plan_id);

    const session = db.createSession({
      date: '2026-09-17', start_time: '10:00', target_ball_count: 40,
      default_club: '7i', default_setup: 'normal', default_surface: 'mat', default_swing: 'full',
    });
    db.resolvePlan(saved.plan_id, 'started', { startedSessionId: session.session_id });

    assert.equal(db.getPlanForSession(session.session_id).plan_id, saved.plan_id);
    assert.equal(db.getPlan(saved.plan_id).status, 'started');
  });

  test('a dismissed lesson plan stops being outstanding but keeps its lesson', async () => {
    const db = await resetDB();
    const lesson = db.createLesson(LESSON);
    const saved = db.createPlan({ source: 'lesson', lessonId: lesson.lesson_id }, lessonPracticeFocus(lesson));
    db.resolvePlan(saved.plan_id, 'dismissed');
    assert.equal(db.getActivePlan(), null);
    assert.equal(db.getPlan(saved.plan_id).lesson_id, lesson.lesson_id);
  });
});
