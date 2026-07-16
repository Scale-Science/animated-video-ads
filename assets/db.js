// IndexedDB blob store for generated assets (reference images, frames, clips).
// Keys are `${projectId}:${relPath}` e.g. "my-ad-1a2b3c:frames/scene-01-start.png".

const DB_NAME = 'aap-assets';
let _db;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction('blobs', mode);
    const store = t.objectStore('blobs');
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const putBlob = (key, blob) => tx('readwrite', (s) => s.put(blob, key));
export const getBlob = (key) => tx('readonly', (s) => s.get(key));
export const deleteBlob = (key) => tx('readwrite', (s) => s.delete(key));

export async function deleteProjectBlobs(projectId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('blobs', 'readwrite');
    const store = t.objectStore('blobs');
    const range = IDBKeyRange.bound(`${projectId}:`, `${projectId}:￿`);
    store.delete(range);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// Object-URL cache so <img>/<video> tags can point at IDB blobs.
const urlCache = new Map();
export async function objectUrl(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await getBlob(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}
export function invalidateUrl(key) {
  const url = urlCache.get(key);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(key);
}
