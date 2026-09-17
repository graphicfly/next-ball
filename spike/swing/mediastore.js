// IndexedDB media store — SPIKE prototype of the proposed js/media.js.
//
// Blobs only. Metadata belongs in the app index (localStorage) so a record
// outlives its bytes: eviction then degrades a video to "no longer on this
// device" instead of leaving a dangling reference (lesson-spec.md §7.2).
//
// Deliberately tiny and removable. This is the shape the production module
// should have, not the production module.

const DB_NAME = 'nextball_spike_media';
const DB_VERSION = 1;
const STORE = 'blobs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

export async function put(key, blob) {
  const db = await open();
  try {
    await tx(db, 'readwrite', (s) => { s.put(blob, key); });
    return { ok: true };
  } catch (err) {
    // QuotaExceededError is the one failure that must never look like a
    // generic crash: it is actionable, and the golfer can free space.
    return { ok: false, error: err?.name || 'unknown', message: err?.message || String(err) };
  } finally { db.close(); }
}

export async function get(key) {
  const db = await open();
  try {
    return await tx(db, 'readonly', (s) => ({ __req: s.get(key) }));
  } finally { db.close(); }
}

export async function del(key) {
  const db = await open();
  try { await tx(db, 'readwrite', (s) => { s.delete(key); }); return true; }
  finally { db.close(); }
}

export async function keys() {
  const db = await open();
  try { return await tx(db, 'readonly', (s) => ({ __req: s.getAllKeys() })); }
  finally { db.close(); }
}

export async function clearAll() {
  const db = await open();
  try { await tx(db, 'readwrite', (s) => { s.clear(); }); return true; }
  finally { db.close(); }
}

// Quota reporting. `estimate()` is an estimate by specification — treat it
// as guidance for a warning, never as a precondition for a write.
export async function storageReport() {
  const out = { supported: false };
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    out.supported = true;
    out.quotaBytes = e.quota ?? null;
    out.usageBytes = e.usage ?? null;
    out.quotaMB = e.quota ? Math.round(e.quota / 1048576) : null;
    out.usageMB = e.usage ? Math.round(e.usage / 1048576) : null;
    out.percentUsed = e.quota ? +((e.usage / e.quota) * 100).toFixed(2) : null;
    if (e.usageDetails) out.usageDetails = e.usageDetails;
  }
  out.persistApi = !!navigator.storage?.persist;
  if (navigator.storage?.persisted) {
    try { out.persisted = await navigator.storage.persisted(); } catch { out.persisted = 'threw'; }
  }
  return out;
}

// Asked at first SAVE, never at launch. WebKit grants persistence on
// heuristics that favour installed Home Screen web apps, and an origin in
// persistent mode is protected from eviction — so this call is load-bearing
// rather than decorative.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false };
  try {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (already) return { supported: true, granted: true, alreadyGranted: true };
    const granted = await navigator.storage.persist();
    return { supported: true, granted };
  } catch (err) {
    return { supported: true, error: err?.name || String(err) };
  }
}
