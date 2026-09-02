/* =====================================================================
   test/session.test.js — "resume last edit" persistence (IndexedDB).

   Two failure modes users hit: resuming a session that was cropped (the blob
   cache is keyed by photo.token, so a stale token restores the pre-crop
   frame), and a resume card that offers a photo the app already gave up on.
   ===================================================================== */
'use strict';

const { test, run, ok, eq, assert } = require('./harness');
const { loadApp } = require('./app');

const DAY = 24 * 60 * 60 * 1000;
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function fakePhoto(win, { w = 1200, h = 800, name = 'IMG_0001.jpg', token = 111 } = {}) {
  const canvas = win.document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, w, h, name, type: 'image/jpeg', token };
}

test('a saved session comes back with photo, name and full edit state', async () => {
  const win = loadApp().win;
  const photo = fakePhoto(win);
  const state = win.FUJI.defaultState();
  state.light.exposure = 0.6;
  state.fuji.grainEffect = 'strong';
  state.color.hsl.hue.r = -0.3;
  ok(await win.FUJI.session.saveSession(photo, state), 'saveSession reported failure');
  const s = await win.FUJI.session.loadSession();
  assert.ok(s, 'loadSession returned null');
  eq(s.name, 'IMG_0001.jpg');
  eq(s.type, 'image/jpeg');
  eq(s.version, 1);
  eq(s.w, 1200); eq(s.h, 800);
  eq(s.state.light.exposure, 0.6, 'the edit must survive the round trip');
  eq(s.state.fuji.grainEffect, 'strong');
  eq(s.state.color.hsl.hue.r, -0.3, 'nested colour data must survive');
  ok(s.photo, 'no photo blob was stored');
  await win.FUJI.session.clearSession();
  eq(await win.FUJI.session.loadSession(), null, 'discard must actually remove the record');
});

test('the state stored is a snapshot, not a live reference', async () => {
  const win = loadApp().win;
  const photo = fakePhoto(win);
  const state = win.FUJI.defaultState();
  await win.FUJI.session.saveSession(photo, state);
  state.light.exposure = 2;                 // the user keeps editing afterwards
  const s = await win.FUJI.session.loadSession();
  eq(s.state.light.exposure, 0, 'a later edit must not retro-change the saved session');
});

test('encoding is cached per photo, and invalidated when the photo changes', async () => {
  const win = loadApp().win;
  const photo = fakePhoto(win);
  const state = win.FUJI.defaultState();
  await win.FUJI.session.saveSession(photo, state);
  eq(photo.canvas.__toBlobCount, 1, 'first save must encode the frame');
  await win.FUJI.session.saveSession(photo, state);
  await win.FUJI.session.saveSession(photo, state);
  eq(photo.canvas.__toBlobCount, 1, 'state-only saves must reuse the cached blob (encoding a 12MP frame is not free)');
  // a crop replaces the canvas; without a new token the old frame would be kept
  const cropped = fakePhoto(win, { w: 600, h: 600, token: 222 });
  await win.FUJI.session.saveSession(cropped, state);
  eq(cropped.canvas.__toBlobCount, 1, 'a new photo token must force a fresh encode');
  const s = await win.FUJI.session.loadSession();
  eq(s.w, 600, 'the stored session must describe the cropped frame');
});

test('nothing is saved without a photo or state', async () => {
  const win = loadApp().win;
  eq(await win.FUJI.session.saveSession(null, win.FUJI.defaultState()), false);
  eq(await win.FUJI.session.saveSession(fakePhoto(win), null), false);
  eq(await win.FUJI.session.saveSession({ w: 1, h: 1 }, win.FUJI.defaultState()), false,
    'a photo record without a canvas must not be accepted');
  eq(await win.FUJI.session.loadSession(), null, 'nothing should have been written');
});

test('a session older than the retention window is dropped on read', async () => {
  const { win, ctx } = loadApp();
  const photo = fakePhoto(win);
  await win.FUJI.session.saveSession(photo, win.FUJI.defaultState());
  ok(await win.FUJI.session.loadSession(), 'sanity: the session exists first');
  const realNow = Date.now();
  // age the clock inside the app's realm only
  require('./dom-stub').vm.runInContext(
    `Date.now = () => ${realNow + 15 * DAY};`, ctx);
  eq(await win.FUJI.session.loadSession(), null, 'a 15-day-old session must not be offered');
  require('./dom-stub').vm.runInContext(`Date.now = () => ${realNow};`, ctx);
  eq(await win.FUJI.session.loadSession(), null, 'the expired record should have been deleted, not just hidden');
});

