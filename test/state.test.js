/* =====================================================================
   test/state.test.js — the canonical adjustment model.

   The single most common breakage in this codebase is UI ↔ state drift:
   a slider writes `path:'x.y'` and nothing checks that `x.y` exists on the
   state the engine bakes. So the model is checked against the UI source.
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, run, ok, eq, near, assert } = require('./harness');
const { ROOT, read } = require('./app');

function loadModules(files) {
  const sandbox = { console, Uint8Array, Uint8ClampedArray, Float32Array, DataView, Math, JSON, Date, document: undefined };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  for (const f of files) vm.runInContext(read(f), sandbox, { filename: f });
  return sandbox;
}
const G = loadModules(['js/processing.js', 'js/profiles.js', 'js/state.js']);
const { FUJI } = G;

const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

test('defaultState() is a fresh object every call (no shared nested references)', () => {
  const a = FUJI.defaultState(), b = FUJI.defaultState();
  a.light.exposure = 3; a.color.hsl.hue.r = 9; a.fuji.dr = '400';
  eq(b.light.exposure, 0, 'nested objects were shared between calls');
  eq(b.color.hsl.hue.r, 0, 'hsl sub-objects were shared between calls');
  eq(b.fuji.dr, 'auto', 'fuji defaults were shared between calls');
});

test('state is JSON round-trippable (session save/restore relies on it)', () => {
  const s = FUJI.defaultState();
  s.light.shadows = 0.4; s.color.hsl.sat.b = -2; s.fuji.grainEffect = 'strong';
  const back = FUJI.deepClone(s);
  eq(JSON.stringify(back), JSON.stringify(s), 'deepClone must preserve every key');
  assert.notStrictEqual(back.color.hsl, s.color.hsl);
});

test('undo/redo: commit pushes, undo restores, redo re-applies', () => {
  const st = new FUJI.State();
  eq(st.canUndo(), false, 'a fresh state must not be undoable');
  st.setPartial('light.exposure', 1.5);
  eq(st.cur.light.exposure, 1.5);
  eq(st.canUndo(), true);
  eq(st.canRedo(), false);
  st.undo();
  eq(st.cur.light.exposure, 0, 'undo must restore the pre-commit value');
  eq(st.canRedo(), true);
  st.redo();
  eq(st.cur.light.exposure, 1.5, 'redo must re-apply');
  st.undo(); st.undo();
  eq(st.cur.light.exposure, 0, 'undo past the bottom of the stack is a no-op');
  eq(st.canUndo(), false);
});

test('a new edit clears the redo stack (no resurrected branches)', () => {
  const st = new FUJI.State();
  st.setPartial('light.exposure', 1);
  st.setPartial('light.contrast', 0.5);
  st.undo();
  eq(st.canRedo(), true);
  st.setPartial('light.highlights', -0.7);
  eq(st.canRedo(), false, 'committing after undo must drop the redo branch');
});

test('liveUpdate does not grow history; commit does', () => {
  const st = new FUJI.State();
  for (let i = 0; i < 20; i++) st.liveUpdate('color.temperature', i / 20);
  eq(st.undoStack.length, 0, 'slider drags must not push 20 undo steps');
  eq(st.cur.color.temperature, 19 / 20);
  st.setPartial('color.temperature', 0.5);
  eq(st.undoStack.length, 1, 'the commit at the end of a drag must be one step');
});

test('history is capped at maxHistory', () => {
  const st = new FUJI.State();
  for (let i = 0; i < FUJI.State.prototype.maxHistory + 40; i++) st.setPartial('vignette', i / 100);
  ok(st.undoStack.length <= 60, `undo stack grew to ${st.undoStack.length}`);
});

test('reset() returns to defaults and clears history', () => {
  const st = new FUJI.State();
  st.setPartial('vignette', 0.9);
  st.reset();
  eq(st.cur.vignette, 0);
  eq(st.undoStack.length, 0);
  eq(st.redoStack.length, 0);
});

test('onChange fires so the render loop sees every mutation', () => {
  const st = new FUJI.State();
  let n = 0;
  st.onChange(() => n++);
  st.liveUpdate('detail.texture', 0.2);
  st.setPartial('detail.texture', 0.4);
  st.undo();
  eq(n, 3, 'expected emit on liveUpdate, commit and undo');
});

test('applyProfile switches film simulation and resets intensity', () => {
  const st = new FUJI.State();
  st.setPartial('film.intensity', 0.2);
  st.applyProfile('astro');
  eq(st.cur.profileId, 'astro');
  eq(st.cur.film.intensity, 1, 'picking a look must restore full intensity');
  ok(st.canUndo(), 'profile change should be undoable');
  st.undo();
  eq(st.cur.profileId, 'fuji-provia', 'undo must restore the previous profile');
});

/* ---- UI ↔ model contract ------------------------------------------------
   ui.js binds controls with `path:'group.key'`, and main.js pushes those
   paths straight into the state model. A typo there is invisible until someone
   drags the slider, so resolve every path here and check it against the model.
--------------------------------------------------------------------------- */
function uiPaths() {
  const src = read('js/ui.js') + '\n' + read('js/main.js');
  const paths = new Set();
  // `path:'light.exposure'` — a trailing dot means it is a prefix glued to a
  // key (`path:'light.'+k`), which is expanded separately below.
  for (const m of src.matchAll(/path:\s*'([a-zA-Z0-9_.]+)'\s*[,})]/g)) if (!m[1].endsWith('.')) paths.add(m[1]);
  for (const m of src.matchAll(/(?:setPartial|liveUpdate)\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.')) paths.add(m[1]);
  // grouped definitions: path:'light.'+k with LIGHT_DEFS / DETAIL_DEFS key lists
  const defs = (name) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n  \\];`).exec(src);
    return m ? [...m[1].matchAll(/\['([a-zA-Z0-9_]+)'/g)].map(x => x[1]) : [];
  };
  if (/path:'light\.'\+k/.test(src)) defs('LIGHT_DEFS').forEach(k => paths.add(`light.${k}`));
  if (/path:'detail\.'\+k/.test(src)) defs('DETAIL_DEFS').forEach(k => paths.add(`detail.${k}`));
  // HSL: three sliders per colour band
  if (/path:'color\.hsl\.hue\.'\+ch/.test(src)) {
    const keys = FUJI.hsl.keys;
    assert.ok(Array.isArray(keys) && keys.length >= 6, 'FUJI.hsl.keys must list the colour bands the UI slides');
    for (const ch of keys) for (const band of ['hue', 'sat', 'luma']) paths.add(`color.hsl.${band}.${ch}`);
    ok(keys.length >= 6, `expected 6+ HSL bands, got ${keys.length}`);
  }
  // Fuji camera settings: fujiSlider/fujiSeg take key:'x' and bind 'fuji.'+key
  for (const m of src.matchAll(/key:\s*'([a-zA-Z0-9]+)'/g)) paths.add(`fuji.${m[1]}`);
  return paths;
}

test('ui.js paths all exist on the state model', () => {
  const model = FUJI.defaultState();
  const paths = uiPaths();
  ok(paths.size >= 40, `only resolved ${paths.size} paths — the extractor stopped matching ui.js`);
  const bad = [...paths].filter(p => get(model, p) === undefined);
  eq(bad.length, 0, `controls write paths that are not on the model: ${bad.join(', ')}\n  (the render pipeline silently ignores these)`);
});

test('every model leaf is reachable from the UI (no dead adjustments)', () => {
  const model = FUJI.defaultState();
  const leaves = [];
  (function walk(o, p) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      const q = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object') walk(v, q);
      else leaves.push(q);
    }
  })(model, '');
  const paths = uiPaths();
  // profileId is chosen through the preset carousel (App.onPresetPick), not a slider
  const intentional = new Set(['profileId']);
  const orphans = leaves.filter(p => !paths.has(p) && !intentional.has(p));
  eq(orphans.length, 0, `state adjustments nothing can set (kept only by defaultState): ${orphans.join(', ')}`);
});

test('paths that exist on the model are numbers, not strings (sliders send numbers)', () => {
  const model = FUJI.defaultState();
  const nonNumeric = [...uiPaths()].filter(p => {
    const v = get(model, p);
    // fuji enum controls (dr, grainEffect, wbMode…) legitimately send strings
    return typeof v === 'string' && !p.startsWith('fuji.');
  });
  eq(nonNumeric.length, 0, `slider paths pointing at string values: ${nonNumeric.join(', ')}`);
});

test('Fuji enum controls only use documented values', () => {
  const src = read('js/ui.js');
  const opts = [...src.matchAll(/options:\s*\[([\s\S]*?)\]/g)].map(m => m[1]).join(',');
  const values = [...opts.matchAll(/v:\s*'([^']+)'/g)].map(m => m[1]);
  const allowed = new Set(['auto', '100', '200', '400', 'off', 'weak', 'strong', 'small', 'large',
    'manual', 'daylight', 'cloudy', 'shade', 'tungsten', 'fluorescent', 'flash', 'custom', ' Kelvin']);
  const bad = values.filter(v => !allowed.has(v));
  eq(bad.length, 0, `unknown enum values in the Fuji controls: ${bad.join(', ')}`);
  ok(values.length > 10, 'expected the Fuji enum option lists to be found');
  ok(src.includes("path:'fuji.'+opt.key"), "ui.js must bind fuji.* paths from control keys");
});

test('profile ids referenced anywhere exist in the catalog', () => {
  const ids = new Set(FUJI.profiles.map(p => p.id));
  eq(ids.size, FUJI.profiles.length, 'duplicate profile ids');
  const refs = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    const src = read(`js/${f}`);
    for (const m of src.matchAll(/profileId:\s*'([\w-]+)'/g)) refs.add(m[1]);
    for (const m of src.matchAll(/onPresetPick\('([\w-]+)'\)/g)) refs.add(m[1]);
  }
  const bad = [...refs].filter(r => !ids.has(r));
  eq(bad.length, 0, `state references unknown film profile ids: ${bad.join(', ')}`);
});

run();
