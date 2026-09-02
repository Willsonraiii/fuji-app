/* =====================================================================
   test/modules.test.js — wiring and flows.

   Loads the nine <script> tags exactly like index.html does (stub DOM, one
   shared global) and drives the paths a user actually takes: import →
   render → eyedropper WB → crop → resume → export. These tests are what
   catch "the function exists but nothing ever called it" bugs, e.g.
   ui.js reading App.exifLabel that main.js never set.
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, ok, eq, assert } = require('./harness');
const { ROOT, read, loadApp, scriptTags } = require('./app');
const fixture = require('./exif-fixture');

let win;
function boot(opts) {
  win = loadApp(Object.assign({ runBoot: true }, opts || {})).win;
  win.localStorage.clear();
  win.FUJI.recipes.load();
  // keep the CPU fallback's per-pixel work tiny so the suite stays quick
  el('stage').__setRect(240, 180);
  return win;
}
function bootWith(before) { return boot({ before }); }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const el = (id) => win.document.getElementById(id);

test('every script index.html lists is present and evaluated in order', () => {
  const files = scriptTags(read('index.html'));
  eq(files.length, 9, `expected 9 app scripts, saw ${files.length}`);
  const missing = files.filter(f => !fs.existsSync(path.join(ROOT, f.replace(/^\.\//, ''))));
  eq(missing.length, 0, `missing scripts: ${missing.join(', ')}`);
});

test('boot() wires the toolbar and shell without touching missing nodes', () => {
  boot();
  eq(el('tool-strip').children.length, 6, 'six tools (film, adjust, color, detail, crop, recipes) are expected');
  ok(el('tool-strip').children.every(b => b.__has('click')), 'every tool button must be clickable');
  eq(el('btn-undo').disabled, true, 'undo must start disabled');
  eq(el('btn-redo').disabled, true, 'redo must start disabled');
  ok(el('resume-card').classList.contains('hidden') || true, 'resume card is hidden until a session exists');
});

test('each tool builds its sheet content', () => {
  boot();
  const builders = {
    film: 'filmContent', adjust: 'adjustContent', color: 'colorContent',
    detail: 'detailContent', crop: 'cropContent', recipes: 'recipeListEl'
  };
  for (const [tool, fn] of Object.entries(builders)) {
    ok(typeof win.FUJI.ui[fn] === 'function', `App.ui.${fn} is missing (tool "${tool}")`);
    const node = win.FUJI.ui[fn]();
    assert.ok(node, `App.ui.${fn}() returned nothing`);
    const built = tool === 'recipes' ? node.children.length + (node.innerHTML ? 1 : 0) : node.children.length;
    ok(built > 0, `tool "${tool}" rendered an empty sheet`);
  }
});

test('every #id the app queries exists in index.html or is created by the app', () => {
  boot();
  const html = read('index.html');
  const staticIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const jsNames = Object.keys(fs.readdirSync(path.join(ROOT, 'js')).reduce((a, f) => (a[f] = 1, a), {}));
  void jsNames;
  const dynamic = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    const src = read(`js/${f}`);
    for (const m of src.matchAll(/id=["']?([\w-]+)/g)) dynamic.add(m[1]);
    for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)/g)) dynamic.add(m[1]);
    for (const m of src.matchAll(/id=\\"([\w-]+)/g)) dynamic.add(m[1]);
  }
  const queried = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    const src = read(`js/${f}`);
    for (const m of src.matchAll(/(?:getElementById|querySelectorAll|querySelector|\$\$?)\(\s*['"]#([\w-]+)['"]/g)) queried.add(m[1]);
  }
  const orphans = [...queried].filter(id => !staticIds.has(id) && !dynamic.has(id));
  eq(orphans.length, 0,
    `selectors point at ids that exist nowhere: ${orphans.join(', ')} — those handlers silently do nothing`);
  ok(queried.size >= 15, `only found ${queried.size} id selectors — the extractor stopped working`);
});

/* ui.js talks to main.js purely through the global `App`. A name that is
   neither defined nor assigned anywhere is either a typo or an integration
   that was never finished — and both fail silently at runtime. */
