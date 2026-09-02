/* =====================================================================
   test/run.js — the whole suite, zero dependencies.

   Usage:  node test/run.js            (or `npm test`)
           node test/run.js exif sw     (substring filter on file names)

   Each *.test.js runs in its own process: module-level globals must not leak
   from one suite into the next.
   ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const filter = process.argv.slice(2);
const suites = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filter.length || filter.some(x => f.includes(x)))
  .sort();

if (!suites.length) {
  process.stdout.write('no suites matched\n');
  process.exit(1);
}

const started = Date.now();
let failed = 0;
let passed = 0;
const results = [];

for (const file of suites) {
  const header = `── ${file} ${'─'.repeat(Math.max(0, 62 - file.length))}`;
  process.stdout.write(`\n${header}\n`);
  const res = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  const summary = /(\d+)\/(\d+) passed/.exec(out);
  const count = summary ? { ok: Number(summary[1]), total: Number(summary[2]) } : null;
  const bad = res.status !== 0;
  if (bad) failed++;
  else passed++;
  results.push({ file, ok: !bad, count, ms: Date.now() });
  if (bad && !count) {
    process.stdout.write(`   (suite crashed: exit ${res.status})\n`);
  }
}

const total = results.reduce((n, r) => n + (r.count ? r.count.total : 0), 0);
const okCount = results.reduce((n, r) => n + (r.count ? r.count.ok : 0), 0);
const secs = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\n${'═'.repeat(64)}\n`);
process.stdout.write(`${suites.length - failed}/${suites.length} suites · ${okCount}/${total} assertions · ${secs}s\n`);
if (failed) {
  process.stdout.write(`failing suites: ${results.filter(r => !r.ok).map(r => r.file).join(', ')}\n`);
}
process.exitCode = failed ? 1 : 0;
