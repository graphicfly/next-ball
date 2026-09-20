import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetDB } from './setup.js';
import * as P from '../js/practice.js';

const CHIP_SCREEN = fs.readFileSync(new URL('../js/screens/chippingSession.js', import.meta.url), 'utf8');
const PUTT_SCREEN = fs.readFileSync(new URL('../js/screens/puttingSession.js', import.meta.url), 'utf8');
const CANVAS = fs.readFileSync(new URL('../js/screens/practiceCanvas.js', import.meta.url), 'utf8');
const EDIT = fs.readFileSync(new URL('../js/screens/practiceEdit.js', import.meta.url), 'utf8');

const CHIP_SETUP = { club: 'GW', lie: 'rough', surface: 'grass', distance_yds: 15 };
const chipSession = (db, practice_type = 'standard') =>
  db.createPracticeSession({ mode: 'chipping', practice_type, target_ball_count: 30, setup: CHIP_SETUP });
const puttSession = (db, { kind = 'short', practice_type = 'short', setup = { distance_ft: 5, surface: 'green' } } = {}) =>
  db.createPracticeSession({ mode: 'putting', kind, practice_type, target_ball_count: 20, setup });

describe('Ball count means balls COMPLETED', () => {
  test('a new session reads 0, and the first ball makes it 1', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    assert.equal(db.listChips(s.session_id).length, 0);
    db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    assert.equal(db.listChips(s.session_id).length, 1, 'completed, never the ball about to be hit');
  });

  test('the target is stored and survives a reload', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    db.__resetForTests();
    assert.equal(db.getPracticeSession(s.session_id).target_ball_count, 30);
  });

  test('a session written before ball counts existed gains a default', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    const raw = JSON.parse(localStorage.getItem('rangelog_index_v1'));
    delete raw.practice_sessions.find((p) => p.session_id === s.session_id).target_ball_count;
    localStorage.setItem('rangelog_index_v1', JSON.stringify(raw));
    db.__resetForTests();
    assert.equal(typeof db.getPracticeSession(s.session_id).target_ball_count, 'number');
  });
});

describe('Chipping commits on the proximity tap', () => {
  test('an ordinary chip carries Solid without anyone tapping Solid', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    // What the screen sends for a single ring tap with nothing armed.
    const chip = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6', miss_depth: null, miss_lateral: null });
    assert.equal(chip.contact, 'solid');
    assert.equal(chip.prox_bucket, '3_6');
    assert.equal(chip.miss_depth, null);
    assert.equal(chip.miss_lateral, null);
  });

  test('contact defaults to solid and resets after every commit', () => {
    assert.match(CHIP_SCREEN, /let contact = 'solid'/);
    assert.match(CHIP_SCREEN, /contact = 'solid';/, 'resetArmed must restore it');
  });

  test('armed miss axes are independent and both reach the record', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    const depthOnly = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '6_10', miss_depth: 'short', miss_lateral: null });
    const lateralOnly = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '6_10', miss_depth: null, miss_lateral: 'right' });
    const both = db.addChip(s.session_id, { contact: 'thin', prox_bucket: '10_20', miss_depth: 'short', miss_lateral: 'right' });
    assert.deepEqual([depthOnly.miss_depth, depthOnly.miss_lateral], ['short', null]);
    assert.deepEqual([lateralOnly.miss_depth, lateralOnly.miss_lateral], [null, 'right']);
    assert.deepEqual([both.miss_depth, both.miss_lateral, both.contact], ['short', 'right', 'thin']);
  });

  test('the armed state is cleared after a commit', () => {
    assert.match(CHIP_SCREEN, /missDepth = null;[\s\S]{0,40}missLateral = null;/);
  });

  test('there is no Next Ball button and no review state', () => {
    assert.ok(!/Next ball|nextBtn|STEP\.DONE|drawAddendum/.test(CHIP_SCREEN),
      'a screen whose job is to show what was just entered has no place between balls');
  });
});