/* A hand-built IndexedDB, so a stored record can be shaped exactly the way an
   older (or half-written) app version would have left it. */
function fakeIndexedDB(records) {
  const store = { stores: records };
  function req(result) {
    const r = { result, onsuccess: null, onerror: null };
    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
    return r;
  }
  const db = {
    objectStoreNames: { contains: (n) => !!records[n] },
    createObjectStore: (n) => { records[n] = records[n] || {}; return {}; },
    transaction: (name) => {
      const s = (records[name] = records[name] || {});
      const tx = {
        objectStore: () => ({
          put: (val, key) => { s[key] = val; return req(undefined); },
          get: (key) => req(s[key]),
          delete: (key) => { delete s[key]; return req(undefined); }
        }),
        oncomplete: null, onerror: null, onabort: null
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    }
  };
  void store;
  return { open: () => { const r = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null }; setTimeout(() => { if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess({ target: r }); }, 0); return r; } };
}

test('a stored record without a photo or state is ignored instead of fatal', async () => {
  // the object store is named "sessions"; "last" is the only key the app uses
  const records = { sessions: { last: { version: 1, savedAt: Date.now(), name: 'x.jpg', photo: {} } } };
  const win = loadApp({ runBoot: true, before: (w) => { w.indexedDB = fakeIndexedDB(records); } }).win;
  eq(await win.FUJI.session.loadSession(), null, 'a half-written session must never be offered');
  await tick(30);
  eq(win.document.getElementById('resume-card').classList.contains('hidden'), true,
    'the resume card must stay hidden for an unusable session');
});

test('the resume card appears for a saved session and Continue restores the edit', async () => {
  const blob = { size: 4096, type: 'image/jpeg' };
  const state = {
    profileId: 'astro', film: { intensity: 0.6, grain: 0.2, grainSize: 0.5, grainStrength: 0.5, halation: 0, bloom: 0 },
    vignette: 0.3, light: { exposure: 0.6, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    color: { temperature: -0.2, tint: 0, vibrance: 0, saturation: 0, hsl: { hue: {}, sat: {}, luma: {} } },
    grade: { shadowHue: 0.5, shadowSat: 0, highlightHue: 0.5, highlightSat: 0, balance: 0.5 },
    detail: { texture: 0, clarity: 0, sharp: 0, noise: 0, dehaze: 0 }, fuji: { dr: '200' }
  };
  const records = { sessions: { last: { version: 1, savedAt: Date.now() - 60000, name: 'IMG_2200.jpg', type: 'image/jpeg', w: 640, h: 480, photo: blob, state } } };
  const win = loadApp({ runBoot: true, before: (w) => { w.indexedDB = fakeIndexedDB(records); } }).win;
  win.document.getElementById('stage').__setRect(240, 180);   // keep the CPU fallback cheap
  await tick(30);
  const card = win.document.getElementById('resume-card');
  eq(card.classList.contains('hidden'), false, 'the resume card should be shown for a saved session');
  eq(win.document.getElementById('resume-name').textContent, 'IMG_2200.jpg', 'the card names the photo');
  ok(/min ago/.test(win.document.getElementById('resume-when').textContent), 'the card should say how old the edit is');
  win.document.getElementById('btn-resume').__fire('click');
  for (let i = 0; i < 6; i++) { await tick(20); win.__flushRAF(); }
  eq(win.document.getElementById('home').classList.contains('hidden'), true, 'resuming must open the editor');
  eq(win.App.state.cur.light.exposure, 0.6, 'the saved exposure must be restored');
  eq(win.App.state.cur.profileId, 'astro', 'the saved film simulation must be restored');
  eq(win.App.state.cur.fuji.dr, '200', 'the saved Fuji dynamic range must be restored');
  eq(win.App.state.cur.vignette, 0.3);
  eq(win.App.state.canUndo(), false, 'a restored session is a starting point, not an edit step (reset clears history)');
  // and the card is dismissed so it cannot be resumed twice by accident
  eq(card.classList.contains('hidden'), true, 'the card must hide after resuming');
});

run();
