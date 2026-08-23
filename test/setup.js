// Node test-environment shims. Import this FIRST in every test file, before
// importing any app module (js/db.js, js/ui.js, etc).
//
// ISOLATION: this sets up an in-memory-only localStorage that never touches
// disk, a real browser profile, or any real user data. Node has no
// localStorage of its own, so there is nothing for this to collide with —
// it's the strongest possible isolation available for this architecture.

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
  get length() { return this._data.size; }
  key(i) { return [...this._data.keys()][i] ?? null; }
}

if (!globalThis.localStorage) globalThis.localStorage = new MemoryStorage();
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.window.matchMedia) {
  globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
if (!globalThis.navigator) globalThis.navigator = {};

// Clears storage AND forces db.js to drop its module-scope cache, so each
// test (or test file) starts from a genuinely empty, isolated store.
export async function resetDB() {
  globalThis.localStorage.clear();
  const db = await import('../js/db.js');
  db.__resetForTests();
  return db;
}
