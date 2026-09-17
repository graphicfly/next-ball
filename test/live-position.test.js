import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  watchPosition, accuracyTier, yardagesUsable, canCaptureGreen,
  POSITION_STATE, GPS_ACCURACY_GOOD_M, GPS_ACCURACY_POOR_M, GREEN_CAPTURE_MAX_ACCURACY_M,
} from '../js/livePosition.js';

// High-accuracy position — docs/course-mode-spec.md §14.9, §14.12.5.

// A controllable stand-in for navigator.geolocation, so the watch is
// testable without a browser or a real fix.
function fakeGeolocation() {
  const g = {
    opts: null, cleared: [], nextId: 1, handlers: null, watchCount: 0,
    watchPosition(ok, err, opts) {
      g.opts = opts; g.handlers = { ok, err }; g.watchCount++;
      return g.nextId++;
    },
    clearWatch(id) { g.cleared.push(id); },
    fix({ lat = 38.8782468, lon = -77.3161370, accuracy = 5, timestamp = 1 } = {}) {
      g.handlers.ok({ coords: { latitude: lat, longitude: lon, accuracy, heading: null, speed: null }, timestamp });
    },
    fail(code) { g.handlers.err({ code }); },
  };
  return g;
}

function fakeVisibility() {
  const v = {
    visibilityState: 'visible', listeners: {},
    addEventListener(k, fn) { (v.listeners[k] ||= []).push(fn); },
    removeEventListener(k, fn) { v.listeners[k] = (v.listeners[k] || []).filter((f) => f !== fn); },
    set(state) { v.visibilityState = state; (v.listeners.visibilitychange || []).forEach((f) => f()); },
  };
  return v;
}

describe('Accuracy tiers (§14.8)', () => {
  test('the named thresholds are the ones the spec fixes', async () => {
    assert.equal(GPS_ACCURACY_GOOD_M, 10);
    assert.equal(GPS_ACCURACY_POOR_M, 45);
    assert.equal(GREEN_CAPTURE_MAX_ACCURACY_M, 15);
  });

  test('tiers sort by the thresholds, inclusively', async () => {
    assert.equal(accuracyTier(0), 'good');
    assert.equal(accuracyTier(10), 'good');
    assert.equal(accuracyTier(10.1), 'approximate');
    assert.equal(accuracyTier(45), 'approximate');
    assert.equal(accuracyTier(45.1), 'unusable');
  });

  test('missing or nonsensical accuracy is unknown, never usable', async () => {
    for (const v of [null, undefined, NaN, -1, 'twelve']) {
      assert.equal(accuracyTier(v), 'unknown', String(v));
      assert.equal(yardagesUsable({ accuracy_m: v }), false);
    }
  });

  test('beyond the poor threshold, yardages are suppressed entirely', async () => {
    // §14.8: "a wrong number is worse than no number."
    assert.equal(yardagesUsable({ accuracy_m: 46 }), false);
    assert.equal(yardagesUsable({ accuracy_m: 44 }), true);
  });
});

describe('Green capture gating (§14.13.2)', () => {
  test('capture is gated harder than display, because it is permanent', async () => {
    assert.ok(GREEN_CAPTURE_MAX_ACCURACY_M < GPS_ACCURACY_POOR_M);
    assert.equal(canCaptureGreen({ accuracy_m: 15 }), true);
    assert.equal(canCaptureGreen({ accuracy_m: 15.1 }), false);
    // Displayable but not capturable — the band that makes the two limits
    // different in practice.
    assert.equal(yardagesUsable({ accuracy_m: 30 }), true);
    assert.equal(canCaptureGreen({ accuracy_m: 30 }), false);
  });

  test('a position with unknown accuracy is never recorded', async () => {
    for (const v of [null, undefined, NaN]) assert.equal(canCaptureGreen({ accuracy_m: v }), false);
    assert.equal(canCaptureGreen(null), false);
    assert.equal(canCaptureGreen({}), false);
  });
});

