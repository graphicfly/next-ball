import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Screen wake lock across both activities.
//
// A round is an active activity exactly as a range session is, and it runs
// far longer — hours outdoors, with minutes of walking between taps. The
// lock was released when a round ended but never acquired when one started,
// so Course Mode spent the whole round letting the phone sleep.
//
// wakeLock.js drives browser APIs that do not exist in Node, so these assert
// the WIRING: that every screen which can host a live activity asks for the
// lock, and that the symmetry between acquire and release holds.

const read = (f) => fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
// Comments explain this wiring at length; strip them so a mention in prose
// cannot satisfy a test about behaviour.
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('Range sessions keep the screen awake', () => {
  test('acquired on start, on resume, and on relaunch', () => {
    assert.match(code('screens/start.js'), /enableWakeLock\(\)/);
    assert.match(code('screens/active.js'), /enableWakeLock\(\)/);
    assert.match(code('app.js'), /bootSession[\s\S]*?enableWakeLock\(\)/);
  });

  test('released when paused or finished', () => {
    assert.match(code('screens/active.js'), /disableWakeLock\(\)/);
    assert.match(code('screens/home.js'), /disableWakeLock\(\)/);
  });
});

describe('Course rounds keep the screen awake', () => {
  test('hole entry acquires the lock', () => {
    // On render rather than only at startRound, so resuming from Home, from
    // History, or after a relaunch is covered by the same line.
    assert.match(code('screens/courseRound.js'), /enableWakeLock\(\)/);
  });

  test('the hole map acquires the lock', () => {
    // The screen a golfer leaves open while walking to the ball, and the
    // one watching GPS — which the OS suspends along with the screen.
    assert.match(code('screens/holeMap.js'), /enableWakeLock\(\)/);
  });

  test('a round in progress reacquires it on relaunch', () => {
    assert.match(code('app.js'), /bootRound[\s\S]*?enableWakeLock\(\)/);
  });

  test('it is still released when the round ends', () => {
    assert.match(code('screens/home.js'), /function endRound[\s\S]*?disableWakeLock\(\)/);
  });

  // The regression this whole change exists to prevent.
  test('release is never wired without a matching acquire', () => {
    const files = ['screens/courseRound.js', 'screens/holeMap.js', 'screens/home.js', 'screens/active.js', 'screens/start.js', 'app.js'];
    const acquires = files.some((f) => code(f).includes('enableWakeLock()'));
    const releases = files.some((f) => code(f).includes('disableWakeLock()'));
    assert.ok(acquires && releases, 'both halves must exist');
    // Course Mode specifically: it released for months without acquiring.
    assert.ok(code('screens/courseRound.js').includes('enableWakeLock()')
      || code('screens/holeMap.js').includes('enableWakeLock()'),
      'Course Mode must acquire the lock somewhere');
  });
});

describe('The wake lock module stays defensive', () => {
  const src = read('wakeLock.js');

  test('an unsupported browser is a no-op, not a crash', () => {
    assert.match(src, /'wakeLock' in navigator/);
  });

  test('a denied or interrupted request is swallowed', () => {
    // It must never be able to block shot logging.
    assert.match(src, /catch/);
  });

  test('it re-acquires when the app returns to the foreground', () => {
    // The OS drops the lock whenever the tab is backgrounded — which on a
    // course happens every time the phone goes in a pocket.
    assert.match(src, /visibilitychange/);
    assert.match(src, /visibilityState === 'visible'/);
  });
});
