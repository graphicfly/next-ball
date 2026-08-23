// Isolated screen wake-lock control. Every function here must resolve
// (never throw) so an unsupported browser or a denied/interrupted lock can
// NEVER block or break normal shot logging.

let sentinel = null;
let desired = false;

async function acquire() {
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch (e) {
    // Denied, not allowed while hidden, no user gesture yet, etc. — ignore.
    sentinel = null;
  }
}

// Call when an active (unpaused) session starts or resumes.
export async function enableWakeLock() {
  desired = true;
  await acquire();
}

// Call when the session is paused or finished.
export async function disableWakeLock() {
  desired = false;
  if (sentinel) {
    try { await sentinel.release(); } catch (e) { /* already released */ }
    sentinel = null;
  }
}

// The OS releases wake locks whenever the tab is backgrounded. Re-acquire
// automatically on return to foreground if a session is still active.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && desired && !sentinel) {
    acquire();
  }
});
