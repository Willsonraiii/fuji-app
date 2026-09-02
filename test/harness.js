/* =====================================================================
   test/harness.js — a zero-dependency test micro-framework.

   This repo is a dependency-free static PWA, so CI must not need npm
   packages to verify it. Each test file registers cases here and can be
   run standalone (`node test/foo.test.js`) or via `node test/run.js`.
   ===================================================================== */
'use strict';

const assert = require('node:assert/strict');

const cases = [];
let current = null;

function test(name, fn) { cases.push({ name, fn }); }

/* --- small helpers shared by the suites --- */
function ok(cond, msg) { assert.ok(cond, msg); }
function eq(a, b, msg) { assert.equal(a, b, msg); }
function near(a, b, eps, msg) {
  assert.ok(Number.isFinite(a), `${msg || 'value'} is not finite: ${a}`);
  assert.ok(Math.abs(a - b) <= (eps == null ? 1e-6 : eps), `${msg || 'value'} ${a} !~ ${b}`);
}

function section(t) {
  process.stdout.write(`\n# ${t}\n`);
}

async function run() {
  const started = Date.now();
  let pass = 0;
  const failures = [];
  for (const c of cases) {
    current = c.name;
    try {
      await c.fn();
      pass++;
      process.stdout.write(`  ok  ${c.name}\n`);
    } catch (err) {
      failures.push({ name: c.name, err });
      process.stdout.write(`  FAIL ${c.name}\n        ${(err && err.message || String(err)).split('\n').join('\n        ')}\n`);
    }
  }
  current = null;
  const ms = Date.now() - started;
  process.stdout.write(`\n${pass}/${cases.length} passed in ${ms}ms${failures.length ? ` — ${failures.length} FAILED` : ''}\n`);
  process.exitCode = failures.length ? 1 : 0;
}

module.exports = { test, run, ok, eq, near, assert, section, name: () => current };
