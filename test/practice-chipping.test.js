import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetDB } from './setup.js';
import * as P from '../js/practice.js';
import { chippingSummary } from '../js/practiceSummary.js';

const SETUP = { club: 'GW', lie: 'rough', surface: 'grass', distance_yds: 15 };

async function chippingSession(db, { practice_type = 'standard', setup = SETUP } = {}) {
  return db.createPracticeSession({ mode: 'chipping', practice_type, setup });
}

describe('Chipping sessions are their own model, not a Range Shot', () => {
  test('context lives on the SESSION and is copied onto every chip', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3' });
    // Denormalised, so correcting a setup later never relabels balls already
    // hit (practice-spec.md §3).
    assert.equal(c.club, 'GW');
    assert.equal(c.lie, 'rough');
    assert.equal(c.surface, 'grass');
    assert.equal(c.distance_yds, 15);
  });

  test('every lie and both surfaces round-trip', async () => {
    const db = await resetDB();
    for (const lie of P.LIES) {
      for (const surface of P.SURFACES) {
        const s = await chippingSession(db, { setup: { ...SETUP, lie, surface } });
        const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
        assert.equal(c.lie, lie);
        assert.equal(c.surface, surface);
      }
    }
  });

  test('every proximity bucket stores as the category it is', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    for (const b of P.PROX_BUCKETS) {
      const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: b });
      assert.equal(c.prox_bucket, b);
    }
    assert.equal(db.listChips(s.session_id).length, P.PROX_BUCKETS.length);
  });

  test('NO fabricated proximity in feet, anywhere on the record', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '10_20' });
    // §7. Not a midpoint, not an estimate, not a hidden field for one.
    for (const key of Object.keys(c)) {
      assert.ok(!/^proximity_ft$|_ft$|feet/.test(key), `${key} would be a fabricated distance`);
    }
  });

  test('a chip survives a reload', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    db.addChip(s.session_id, { contact: 'thin', prox_bucket: '6_10' });
    db.__resetForTests();
    const chips = db.listChips(s.session_id);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].contact, 'thin');
  });
});

describe('Optional miss is two axes, and skipping writes nothing', () => {
  test('depth and direction are independent', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '6_10', miss_depth: 'short' });
    // §9: noticing depth and not direction is the common case. A single
    // four-value enum would force a false choice here.
    assert.equal(c.miss_depth, 'short');
    assert.equal(c.miss_lateral, null);
  });

  test('skipping the optional row leaves both null', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    assert.equal(c.miss_depth, null);
    assert.equal(c.miss_lateral, null);
  });

  test('an axis can be cleared after a wrong tap', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6', miss_depth: 'long' });
    db.updateChip(s.session_id, c.chip_id, { miss_depth: null });
    assert.equal(db.listChips(s.session_id)[0].miss_depth, null);
  });
});

describe('Landing Zone is about execution', () => {
  test('hit and missed are the primary result', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'landing_zone' });
    const hit = db.addChip(s.session_id, { zone_hit: true });
    const miss = db.addChip(s.session_id, { zone_hit: false });
    assert.equal(hit.zone_hit, true);
    assert.equal(miss.zone_hit, false);
    // §11: proximity is never required by the drill.
    assert.equal(hit.prox_bucket, null);
  });

  test('proximity may be added afterwards without being required', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'landing_zone' });
    const c = db.addChip(s.session_id, { zone_hit: true });
    db.updateChip(s.session_id, c.chip_id, { prox_bucket: 'in_3' });
    assert.equal(db.listChips(s.session_id)[0].prox_bucket, 'in_3');
  });

  test('the summary leads with zone success, not proximity', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'landing_zone' });
    for (let i = 0; i < 10; i++) db.addChip(s.session_id, { zone_hit: i < 7 });
    const sum = chippingSummary(db.getPracticeSession(s.session_id), db.listChips(s.session_id));
    assert.equal(sum.headline.value, '70%');
    assert.match(sum.headline.label, /landing zone/);
  });
});

