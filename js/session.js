/* =====================================================================
   F-UJI session.js — resume last edit (on-device only).
   Stores the current photo (capped, compressed) + full edit state in
   IndexedDB so reopening the app can continue where the user left off.
   Photos never leave the device.
   ===================================================================== */
(function (global) {
  "use strict";

  const DB_NAME = 'fuji-db';
  const STORE = 'sessions';
  const KEY = 'last';
  const MAX_DIM = 2048;      // longest edge stored (keeps quota tiny)
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // discard sessions older than 14 days

  let dbp = null;
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function put(key, val){
    try{
      const db = await open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    }catch(e){ return false; }
  }

  async function get(key){
    try{
      const db = await open();
      return new Promise((resolve) => {
        const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      });
    }catch(e){ return null; }
  }

  async function del(key){
    try{
      const db = await open();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    }catch(e){ return false; }
  }

  /* Downscale + compress the current photo to a JPEG blob (capped at MAX_DIM). */
  function photoBlob(canvas){
    return new Promise((resolve) => {
      try{
        const max = Math.max(canvas.width, canvas.height);
        if(max <= MAX_DIM){
          canvas.toBlob(resolve, 'image/jpeg', 0.88);
          return;
        }
        const s = MAX_DIM / max;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(canvas.width * s));
        c.height = Math.max(1, Math.round(canvas.height * s));
        c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
        c.toBlob(resolve, 'image/jpeg', 0.88);
      }catch(e){ resolve(null); }
    });
  }

  /* Cache the blob per photo so state-only saves don't re-encode. */
  let blobCache = null;   // { token, promise }

  async function saveSession(photo, state){
    if(!photo || !state || !photo.canvas) return false;
    const token = photo.token || 0;
    if(!blobCache || blobCache.token !== token){
      blobCache = { token, promise: photoBlob(photo.canvas) };
    }
    const blob = await blobCache.promise;
    if(!blob) return false;
    const ok = await put(KEY, {
      version: 1,
      savedAt: Date.now(),
      name: photo.name || 'photo.jpg',
      type: photo.type || 'image/jpeg',
      w: photo.w, h: photo.h,
      photo: blob,
      state: JSON.parse(JSON.stringify(state))
    });
    return ok;
  }

  async function loadSession(){
    const s = await get(KEY);
    if(!s || !s.photo || !s.state) return null;
    if(Date.now() - (s.savedAt || 0) > MAX_AGE_MS){
      del(KEY);
      return null;
    }
    return s;
  }

  function clearSession(){ return del(KEY); }

  global.FUJI = global.FUJI || {};
  global.FUJI.session = {
    saveSession, loadSession, clearSession
  };
})(typeof window !== "undefined" ? window : globalThis);