describe('A rapid second tap is the same tap', () => {
  test('the commit lock is held for the feedback window, not released inline', () => {
    // Releasing synchronously guarded nothing: three taps in one tick each
    // ran to completion and wrote three records.
    assert.match(CHIP_SCREEN, /setTimeout\(\(\) => \{ busy = false; \}, FEEDBACK_MS\)/);
    assert.match(PUTT_SCREEN, /setTimeout\(\(\) => \{ busy = false; \}, FEEDBACK_MS\)/);
  });

  test('feedback is brief enough not to slow real logging', () => {
    const ms = Number(CHIP_SCREEN.match(/FEEDBACK_MS = (\d+)/)[1]);
    assert.ok(ms >= 150 && ms <= 300, `feedback window was ${ms}ms`);
  });
});

describe('Undo and Edit previous', () => {
  test('undo removes the last chip and the count follows', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3' });
    db.addChip(s.session_id, { contact: 'thin', prox_bucket: '6_10' });
    const removed = db.deleteLastChip(s.session_id);
    assert.equal(removed.prox_bucket, '6_10');
    assert.equal(db.listChips(s.session_id).length, 1);
  });

  test('editing changes the existing record rather than adding one', async () => {
    const db = await resetDB();
    const s = chipSession(db);
    const chip = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '10_20' });
    db.updateChip(s.session_id, chip.chip_id, { contact: 'fat', prox_bucket: '3_6' });
    const chips = db.listChips(s.session_id);
    assert.equal(chips.length, 1, 'no duplicate');
    assert.equal(chips[0].chip_id, chip.chip_id, 'same record');
    assert.equal(chips[0].contact, 'fat');
  });

  test('the editor does not auto-advance', () => {
    // Live logging and correcting a record are different modes: auto-advance
    // in an editor means a mis-tap rewrites and closes.
    assert.match(EDIT, /saveEdit/);
    assert.ok(!/busy|FEEDBACK_MS|auto/.test(EDIT), 'no live-logging behaviour in the editor');
  });
});

describe('Short putting is one tap in every direction', () => {
  test('made stores nothing but the make', async () => {
    const db = await resetDB();
    const s = puttSession(db);
    const p = db.addPutt(s.session_id, { result: 'made' });
    assert.equal(p.result, 'made');
    assert.equal(p.miss_lateral, null);
    assert.equal(p.miss_depth, null);
  });

  test('each miss direction is a single result region', async () => {
    const db = await resetDB();
    const s = puttSession(db);
    const cases = [
      ['miss_lateral', 'left'], ['miss_lateral', 'right'],
      ['miss_depth', 'short'], ['miss_depth', 'long'],
    ];
    for (const [axis, value] of cases) {
      const p = db.addPutt(s.session_id, { result: 'missed', [axis]: value });
      assert.equal(p.result, 'missed');
      assert.equal(p[axis], value, `${value} must commit from its own region`);
    }
    assert.equal(db.listPutts(s.session_id).length, 4);
  });

  test('the grid places the four directions spatially around the cup', () => {
    assert.match(CANVAS, /'Long', 'miss_depth', 'long'/);
    assert.match(CANVAS, /'Short', 'miss_depth', 'short'/);
    assert.match(CANVAS, /'Left', 'miss_lateral', 'left'/);
    assert.match(CANVAS, /'Right', 'miss_lateral', 'right'/);
  });
});

describe('Distance control commits proximity and pace together', () => {
  test('every matrix cell is one tap', async () => {
    const db = await resetDB();
    const s = puttSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    for (const bucket of P.LEAVE_BUCKETS) {
      for (const dir of P.PACE) {
        const p = db.addPutt(s.session_id, { result: 'missed', leave_bucket: bucket, leave_dir: dir });
        assert.equal(p.leave_bucket, bucket);
        assert.equal(p.leave_dir, dir);
      }
    }
    assert.equal(db.listPutts(s.session_id).length, 6);
  });

  test('holed is a make with no leave fields', async () => {
    const db = await resetDB();
    const s = puttSession(db, { kind: 'distance', practice_type: 'distance', setup: { distance_ft: 30, surface: 'green' } });
    const p = db.addPutt(s.session_id, { result: 'made' });
    assert.equal(p.leave_bucket, null);
    assert.equal(p.leave_dir, null);
  });
});

