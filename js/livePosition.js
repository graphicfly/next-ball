// High-accuracy position for live yardages (docs/course-mode-spec.md §14.9,
// §14.12.5).
//
// This exists because weather.js's getCurrentPosition() must NOT be reused
// here, and the reason is worth stating plainly: it sets
// enableHighAccuracy:false, accepts a fix up to five minutes old
// (maximumAge:300000), and rounds coordinates to four decimal places. That
// rounding alone is about ±11 m — roughly 12 yards before GPS noise even
// starts — and a five-minute-old fix is meaningless to someone walking a
// hole. Reusing it would produce plausible-looking numbers that are quietly
// wrong, which is worse than showing none.
//
// So: watchPosition, enableHighAccuracy, maximumAge 0, coordinates passed
// through unrounded. The watch belongs to its caller and is torn down on
// every exit path — §14.9 singles out the bottom nav as the exit most likely
// to leak one.

export const GPS_ACCURACY_GOOD_M = 10;   // ≈ ±11 yd — plain yardages
export const GPS_ACCURACY_POOR_M = 45;   // ≈ ±49 yd — above this, no numbers
export const GREEN_CAPTURE_MAX_ACCURACY_M = 15; // §14.13.2, tighter than display

export const POSITION_STATE = {
  LOCATING: 'locating',
  AVAILABLE: 'available',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  TIMEOUT: 'timeout',
};

// How the accuracy figure is allowed to be used (§14.8):
//   good         — show plain yardages
//   approximate  — show yardages marked with "~"
//   unusable     — suppress numbers entirely; a wrong number beats no number
//                  only in the other direction
//   unknown      — accuracy missing; never treated as usable, and never
//                  recorded (§14.13.2)
export function accuracyTier(accuracy_m) {
  if (!Number.isFinite(accuracy_m) || accuracy_m < 0) return 'unknown';
  if (accuracy_m <= GPS_ACCURACY_GOOD_M) return 'good';
  if (accuracy_m <= GPS_ACCURACY_POOR_M) return 'approximate';
  return 'unusable';
}

export function yardagesUsable(fix) {
  const tier = accuracyTier(fix?.accuracy_m);
  return tier === 'good' || tier === 'approximate';
}

// Capture is gated harder than display because a captured green is
// permanent and reused on every future round, while a displayed yardage is
// gone the moment the golfer walks on (§14.13.2). A fix with unknown
// accuracy is never capturable.
export function canCaptureGreen(fix) {
  return Number.isFinite(fix?.accuracy_m) && fix.accuracy_m <= GREEN_CAPTURE_MAX_ACCURACY_M;
}

function mapError(err) {
  if (!err) return POSITION_STATE.UNAVAILABLE;
  if (err.code === 1) return POSITION_STATE.DENIED;        // PERMISSION_DENIED
  if (err.code === 3) return POSITION_STATE.TIMEOUT;       // TIMEOUT
  return POSITION_STATE.UNAVAILABLE;                       // POSITION_UNAVAILABLE
}

// Starts a high-accuracy watch and returns a stop() function.
//
// `onFix`   — called with { lat, lon, accuracy_m, heading, speed, at }.
//             Coordinates are exactly what the device reported: unrounded.
// `onState` — called with a POSITION_STATE whenever it changes.
//
// Display updates are throttled (§14.9: the readout must not flicker faster
// than about once a second), but the FIRST fix is always delivered
// immediately — a golfer opening the map wants the number now, not in a
// second. Throttling drops intermediate fixes rather than queueing them, so
// what is shown is always the most recent reading.
//
// `geolocation` and `visibility` are injectable so this is testable without
// a browser; both default to the real thing.
export function watchPosition({
  onFix,
  onState,
  throttleMs = 1000,
  timeoutMs = 15000,
  geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
  visibility = typeof document !== 'undefined' ? document : null,
} = {}) {
  let watchId = null;
  let stopped = false;
  let lastEmit = 0;
  let pending = null;
  let timer = null;
  let state = null;

  const setState = (next) => {
    if (stopped || state === next) return;
    state = next;
    try { onState?.(next); } catch (e) { /* a listener must not kill the watch */ }
  };

  if (!geolocation || typeof geolocation.watchPosition !== 'function') {
    setState(POSITION_STATE.UNAVAILABLE);
    return () => {};
  }

  const emit = (fix) => {
    lastEmit = Date.now();
    pending = null;
    try { onFix?.(fix); } catch (e) { /* as above */ }
  };

  const handle = (pos) => {
    if (stopped) return;
    const c = pos?.coords;
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
    const fix = {
      // Unrounded, deliberately — see the header. Rounding here would
      // silently undo the entire point of this module.
      lat: c.latitude,
      lon: c.longitude,
      accuracy_m: Number.isFinite(c.accuracy) ? c.accuracy : null,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      at: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
    };
    setState(POSITION_STATE.AVAILABLE);

    const since = Date.now() - lastEmit;
    if (lastEmit === 0 || since >= throttleMs) { emit(fix); return; }
    pending = fix;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (!stopped && pending) emit(pending);
      }, throttleMs - since);
    }
  };

  const fail = (err) => {
    if (stopped) return;
    setState(mapError(err));
  };

  const start = () => {
    if (stopped || watchId !== null) return;
    setState(POSITION_STATE.LOCATING);
    try {
      watchId = geolocation.watchPosition(handle, fail, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: timeoutMs,
      });
    } catch (e) {
      setState(POSITION_STATE.UNAVAILABLE);
    }
  };

  const clearWatch = () => {
    if (watchId === null) return;
    try { geolocation.clearWatch(watchId); } catch (e) { /* already gone */ }
    watchId = null;
  };

  // Backgrounding the app must suspend the watch — §14.9 forbids tracking
  // in the background, and a phone in a pocket for four holes would burn
  // battery for nothing. Resuming on return keeps the map live without the
  // caller having to know anything about visibility.
  const onVisibility = () => {
    if (stopped) return;
    if (visibility.visibilityState === 'hidden') { clearWatch(); setState(POSITION_STATE.LOCATING); }
    else start();
  };
  if (visibility?.addEventListener) visibility.addEventListener('visibilitychange', onVisibility);

  start();

  // Idempotent: every exit path may call it, and several do.
  return function stop() {
    if (stopped) return;
    stopped = true;
    clearWatch();
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pending = null;
    if (visibility?.removeEventListener) visibility.removeEventListener('visibilitychange', onVisibility);
  };
}
