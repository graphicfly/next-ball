import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// The shared rapid-tap guard. Every screen that commits a record routes
// through it, so its contract is worth pinning down here rather than
// re-establishing it screen by screen.
//
// ui.js needs a DOM to import, so the guard is duplicated in spirit by
// importing it through the same harness the screens use.
const { commitOnce } = await import('../js/ui.js');

describe('commitOnce — the second tap of a double tap does nothing', () => {
  test('a committing handler runs exactly once, however many taps arrive', () => {
    let runs = 0;
    const guarded = commitOnce(() => { runs += 1; });
    guarded(); guarded(); guarded();
    assert.equal(runs, 1);
  });

  test('later taps return undefined rather than throwing', () => {
    const guarded = commitOnce(() => 'committed');
    assert.equal(guarded(), 'committed');
    assert.equal(guarded(), undefined);
  });

  test('arguments and `this` reach the handler unchanged', () => {
    let seen = null;
    const owner = { name: 'owner', go: commitOnce(function go(a, b) { seen = [this.name, a, b]; }) };
    owner.go('x', 2);
    assert.deepEqual(seen, ['owner', 'x', 2]);
  });

  // The re-arm contract is what stops the guard turning a validation
  // message into a dead button: "A lesson needs at least one cue" must not
  // mean the golfer can never save again.
  test('returning false re-arms it, so a corrected retry still commits', () => {
    let committed = 0;
    let valid = false;
    const guarded = commitOnce(() => {
      if (!valid) return false;
      committed += 1;
      return true;
    });
    guarded(); guarded();            // both refused
    assert.equal(committed, 0);
    valid = true;
    guarded();                       // the corrected attempt
    assert.equal(committed, 1);
    guarded();                       // and it latches again afterwards
    assert.equal(committed, 1);
  });

  test('only an exact false re-arms — a falsy return still counts as committed', () => {
    let runs = 0;
    const guarded = commitOnce(() => { runs += 1; return null; });
    guarded(); guarded();
    assert.equal(runs, 1);
  });

  test('each binding gets its own latch, so a re-rendered screen is re-armed', () => {
    let runs = 0;
    const handler = () => { runs += 1; };
    const first = commitOnce(handler);
    first(); first();
    const afterRerender = commitOnce(handler);
    afterRerender(); afterRerender();
    assert.equal(runs, 2);
  });

  test('a throwing handler stays latched rather than letting the next tap through', () => {
    let runs = 0;
    const guarded = commitOnce(() => { runs += 1; throw new Error('storage full'); });
    assert.throws(() => guarded(), /storage full/);
    guarded();
    assert.equal(runs, 1);
  });
});
