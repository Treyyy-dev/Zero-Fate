/**
 * Persistent saves in IndexedDB (database "fantasy-rpg", store "saves").
 * (The database name predates the "Fatal Zero" title; it is kept so existing saves still load.)
 * Each slot holds one JSON snapshot assembled by Game.collectSaveData().
 * Falls back gracefully (returns null / false) where IndexedDB is unavailable,
 * e.g. some private browsing modes.
 */
const DB_NAME = 'fantasy-rpg';
const STORE = 'saves';
const VERSION = 1;
export const SAVE_FORMAT = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const SaveSystem = {
  async save(slot, data) {
    try {
      await tx('readwrite', (s) => s.put({ ...data, format: SAVE_FORMAT, savedAt: Date.now() }, slot));
      return true;
    } catch (err) {
      console.warn('[save] failed', err);
      return false;
    }
  },

  async load(slot) {
    try {
      const data = await tx('readonly', (s) => s.get(slot));
      if (!data || data.format !== SAVE_FORMAT) return null;
      return data;
    } catch (err) {
      console.warn('[save] load failed', err);
      return null;
    }
  },

  async remove(slot) {
    try {
      await tx('readwrite', (s) => s.delete(slot));
      return true;
    } catch {
      return false;
    }
  },

  async available() {
    try {
      await openDB();
      return true;
    } catch {
      return false;
    }
  },
};