describe('Around the Green does not record a situation it never asked for', () => {
  test('lie and distance are absent, not guessed', async () => {
    const db = await resetDB();
    // Even when a setup carries them, a variable-practice session must not
    // stamp them onto balls hit from somewhere else (§13).
    const s = await chippingSession(db, { practice_type: 'around_green', setup: SETUP });
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    assert.equal(c.lie, null, 'a lie that was never observed must not be stored');
    assert.equal(c.distance_yds, null, 'a distance that was never observed must not be stored');
    assert.equal(c.club, 'GW', 'the club is genuinely known and is kept');
  });

  test('it is marked as variable practice', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'around_green' });
    assert.equal(P.isVariablePractice(db.getPracticeSession(s.session_id)), true);
    const fixed = await chippingSession(db, { practice_type: 'standard' });
    assert.equal(P.isVariablePractice(db.getPracticeSession(fixed.session_id)), false);
  });
});

describe('Up & Down is derived, never stored or confirmed', () => {
  test('a holed chip stores zero putts and counts as successful', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'up_and_down' });
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'holed', putts: 0 });
    // §12: the putt screen is skipped and the golfer is never asked to
    // confirm the result.
    assert.equal(c.putts, 0);
    assert.equal(P.isUpAndDown(c), true);
  });

  test('one putt is an up and down; two is not', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'up_and_down' });
    const one = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3', putts: 1 });
    const two = db.addChip(s.session_id, { contact: 'thin', prox_bucket: '6_10', putts: 2 });
    const three = db.addChip(s.session_id, { contact: 'fat', prox_bucket: '20_plus', putts: 3 });
    assert.equal(P.isUpAndDown(one), true);
    assert.equal(P.isUpAndDown(two), false);
    assert.equal(P.isUpAndDown(three), false);
  });

  test('up_and_down is not a stored field', async () => {
    const db = await resetDB();
    const s = await chippingSession(db, { practice_type: 'up_and_down' });
    const c = db.addChip(s.session_id, { contact: 'solid', prox_bucket: 'in_3', putts: 1 });
    // Storing it would let the chip and the putt count contradict each
    // other, which is exactly what §12 forbids.
    assert.equal('up_and_down' in c, false);
    assert.equal('holed_out' in c, false);
  });
});

describe('The summary never invents what was not collected', () => {
  test('no miss data means NO pattern block — not an empty one', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    for (let i = 0; i < 18; i++) db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    const sum = chippingSummary(db.getPracticeSession(s.session_id), db.listChips(s.session_id));
    assert.equal(sum.pattern, null, 'absent, not empty and not caveated');
    assert.ok(sum.headline, 'the headline still stands on data that WAS collected');
  });

  test('one logged miss out of eighteen is not a pattern', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    for (let i = 0; i < 17; i++) db.addChip(s.session_id, { contact: 'solid', prox_bucket: '3_6' });
    db.addChip(s.session_id, { contact: 'thin', prox_bucket: '10_20', miss_depth: 'short' });
    const sum = chippingSummary(db.getPracticeSession(s.session_id), db.listChips(s.session_id));
    assert.equal(sum.pattern, null, 'coverage of 6% cannot carry a tendency');
  });

  test('a real pattern prints the coverage behind it', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    for (let i = 0; i < 18; i++) {
      db.addChip(s.session_id, { contact: 'solid', prox_bucket: '6_10', miss_depth: i < 8 ? 'short' : (i < 11 ? 'long' : null) });
    }
    const sum = chippingSummary(db.getPracticeSession(s.session_id), db.listChips(s.session_id));
    assert.ok(sum.pattern, 'enough was logged to say something');
    assert.match(sum.pattern.text, /finished short/);
    // §10: every pattern prints its own coverage.
    assert.match(sum.pattern.basis, /11 of the 18/);
    assert.match(sum.pattern.basis, /8 of those/);
  });

  test('proximity buckets never become an average distance', async () => {
    const db = await resetDB();
    const s = await chippingSession(db);
    for (const b of ['in_3', '3_6', '10_20', '20_plus']) db.addChip(s.session_id, { contact: 'solid', prox_bucket: b });
    const sum = chippingSummary(db.getPracticeSession(s.session_id), db.listChips(s.session_id));
    const text = JSON.stringify(sum);
    assert.ok(!/avg|average|\d+\.\d+ ft/i.test(text), `a midpoint average leaked into the summary: ${text}`);
  });
});