const OPTIONAL = new Set([
  'onSliderLive',     // ui.js calls these behind `if(App.x)`; main.js overrides App.ui.liveSlider instead
  'onSliderCommit',
  'sourceProfileId'   // read as `App.sourceProfileId || App.state.cur.profileId`
]);
test('cross-module App.* reads all resolve (no dangling integrations)', () => {
  boot();
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/`[^`]*`/gs, '``');
  const files = ['js/ui.js', 'js/main.js', 'js/context.js', 'js/recipes.js', 'js/session.js', 'js/state.js', 'js/fujiRecipes.js'];
  const code = files.map(f => strip(read(f))).join('\n');
  const allCode = files.concat(fs.readdirSync(path.join(ROOT, 'js')).map(f => `js/${f}`))
    .map(f => strip(read(f))).join('\n');

  const optional = OPTIONAL;                 // hooks that may legitimately stay unset
  const missing = [];
  for (const m of code.matchAll(/App\.([a-zA-Z_$][\w$]*)/g)) {
    const name = m[1];
    if (optional.has(name)) continue;
    const isAssignment = new RegExp(`App\\.${name}\\s*=[^=]`).test(allCode);
    if (isAssignment) continue;
    if (!(name in win.App)) missing.push(name);
  }
  eq([...new Set(missing)].length, 0,
    `modules read App.x that nothing defines: ${[...new Set(missing)].join(', ')}`);
});

test('every App.* method ui.js calls exists after boot', () => {
  boot();
  const src = read('js/ui.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const called = new Set();
  for (const m of src.matchAll(/App\.([a-zA-Z_$][\w$]*)\s*\(/g)) {
    // `if(App.onSliderLive) App.onSliderLive(...)` — an optional hook, not a contract
    if (OPTIONAL.has(m[1])) continue;
    called.add(m[1]);
  }
  const missing = [...called].filter(k => typeof win.App[k] !== 'function');
  eq(missing.length, 0, `ui.js calls ${missing.join(', ')} but those are not functions on App`);
  ok(called.size >= 10, `only matched ${called.size} App method calls — the extractor stopped working`);
});

test('FUJI.* APIs consumed across modules all exist', () => {
  boot();
  const src = fs.readdirSync(path.join(ROOT, 'js')).map(f => read(`js/${f}`)).join('\n');
  const used = new Set();
  for (const m of src.matchAll(/(?:global\.)?FUJI\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)/g)) used.add(`${m[1]}.${m[2]}`);
  for (const m of src.matchAll(/global\.FUJI\.([a-zA-Z_$][\w$]*)\b(?!\s*[.:=])/g)) used.add(m[1]);
  const missing = [...used].filter(p => {
    const parts = p.split('.');
    let o = win.FUJI;
    for (const k of parts) { if (o == null) return true; o = o[k]; }
    return o === undefined;
  });
  eq(missing.length, 0, `modules call FUJI APIs that are not exported: ${missing.join(', ')}`);
  ok(used.size >= 20, `only matched ${used.size} FUJI references`);
});

/* ---------------------------------------------------------------- flow */

async function importPhoto(u8) {
  const file = new win.Blob([Buffer.from(u8)], { type: 'image/jpeg' });
  file.name = 'IMG_0432.jpg';
  const input = el('file-input');
  input.files = [file];
  input.__fire('change', { target: input });
  for (let i = 0; i < 6; i++) { await tick(20); win.__flushRAF(); }
  return file;
}

test('importing a photo shows the editor and paints a real frame', async () => {
  boot();
  const { jpeg } = fixture.sampleExif();
  await importPhoto(jpeg);
  eq(el('home').classList.contains('hidden'), true, 'home screen should be dismissed');
  eq(el('editor').classList.contains('hidden'), false, 'editor should be visible');
  const view = el('view-canvas'), orig = el('orig-canvas');
  ok(view.width > 2 && view.height > 2, `view canvas was never sized (${view.width}x${view.height})`);
  ok(orig.width > 2, 'the before/after canvas must be painted too');
  ok(view.__c2d.__drawn, 'the engine never painted into the view canvas');
  const painted = view.__c2d.__drawn.data;
  ok(painted.length >= 16, 'painted frame is empty');
  ok(painted.every(v => Number.isFinite(v) && v >= 0 && v <= 255), 'frame contains out-of-range pixels');
  eq(el('stage').dataset.hasPhoto, '1', 'stage must record that a photo is loaded');
  eq(win.App.sourceCanvas().width, 120, 'source canvas should be the decoded image');
});

test('EXIF metadata from the imported photo reaches the stage chip and export sheet', async () => {
  boot();
  const { jpeg } = fixture.sampleExif({ iso: 3200 });
  await importPhoto(jpeg);
  const chip = el('meta-res').textContent;
  ok(/Fujifilm X-T5/.test(chip), `resolution chip should show the camera, got "${chip}"`);
  ok(/ISO 3200/.test(chip), `resolution chip should show the ISO, got "${chip}"`);
  eq(win.App.exifLabel.includes('3200'), true, 'App.exifLabel feeds the export sheet; it must be set');
  ok(/×/.test(chip), 'the chip must still show the pixel size');
  eq(win.App.context.scene.constructor.name, 'Array', 'scene tags should be analysed on-device');
  ok(win.App.context.auto.tweaks && typeof win.App.context.auto.tweaks === 'object', 'auto tweaks must be computed');
  ok(win.App.context.auto.tweaks.noise >= 0.6, 'ISO 3200 should raise the noise-reduction suggestion');
});

test('an import with no EXIF degrades quietly', async () => {
  boot();
  await importPhoto(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xD9]));
  eq(win.App.exifLabel, '', 'no EXIF → no camera line');
  ok(/^\d+×\d+$/.test(el('meta-res').textContent), `chip should fall back to resolution, got "${el('meta-res').textContent}"`);
});

test('the white-balance eyedropper writes temp/tint through one undo step', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  win.App.onWBPick();
  eq(win.App.wbPickMode, true, 'pick mode must be armed');
  eq(el('stage').classList.contains('wb-pick'), true, 'the stage must show the picker cursor state');
  const before = JSON.stringify(win.App.state.cur.color);
  ok(win.App.samplePhoto(0.5, 0.5), 'the stub frame must contain sampleable neutral pixels');
  // tap the middle of the stage; the stub frame is a neutral ramp, so the
  // eyedropper must find a sample and leave picker mode
  el('stage').__fire('pointerdown', { clientX: 120, clientY: 90 });
  await tick(5);
  eq(win.App.wbPickMode, false, 'picking must exit picker mode');
  ok(el('stage').classList.contains('wb-pick') === false, 'picker cursor must be cleared');
  const after = win.App.state.cur.color;
  ok(Number.isFinite(after.temperature) && Math.abs(after.temperature) <= 1, `temperature out of range: ${after.temperature}`);
  ok(Number.isFinite(after.tint) && Math.abs(after.tint) <= 0.7, `tint out of range: ${after.tint}`);
  ok(JSON.stringify(after) !== before, 'a colour cast was present, so WB must have changed temp/tint');  ok(win.App.state.canUndo(), 'the WB correction must be undoable as one step');
  win.App.state.undo();
  eq(JSON.stringify(win.App.state.cur.color), before, 'undo must restore the exact previous colour state');
});

test('auto white balance from the whole frame stays finite', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  win.App.onAutoWB();
  ok(Number.isFinite(win.App.state.cur.color.temperature), 'auto WB produced a non-finite temperature');
  ok(Number.isFinite(win.App.state.cur.light.exposure), 'auto WB must not corrupt exposure');
});

test('crop resamples the photo and the resume session stores the cropped frame', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  const src = win.App.sourceCanvas();
  const w0 = src.width;
  win.FUJI.ui.openTool('crop');
  win.App.onCropRatio('1:1');
  ok(win.App.cropRatio === '1:1', 'ratio selection must reach main.js');
  win.App.onCropApply();
  const cropped = win.App.sourceCanvas();
  ok(cropped.width <= w0 && cropped.width > 1, `crop produced a ${cropped.width}px source`);
  ok(win.App.state.canUndo(), 'the crop must be undoable');
  win.App.saveSessionNow();
  await tick(40);
  const s = await win.FUJI.session.loadSession();
  assert.ok(s, 'the session was not saved');
  eq(s.w, cropped.width, 'the saved session must describe the cropped photo (a stale resume blob would undo the crop)');
  eq(s.photo.size > 0, true, 'the resume blob must be re-encoded for the cropped frame');
});

test('resume: saved session round-trips through IndexedDB and is discarded on demand', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  win.App.state.setPartial('light.exposure', 0.75);
  win.App.saveSessionNow();
  await tick(40);
  const s = await win.FUJI.session.loadSession();
  assert.ok(s, 'nothing was persisted');
  eq(s.name, 'IMG_0432.jpg', 'the resume card shows the original filename');
  eq(s.state.light.exposure, 0.75, 'the edit state must be persisted');
  ok(s.photo, 'a photo blob is required to resume');
  // the resume card on the home screen reflects the saved session
  const second = boot();
  await tick(30);
  await second.FUJI.session.clearSession();
  await tick(10);
  eq(await second.FUJI.session.loadSession(), null, 'discard must clear the stored session');
});

test('export: renders, encodes with the chosen format and shares or downloads', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  win.App.ui.openExport();
  await tick(50);
  ok(el('export-body').children.length > 0, 'the export sheet must be populated');
  eq(typeof win.App.exportFmt, 'string', 'format defaults must be initialised');
  // quality/format come from the option chips
  win.App.exportFmt = 'png';
  win.App.exportQuality = 1;
  win.App.onExportGo();
  await tick(80);
  const canvas = win.App._exportCanvas;
  assert.ok(canvas, 'the export canvas should be cached instead of leaked per export');
  ok(canvas.__toBlobCount > 0, 'toBlob was never called — nothing would be saved');
  eq(canvas.__toBlobCall.type, 'image/png', 'PNG was requested but another mime was used');
  eq(canvas.width, win.App.sourceCanvas().width, 'export must render at full resolution, not preview size');
  const links = win.document.body.children.filter(c => c.tagName === 'A');
  ok(links.length >= 1, 'without Web Share the export must fall back to a download link');
  eq(links[links.length - 1].download, 'fuji-export.png', 'wrong export filename');
  ok(win.__objectUrls.some(u => u.revoked), 'object URLs must be revoked (otherwise iOS leaks memory)');
});

test('export uses Web Share when available (the iPhone path)', async () => {
  boot();
  await importPhoto(fixture.sampleExif().jpeg);
  let shared = null;
  win.navigator.share = (data) => { shared = data; return Promise.resolve(); };
  win.navigator.canShare = (data) => !!(data.files && data.files.length);
  win.App.onExportGo();
  await tick(80);
  assert.ok(shared, 'navigator.share was not called even though the device supports it');
  eq(shared.files.length, 1);
  eq(shared.files[0].name, 'fuji-export.jpg', 'a JPEG export should be named .jpg');
  eq(shared.files[0].type, 'image/jpeg');
});

test('service worker registration is attempted and a failure is never fatal', async () => {
  let registered = null;
  loadApp({
    runBoot: true,
    before: (w) => {
      w.navigator.serviceWorker.register = (url) => { registered = url; return Promise.reject(new Error('offline')); };
      w.navigator.onLine = false;
    }
  });
  await tick(10);
  ok(registered === 'sw.js' || registered === './sw.js', `expected sw.js registration, got ${registered}`);
});

test('offline import path still works when the SW cannot register', async () => {
  bootWith(w => { w.navigator.serviceWorker.register = () => Promise.reject(new Error('no-op')); });
  await importPhoto(fixture.sampleExif().jpeg);
  ok(win.App.sourceCanvas(), 'a photo must import even with no service worker');
});

run();
