import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import * as P from '../js/practice.js';
import { shortGameOverview, puttingOverview, mayClaimTrend } from '../js/practiceProgress.js';
import { roundsStatement, practiceStatement, boundaryBlocks, roundsInputFrom } from '../js/practiceBoundary.js';
import fs from 'node:fs';

function seedChipping(db, { sessions, chipsEach, surface = 'grass', practice_type = 'standard' }) {
  const made = [];
  for (let i = 0; i < sessions; i++) {
    const s = db.createPracticeSession({
      mode: 'chipping', practice_type,
      setup: { club: 'GW', lie: 'rough', surface, distance_yds: 15 },
    });
    db.finishPracticeSession(s.session_id);
    for (let j = 0; j < chipsEach; j++) db.addChip(s.session_id, { contact: 'solid', prox_bucket: j % 2 ? '3_6' : '10_20' });
    made.push(s);
  }
  return made;
}

describe('Describing and claiming are separate acts', () => {
  test('one session is not enough to break down by surface', async () => {
    const db = await resetDB();
    seedChipping(db, { sessions: 1, chipsEach: 40, surface: 'grass' });
    seedChipping(db, { sessions: 1, chipsEach: 40, surface: 'mat' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    // practice-spec.md §21: 2 sessions AND 20 shots per surface, both.
    assert.deepEqual(o.surfaces, [], 'plenty of shots, not enough sessions');
    assert.ok(o.headline, 'the all-chipping headline still stands');
  });

  test('too few shots per surface is not enough either', async () => {
    const db = await resetDB();
    seedChipping(db, { sessions: 3, chipsEach: 5, surface: 'grass' });
    seedChipping(db, { sessions: 3, chipsEach: 5, surface: 'mat' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    assert.deepEqual(o.surfaces, []);
  });

  test('enough of both produces a descriptive breakdown', async () => {
    const db = await resetDB();
    seedChipping(db, { sessions: 2, chipsEach: 12, surface: 'grass' });
    seedChipping(db, { sessions: 2, chipsEach: 12, surface: 'mat' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    assert.equal(o.surfaces.length, 2, 'both surfaces described');
    assert.ok(o.surfaces.every((s) => /%$/.test(s.value)));
  });

  test('a descriptive breakdown never carries trend language', async () => {
    const db = await resetDB();
    seedChipping(db, { sessions: 2, chipsEach: 12, surface: 'grass' });
    seedChipping(db, { sessions: 2, chipsEach: 12, surface: 'mat' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    const text = JSON.stringify(o).toLowerCase();
    for (const w of ['improv', 'better', 'worse', 'up ', 'down ', '↑', '↓', 'trend']) {
      assert.ok(!text.includes(w), `"${w}" is a claim, and this is a description`);
    }
  });

  test('a trend claim needs the stronger threshold AND comparability', () => {
    // §21: when the comparison is not comparable the delta is SUPPRESSED,
    // not annotated.
    assert.equal(mayClaimTrend({ sessions: 3, shots: 30, comparable: true }), true);
    assert.equal(mayClaimTrend({ sessions: 3, shots: 30, comparable: false }), false);
    assert.equal(mayClaimTrend({ sessions: 2, shots: 60, comparable: true }), false);
    assert.equal(mayClaimTrend({ sessions: 5, shots: 20, comparable: true }), false);
  });
});

describe('Around the Green is held separately and claims nothing situational', () => {
  test('it never reaches the by-surface breakdown', async () => {
    const db = await resetDB();
    seedChipping(db, { sessions: 4, chipsEach: 30, surface: 'grass', practice_type: 'around_green' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    // §13.1: the conditions were deliberately never collected, so no
    // amount of volume earns a situational comparison.
    assert.deepEqual(o.surfaces, []);
    assert.ok(o.variable, 'it is still counted, just held apart');
    assert.equal(o.variable.chips, 120);
  });

  test('variable practice produces no lie or distance claim', async () => {
    const db = await resetDB();
    const [s] = seedChipping(db, { sessions: 1, chipsEach: 20, practice_type: 'around_green' });
    const chips = db.listChips(s.session_id);
    assert.ok(chips.every((c) => c.lie === null && c.distance_yds === null));
    const st = practiceStatement(db.listFinishedPracticeSessions(), { chipsFor: db.listChips, puttsFor: db.listPutts });
    assert.equal(st, null, 'nothing from a session whose situation is unknown');
  });
});

describe('Progress is empty, not zero', () => {
  test('no practice means no headline', async () => {
    const db = await resetDB();
    const o = shortGameOverview([], db.listChips);
    const p = puttingOverview([], db.listPutts);
    assert.equal(o.headline, null);
    assert.equal(p.headline, null);
    assert.equal(o.chips, 0);
  });

  test('test data never reaches Progress', async () => {
    const db = await resetDB();
    const s = db.createPracticeSession({ mode: 'chipping', practice_type: 'standard', setup: { club: 'GW', surface: 'grass', lie: 'rough', distance_yds: 10 }, data_source: 'test' });
    db.finishPracticeSession(s.session_id);
    for (let i = 0; i < 30; i++) db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3' });
    const o = shortGameOverview(db.listFinishedPracticeSessions(), db.listChips);
    assert.equal(o.headline, null, 'seeded data must not appear as practice');
  });
});

describe('Course and Practice never share a sentence', () => {
  test('rounds speak only in the vocabulary they collect', () => {
    const s = roundsStatement({ shortGameStrokes: 12, putts: 34, threePutts: 0, rounds: 3 });
    assert.ok(s);
    assert.equal(s.provenance, 'rounds');
    // §23 rule 1: a category statement, never a causal ranking or a
    // judgement about something unobserved.
    const t = s.text.toLowerCase();
    assert.ok(!/cost you|your chipping is|because|caused/.test(t));
  });

  test('putting earns stronger language because putts are counted', () => {
    const s = roundsStatement({ shortGameStrokes: 10, putts: 40, threePutts: 4, rounds: 3 });
    assert.match(s.text, /four|4 three-putt/i);
  });

  test('the two blocks stay separate and are labelled', async () => {
    const db = await resetDB();
    const s = db.createPracticeSession({ mode: 'putting', kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    db.finishPracticeSession(s.session_id);
    for (let i = 0; i < 12; i++) db.addPutt(s.session_id, { result: 'missed', leave_bucket: 'in_3', leave_dir: 'short' });

    const blocks = boundaryBlocks(
      { shortGameStrokes: 12, putts: 36, threePutts: 0, rounds: 3 },
      db.listFinishedPracticeSessions(),
      { chipsFor: db.listChips, puttsFor: db.listPutts },
    );
    assert.equal(blocks.fromRounds.provenance, 'rounds');
    assert.equal(blocks.fromPractice.provenance, 'practice');
    assert.notEqual(blocks.fromRounds.text, blocks.fromPractice.text);
    // §23 rule 4: Focus comes from practice.
    assert.equal(blocks.focus, blocks.fromPractice.text);
  });

  test('with no practice data there is no Focus row', async () => {
    const db = await resetDB();
    const blocks = boundaryBlocks({ shortGameStrokes: 12, putts: 30, threePutts: 0, rounds: 3 }, [], { chipsFor: db.listChips, puttsFor: db.listPutts });
    assert.equal(blocks.focus, null);
    assert.equal(blocks.fromPractice, null);
    assert.ok(blocks.fromRounds, 'rounds can still speak for themselves');
  });
});

describe('The boundary is actually wired into Next Practice', () => {
  const PLAN = fs.readFileSync(new URL('../js/screens/practicePlan.js', import.meta.url), 'utf8');

  test('the plan screen renders both blocks separately', () => {
    assert.match(PLAN, /boundaryBlocks/);
    assert.match(PLAN, /From your rounds/);
    assert.match(PLAN, /From your practice/);
    // §23 rule 3: separate blocks, never one sentence.
    assert.ok(!/fromRounds\.text\s*\+\s*|`\$\{evidence\.fromRounds\.text\}[^<]*\$\{evidence\.fromPractice/.test(PLAN),
      'the two provenances must never be concatenated');
  });

  test('a lesson-derived plan has no rounds evidence', () => {
    // A lesson has no rounds to speak from, so the block is absent rather
    // than empty.
    assert.match(PLAN, /src\.kind === 'round'/);
  });

  test('the rounds aggregator reads only what Course Mode records', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'QA', source: 'manual', hole_count: 9 });
    const ids = [];
    for (let r = 0; r < 3; r++) {
      const round = db.createRound({ course_id: course.course_id, course_name: 'QA', date: '2026-09-1' + r, hole_count: 9 });
      for (let h = 1; h <= 9; h++) db.upsertHole(round.round_id, h, { par: 4, score: 5, putts: h <= 2 ? 3 : 2, short_game_strokes: 1 });
      db.finishRound(round.round_id);
      ids.push(round.round_id);
    }
    const input = roundsInputFrom(db.listFinishedRounds(), db.getHolesForRound);
    assert.equal(input.rounds, 3);
    assert.equal(input.threePutts, 6, 'two three-putts per round across three rounds');
    assert.equal(input.shortGameStrokes, 27);
    // Nothing a round cannot observe may appear in the aggregate.
    for (const key of Object.keys(input)) {
      assert.ok(!/chip|lie|proximity|miss|distance_ft/.test(key), `${key} is not something a round knows`);
    }
  });

  test('an unfinished or test round is not spoken from', async () => {
    const db = await resetDB();
    const course = db.upsertCourse({ name: 'QA', source: 'manual', hole_count: 9 });
    const live = db.createRound({ course_id: course.course_id, course_name: 'QA', date: '2026-09-20', hole_count: 9 });
    db.upsertHole(live.round_id, 1, { par: 4, score: 6, putts: 3 });
    assert.equal(roundsInputFrom(db.listFinishedRounds(), db.getHolesForRound).rounds, 0);
  });

  test('one round is not "recently"', () => {
    assert.equal(roundsStatement({ shortGameStrokes: 12, putts: 34, threePutts: 4, rounds: 1 }), null);
  });
});