describe('Drills keep their shape under one-tap logging', () => {
  test('Landing Zone commits hit or missed in one tap and needs no proximity', async () => {
    const db = await resetDB();
    const s = chipSession(db, 'landing_zone');
    const hit = db.addChip(s.session_id, { zone_hit: true, contact: 'solid' });
    const miss = db.addChip(s.session_id, { zone_hit: false, contact: 'solid' });
    assert.equal(hit.zone_hit, true);
    assert.equal(miss.zone_hit, false);
    assert.equal(hit.prox_bucket, null, 'proximity stays optional');
  });

  test('a holed chip in Up & Down skips the putt step and stores zero', async () => {
    const db = await resetDB();
    const s = chipSession(db, 'up_and_down');
    const chip = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'holed', putts: 0 });
    assert.equal(chip.putts, 0);
    assert.equal(P.isHoled(chip.prox_bucket), true);
    assert.equal(P.isUpAndDown(chip), true);
    // The screen must branch before ever showing the putts step.
    assert.match(CHIP_SCREEN, /if \(isHoled\(bucket\)\) \{[\s\S]{0,400}putts: 0/);
  });

  test('one, two and three putts all derive correctly', async () => {
    const db = await resetDB();
    const s = chipSession(db, 'up_and_down');
    const one = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3', putts: 1 });
    const two = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6', putts: 2 });
    const three = db.addChip(s.session_id, { contact: 'fat', prox_bucket: '20_plus', putts: 3 });
    assert.equal(P.isUpAndDown(one), true);
    assert.equal(P.isUpAndDown(two), false);
    assert.equal(P.isUpAndDown(three), false);
  });

  test('Up & Down stays on one screen', () => {
    assert.ok(!/location\.hash = .#\/chipping\/.*putts/.test(CHIP_SCREEN), 'no route change for the putts step');
    assert.match(CHIP_SCREEN, /awaitingPutts/);
  });

  test('Pressure Finish derives its streak and stays one tap', async () => {
    const db = await resetDB();
    const s = puttSession(db, { practice_type: 'pressure_finish', setup: { distance_ft: 6, surface: 'green', streak_target: 3 } });
    for (const r of ['made', 'made', 'missed', 'made']) db.addPutt(s.session_id, { result: r });
    const putts = db.listPutts(s.session_id);
    let run = 0;
    for (let i = putts.length - 1; i >= 0; i--) { if (putts[i].result === 'made') run += 1; else break; }
    assert.equal(run, 1, 'the miss reset it');
    // Derived, never stored.
    assert.ok(putts.every((p) => !('streak' in p)));
  });
});

describe('Around the Green stays variable under the fast canvas', () => {
  test('no lie or distance is recorded, and the prompt needs no confirmation', async () => {
    const db = await resetDB();
    const s = chipSession(db, 'around_green');
    const chip = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    assert.equal(chip.lie, null);
    assert.equal(chip.distance_yds, null);
    assert.match(CHIP_SCREEN, /Move to a new spot/);
    assert.ok(!/confirm|Continue|OK/.test(CHIP_SCREEN.match(/Move to a new spot.{0,120}/s)[0]));
  });
});

describe('Touch targets are glove-sized', () => {
  const CSS = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

  test('every secondary control clears 44px', () => {
    for (const cls of ['.mini-toggle', '.practice-secondary']) {
      const block = CSS.slice(CSS.indexOf(cls));
      const m = block.match(/min-height:\s*(\d+)px/);
      assert.ok(m && Number(m[1]) >= 44, `${cls} min-height was ${m && m[1]}`);
    }
  });

  test('primary result regions are far larger than that', () => {
    for (const [cls, min] of [['.putt-cell', 76], ['.lag-cell', 52], ['.binary-cell', 96]]) {
      const block = CSS.slice(CSS.indexOf(`\n${cls}`));
      const m = block.match(/min-height:\s*(\d+)px/);
      assert.ok(m && Number(m[1]) >= min, `${cls} min-height was ${m && m[1]}`);
    }
  });

  test('nothing depends on a gesture a gloved hand cannot make', () => {
    for (const src of [CHIP_SCREEN, PUTT_SCREEN, CANVAS]) {
      assert.ok(!/longpress|contextmenu|touchmove|dragstart|swipe/i.test(src));
    }
  });
});
