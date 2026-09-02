/* =====================================================================
   test/syntax.test.js — every shipped file must parse, on its own, with
   no bundler or transpiler (this repo is served as-is).
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, run, ok, eq } = require('./harness');
const { ROOT, read } = require('./app');

const files = [
  ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`),
  'sw.js'
];

test('the file list is not empty (guards against a bad glob)', () => {
  ok(files.length >= 10, `expected the 9 app modules + sw.js, saw ${files.length}`);
});

for (const f of files) {
  test(`${f} compiles`, () => {
    const src = read(f);
    ok(src.length > 0, `${f} is empty`);
    // Compiling (not executing) is what a browser does before running it.
    new vm.Script(src, { filename: f });
  });
}

test('modules are IIFE-scoped and only publish through window.FUJI / window.App', () => {
  const offenders = [];
  for (const f of files.filter(f => f.startsWith('js/'))) {
    const src = read(f);
    const body = src.replace(/^(?:\s|\/\*[\s\S]*?\*\/)*\s*/, '');   // skip the header comment
    if (!/^\(function\s*\(global\)\s*\{/.test(body)) offenders.push(`${f} is not wrapped in an IIFE taking \`global\``);
    if (!/^\(function\s*\(global\)\s*\{\s*\n?\s*"use strict";/.test(body)) offenders.push(`${f} must open with (function (global) { "use strict";`);
    if (/^var\s/m.test(src)) offenders.push(`${f} declares a top-level var (leaks into window)`);
  }
  eq(offenders.length, 0, offenders.join('\n  '));
});

test('no ES module syntax sneaks in (the shell loads classic <script> tags)', () => {
  const hits = [];
  for (const f of files) {
    const src = read(f);
    if (/^\s*(import|export)\s/m.test(src)) hits.push(f);
  }
  eq(hits.length, 0, `classic scripts cannot use import/export: ${hits.join(', ')}`);
});

test('no optional chaining / nullish in sw.js (older Safari ships old SW runtimes)', () => {
  // the app scripts may use modern syntax (iOS 16+), but the service worker
  // is parsed by whatever WebKit version is installed — keep it ES2017-safe
  const sw = read('sw.js');
  ok(!/\?\./.test(sw), 'sw.js uses optional chaining');
  ok(!/\?\?/.test(sw), 'sw.js uses nullish coalescing');
});

run();