describe('The watch itself (§14.9)', () => {
  test('requests high accuracy with no cached fix — the whole point of §14.12.5', async () => {
    const geo = fakeGeolocation();
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility() });
    assert.equal(geo.opts.enableHighAccuracy, true);
    assert.equal(geo.opts.maximumAge, 0, 'a five-minute-old fix is meaningless while walking');
    stop();
  });

  // The specific defect §14.12.5 warns about: weather.js rounds to four
  // decimals, about 11 m, which is ~12 yd of error before GPS noise.
  test('coordinates are passed through unrounded', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onFix: (f) => seen.push(f) });
    geo.fix({ lat: 38.87824681234, lon: -77.31613701234, accuracy: 4 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].lat, 38.87824681234);
    assert.equal(seen[0].lon, -77.31613701234);
    assert.notEqual(seen[0].lat, Math.round(38.87824681234 * 10000) / 10000);
    stop();
  });

  test('accuracy travels with the fix', async () => {
    const geo = fakeGeolocation();
    let fix = null;
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onFix: (f) => { fix = f; } });
    geo.fix({ accuracy: 7.5 });
    assert.equal(fix.accuracy_m, 7.5);
    assert.equal(accuracyTier(fix.accuracy_m), 'good');
    stop();
  });

  test('the first fix is delivered immediately, not held for the throttle', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), throttleMs: 60000, onFix: (f) => seen.push(f) });
    geo.fix({ lat: 1, lon: 2 });
    assert.equal(seen.length, 1, 'a golfer opening the map wants the number now');
    stop();
  });

  test('later fixes are throttled, and the newest wins', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), throttleMs: 40, onFix: (f) => seen.push(f) });
    geo.fix({ lat: 1 });
    geo.fix({ lat: 2 });
    geo.fix({ lat: 3 });
    assert.equal(seen.length, 1, 'intermediate fixes are dropped, not queued');
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(seen.length, 2);
    assert.equal(seen[1].lat, 3, 'the most recent reading is what surfaces');
    stop();
  });

  test('states move Locating -> Available on the first fix', async () => {
    const geo = fakeGeolocation();
    const states = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onState: (s) => states.push(s) });
    assert.deepEqual(states, [POSITION_STATE.LOCATING]);
    geo.fix({});
    assert.deepEqual(states, [POSITION_STATE.LOCATING, POSITION_STATE.AVAILABLE]);
    stop();
  });

  test('error codes map to the states §14.8 distinguishes', async () => {
    for (const [code, expected] of [[1, POSITION_STATE.DENIED], [2, POSITION_STATE.UNAVAILABLE], [3, POSITION_STATE.TIMEOUT]]) {
      const geo = fakeGeolocation();
      const states = [];
      const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onState: (s) => states.push(s) });
      geo.fail(code);
      assert.equal(states[states.length - 1], expected, `code ${code}`);
      stop();
    }
  });

  test('no geolocation at all is reported, not thrown', async () => {
    const states = [];
    const stop = watchPosition({ geolocation: null, visibility: fakeVisibility(), onState: (s) => states.push(s) });
    assert.deepEqual(states, [POSITION_STATE.UNAVAILABLE]);
    assert.equal(typeof stop, 'function');
    stop();
  });

  test('stop() clears the watch and is safe to call repeatedly', async () => {
    // §14.9 singles out the bottom nav as the exit most likely to leak a
    // watch, so every exit path calls stop() and it must not mind.
    const geo = fakeGeolocation();
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility() });
    stop(); stop(); stop();
    assert.deepEqual(geo.cleared, [1]);
  });

  test('nothing is emitted after stop()', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onFix: (f) => seen.push(f) });
    stop();
    geo.fix({});
    assert.equal(seen.length, 0);
  });

  test('a throttled fix pending at stop() never arrives', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), throttleMs: 30, onFix: (f) => seen.push(f) });
    geo.fix({ lat: 1 });
    geo.fix({ lat: 2 });
    stop();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(seen.length, 1, 'the queued second fix was cancelled with the watch');
  });

  test('backgrounding suspends the watch and returning resumes it', async () => {
    // §14.9: tracking never runs in the background.
    const geo = fakeGeolocation();
    const vis = fakeVisibility();
    const stop = watchPosition({ geolocation: geo, visibility: vis });
    assert.equal(geo.watchCount, 1);
    vis.set('hidden');
    assert.deepEqual(geo.cleared, [1], 'watch released while backgrounded');
    vis.set('visible');
    assert.equal(geo.watchCount, 2, 'and re-established on return');
    stop();
  });

  test('stop() unsubscribes from visibility, so a stopped watch never revives', async () => {
    const geo = fakeGeolocation();
    const vis = fakeVisibility();
    const stop = watchPosition({ geolocation: geo, visibility: vis });
    stop();
    const before = geo.watchCount;
    vis.set('hidden');
    vis.set('visible');
    assert.equal(geo.watchCount, before);
  });

  test('a listener that throws does not kill the watch', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({
      geolocation: geo,
      visibility: fakeVisibility(),
      onFix: (f) => { seen.push(f); throw new Error('render blew up'); },
    });
    assert.doesNotThrow(() => geo.fix({ lat: 1 }));
    assert.equal(seen.length, 1);
    stop();
  });

  test('a malformed fix is ignored rather than emitted as NaN', async () => {
    const geo = fakeGeolocation();
    const seen = [];
    const stop = watchPosition({ geolocation: geo, visibility: fakeVisibility(), onFix: (f) => seen.push(f) });
    geo.handlers.ok({ coords: { latitude: null, longitude: null, accuracy: 5 }, timestamp: 1 });
    geo.handlers.ok({});
    assert.equal(seen.length, 0);
    stop();
  });
});
