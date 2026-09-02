/* =====================================================================
   test/app.js — shared helpers: read app files, and load the whole app in a
   stub DOM the same way index.html does.
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* scripts in the exact order index.html loads them */
function scriptTags(html) {
  return [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(m => m[1]);
}
function styleTags(html) {
  return [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(m => m[1]);
}

/* Load the whole app the way index.html does: stub DOM + every <script> in
   order, sharing one global — then hand back the window-ish sandbox. */
function loadApp({ runBoot = false, before = null } = {}) {
  const stub = require('./dom-stub');
  const html = read('index.html');
  const win = stub.createWindow({ knownIds: stub.idsInHtml(html) });
  if (before) before(win);
  const ctx = stub.createContext(win);
  const files = scriptTags(html).map(s => s.replace(/^\.\//, ''));
  const errors = [];
  for (const f of files) {
    try { stub.loadScript(ctx, f, read(f)); }
    catch (e) { errors.push(`${f}: ${e && e.message}`); }
  }
  if (errors.length) throw new Error('module load failed\n  ' + errors.join('\n  '));
  // main.js defers boot() until DOMContentLoaded, so fire it explicitly
  if (runBoot) win.document.__fire('DOMContentLoaded');
  return { win, ctx, files, html };
}

module.exports = { ROOT, read, exists, scriptTags, styleTags, loadApp };
