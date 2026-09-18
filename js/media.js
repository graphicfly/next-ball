// The media tier — the sole gateway to large binary media, exactly as
// db.js is the sole gateway to localStorage.
//
// Why this exists separately (lesson-spec.md §7.1, backend-readiness.md §7):
// db.js holds strings inside a ~5-10 MB localStorage budget. A swing video
// is tens of megabytes. That is a different storage tier, not a tuning
// problem, and mixing them would put the whole app's data behind a quota it
// was never designed for.
//
// IndexedDB rather than OPFS. It stores Blobs natively with no Worker
// gymnastics, and it has done so everywhere for a decade; OPFS's
// main-thread write path only became broadly available in late 2025. OPFS
// buys streaming writes and random access, which matter when editing a file
// in place — which a recorded swing never is. Measured in the V4.3 spike: a
// 58 MB video saved in 21 ms and read back byte-for-byte in 3 ms.
//
// METADATA DOES NOT LIVE HERE. It lives in db.js's index, so that a record
// outlives its bytes: when the browser evicts media under storage pressure,
// the SwingVideo degrades to "no longer on this device" instead of becoming
// a dangling reference (lesson-spec.md §7.2).

const DB_NAME = 'nextball_media';
const DB_VERSION = 1;
const STORE = 'blobs';

// Swappable so tests can run without IndexedDB, which Node does not have.
// Same spirit as db.js's __resetForTests: a seam for tests, never a second
// implementation the app might accidentally use.
let _backend = null;

export function __setMediaBackendForTests(backend) {
  _backend = backend;
}

function idbAvailable() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    openDB().then((db) => {
      let result;
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      try { result = fn(store); } catch (err) { db.close(); reject(err); return; }
      tx.oncomplete = () => { db.close(); resolve(result && result.__req ? result.__req.result : result); };
      // A quota failure surfaces on the transaction, not the request, which
      // is why both are wired: without the abort handler a full disk looks
      // like a promise that never settles.
      tx.onerror = () => { db.close(); reject(tx.error || new Error('transaction failed')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('transaction aborted')); };
    }).catch(reject);
  });
}

// ----- the store -----

// Never throws. A failed write is an ordinary outcome here — the disk is
// full, the browser refused, the tab is in a state IndexedDB dislikes — and
// every caller has to handle it anyway, so it is returned rather than
// raised. `quota` is separated from other failures because only it is
// actionable by the golfer.
export async function putMedia(key, blob) {
  if (_backend) return _backend.put(key, blob);
  if (!idbAvailable()) return { ok: false, reason: 'unsupported' };
  try {
    await withStore('readwrite', (s) => { s.put(blob, key); });
    return { ok: true };
  } catch (err) {
    const name = err?.name || '';
    return {
      ok: false,
      reason: name === 'QuotaExceededError' ? 'quota' : 'write_failed',
      error: name || String(err),
    };
  }
}

export async function getMedia(key) {
  if (_backend) return _backend.get(key);
  if (!idbAvailable()) return null;
  try {
    const blob = await withStore('readonly', (s) => ({ __req: s.get(key) }));
    return blob ?? null;
  } catch {
    // A read failure and a missing key are the same thing to every caller:
    // the bytes are not available on this device.
    return null;
  }
}

export async function deleteMedia(key) {
  if (_backend) return _backend.del(key);
  if (!idbAvailable()) return false;
  try { await withStore('readwrite', (s) => { s.delete(key); }); return true; }
  catch { return false; }
}

export async function listMediaKeys() {
  if (_backend) return _backend.keys();
  if (!idbAvailable()) return [];
  try { return (await withStore('readonly', (s) => ({ __req: s.getAllKeys() }))) || []; }
  catch { return []; }
}

export async function clearAllMedia() {
  if (_backend) return _backend.clear();
  if (!idbAvailable()) return false;
  try { await withStore('readwrite', (s) => { s.clear(); }); return true; }
  catch { return false; }
}

// Deletes bytes no record points at any more.
//
// This is the counterpart to deleting records before blobs: that order
// means a crash mid-delete leaves orphaned BYTES rather than a record
// pointing at nothing. Orphaned bytes are invisible and recoverable; a
// dangling reference is neither. Run at startup.
export async function sweepOrphans(validKeys) {
  const valid = new Set(validKeys || []);
  const keys = await listMediaKeys();
  let removed = 0;
  for (const k of keys) {
    if (!valid.has(k)) { if (await deleteMedia(k)) removed += 1; }
  }
  return removed;
}

// ----- quota and persistence -----

// `estimate()` is an estimate by specification. It is good enough to warn
// with and to show, and must never be treated as a precondition for a
// write — the write itself is the only real test.
export async function storageReport() {
  const out = { supported: false, quotaBytes: null, usageBytes: null, percentUsed: null, persisted: null };
  try {
    if (navigator?.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.supported = true;
      out.quotaBytes = e.quota ?? null;
      out.usageBytes = e.usage ?? null;
      if (e.quota) out.percentUsed = +((e.usage / e.quota) * 100).toFixed(2);
    }
    if (navigator?.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* reporting must never break a save */ }
  return out;
}

// Asked at the first video save, never at launch. WebKit grants persistence
// on heuristics that favour installed Home Screen web apps, and an origin in
// persistent mode is protected from eviction — so this call does real work.
// A storage prompt before the golfer has stored anything is the kind of
// thing that gets an app deleted.
export async function requestPersistence() {
  try {
    if (!navigator?.storage?.persist) return { supported: false, granted: false };
    if (navigator.storage.persisted && await navigator.storage.persisted()) {
      return { supported: true, granted: true, alreadyGranted: true };
    }
    return { supported: true, granted: await navigator.storage.persist() };
  } catch (err) {
    return { supported: true, granted: false, error: err?.name || String(err) };
  }
}

// Whether a blob of this size plausibly fits. Advisory only (see
// storageReport): it exists to refuse before recording rather than fail
// halfway through a save, which is the difference between a clear message
// and a corrupt-looking failure.
export async function hasRoomFor(bytes) {
  const r = await storageReport();
  if (!r.supported || r.quotaBytes == null || r.usageBytes == null) return { known: false, fits: true };
  const free = r.quotaBytes - r.usageBytes;
  return { known: true, fits: free > bytes * 1.2, freeBytes: free, neededBytes: bytes };
}
