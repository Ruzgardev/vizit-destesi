/**
 * Minimal IndexedDB helper for deck persistence (images as data URLs).
 */
const IDB_NAME = "vizitDestesi";
const IDB_VERSION = 1;
const STORE_DECKS = "decks";
const STORE_META = "meta";

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_DECKS)) {
        db.createObjectStore(STORE_DECKS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
  });
}

export async function getAllDecks(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DECKS, "readonly");
    const st = tx.objectStore(STORE_DECKS);
    const req = st.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

export async function putDeck(db, deck) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DECKS, "readwrite");
    tx.objectStore(STORE_DECKS).put(deck);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDeck(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DECKS, "readwrite");
    tx.objectStore(STORE_DECKS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.value ?? null);
  });
}

export async function setMeta(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
