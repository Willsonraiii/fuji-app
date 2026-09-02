/* =====================================================================
   test/assets.test.js — the app is plain files served as-is, so the
   "build" is integrity: every referenced file exists, and the service
   worker precaches exactly the files index.html needs.
   (This is what shipped broken: js/context.js and js/fujiRecipes.js were
   added to index.html but never to sw.js, so a cold offline launch had no
   cached copies of them.)
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, run, ok, eq } = require('./harness');
const { ROOT, read, exists, scriptTags } = require('./app');

const html = read('index.html');

function localRefs(matches) {
  return [...matches].map(m => m[1])
    .filter(h => h && !/^(https?:|data:|#|mailto:)/.test(h))
    .map(h => h.replace(/^\.\//, '').split(/[?#]/)[0]);
}

test('every src/href in index.html resolves to a file on disk', () => {
  const refs = localRefs(html.matchAll(/(?:src|href)="([^"]+)"/g));
  const missing = [...new Set(refs)].filter(r => !exists(r));
  eq(missing.length, 0, `missing files referenced by index.html: ${missing.join(', ')}`);
});

test('every js file in js/ is loaded by index.html (no orphan module)', () => {
  const loaded = new Set(scriptTags(html).map(s => s.replace(/^\.\//, '')));
  const onDisk = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
  const orphans = onDisk.filter(f => !loaded.has(`js/${f}`));
  eq(orphans.length, 0, `files not loaded by index.html: ${orphans.join(', ')}`);
});

test('scripts load in dependency order (globals used by a file exist earlier)', () => {
  const order = scriptTags(html).map(s => s.replace(/^\.\//, ''));
  const at = (f) => order.indexOf(f);
  ok(at('js/processing.js') < at('js/profiles.js'), 'processing.js must precede profiles.js (uses FUJI.math)');
  ok(at('js/processing.js') < at('js/state.js'), 'processing.js must precede state.js');
  ok(at('js/state.js') < at('js/main.js'), 'state.js must precede main.js');
  ok(at('js/fujiRecipes.js') < at('js/recipes.js') || at('js/recipes.js') < at('js/fujiRecipes.js'),
    'recipes.js and fujiRecipes.js both load before ui.js/main.js consume them');
  ok(at('js/ui.js') < at('js/main.js'), 'ui.js must precede main.js');
  ok(at('js/context.js') < at('js/main.js'), 'context.js must precede main.js');
});

test('manifest.json is valid and its icons match real PNG sizes', () => {
  const m = JSON.parse(read('manifest.json'));
  ok(m.name && m.short_name && m.start_url && m.display, 'manifest must declare name/short_name/start_url/display');
  ok(m.icons && m.icons.length >= 2, 'manifest needs icons');
  const pngSize = (file) => {
    const b = fs.readFileSync(path.join(ROOT, file));
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(0, 8).toString('hex') };
  };
  for (const icon of m.icons) {
    ok(exists(icon.src), `manifest icon missing: ${icon.src}`);
    const { w, h, sig } = pngSize(icon.src);
    eq(sig, '89504e470d0a1a0a', `${icon.src} is not a PNG`);
    const [dw, dh] = icon.sizes.split('x').map(Number);
    eq(`${w}x${h}`, `${dw}x${dh}`, `${icon.src} declares ${icon.sizes} but is ${w}x${h}`);
  }
  eq(m.start_url.replace(/^\.\//, ''), 'index.html', 'manifest start_url must point at the shell');
});

test('index.html declares the PWA meta a standalone app needs', () => {
  ok(/rel="manifest"/.test(html), 'missing <link rel="manifest">');
  ok(/apple-mobile-web-app-capable/.test(html), 'missing apple-mobile-web-app-capable');
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(html), 'viewport must use viewport-fit=cover for notched iPhones');
  ok(/theme-color/.test(html), 'missing theme-color');
});

test('service worker precaches every file the shell loads', () => {
  const sw = read('sw.js');
  const ctx = vm.createContext({ self: { addEventListener() {} }, location: { origin: 'https://x.test' }, caches: {}, fetch: () => Promise.resolve() });
  vm.runInContext(sw + '\n;globalThis.__A = ASSETS; globalThis.__C = CACHE;', ctx);
  const assets = ctx.__A;
  ok(Array.isArray(assets) && assets.length, 'ASSETS must be a non-empty list');
  const set = new Set(assets.map(a => String(a).replace(/^\.\//, '')));
  const needed = [
    ...scriptTags(html).map(s => s.replace(/^\.\//, '')),
    ...localRefs(html.matchAll(/<link[^>]*href="([^"]+)"/g)).filter(r => !r.startsWith('#')),
    ...fs.readdirSync(path.join(ROOT, 'css')).map(f => `css/${f}`)
  ];
  const missing = [...new Set(needed)].filter(r => !set.has(r));
  eq(missing.length, 0,
    `sw.js ASSETS is missing ${missing.join(', ')} — a cold offline launch would boot without them`);
  const notOnDisk = assets.filter(a => a !== './' && !exists(String(a).replace(/^\.\//, '')));
  eq(notOnDisk.length, 0, `sw.js precaches files that do not exist: ${notOnDisk.join(', ')}`);
  eq(new Set(assets).size, assets.length, 'sw.js ASSETS has duplicates');
});

test('css url() references resolve', () => {
  const css = read('css/app.css');
  const refs = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(m => m[2]);
  const missing = refs.filter(r => !/^(https?:|data:)/.test(r)).filter(r => !exists(path.posix.normalize(path.join('css', r))));
  eq(missing.length, 0, `css references missing files: ${missing.join(', ')}`);
});

test('no console.log/debugger left in shipped app code', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js')).map(f => `js/${f}`);
  const hits = [];
  for (const f of files) {
    const src = read(f);
    if (/\bdebugger\b/.test(src)) hits.push(`${f}: debugger`);
    const logs = (src.match(/console\.(log|debug|warn)\(/g) || []).length;
    if (logs) hits.push(`${f}: ${logs} console call(s)`);
  }
  eq(hits.length, 0, `leftover debug output:\n  ${hits.join('\n  ')}`);
});

test('deploy config (vercel.json) serves the repo root and keeps sw.js fresh', () => {
  const cfg = JSON.parse(read('vercel.json'));
  eq(cfg.framework, null, 'this is not a framework build');
  eq(cfg.outputDirectory, '.', 'Vercel must serve the repo root');
  eq(cfg.buildCommand, null, 'there is nothing to build');
  const sw = (cfg.headers || []).find(h => h.source === '/sw.js');
  ok(sw, 'sw.js needs an explicit cache header');
  ok(/no-(cache|store)/.test(sw.headers[0].value), `sw.js must not be cached long, got "${sw.headers[0].value}"`);
});

test('ignore files keep dev-only tooling out of the deployment', () => {
  const ignore = read('.vercelignore').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const dir of ['test', 'tools', 'smoke', 'preview']) {
    ok(ignore.includes(dir), `.vercelignore should exclude "${dir}" — tests and scratch dirs do not belong in the shipped app`);
  }
  const gi = read('.gitignore').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  ok(gi.includes('node_modules'), '.gitignore must exclude node_modules');
});

run();
