'use strict';
// Portable test runner. `node --test test/` fails on Node 21+ (a directory is no longer expanded), and shell globs
// differ between Windows and Linux, so list the files ourselves.
//   node scripts/run-tests.js            -> every test/*.test.js (integration suites self-skip without MONGODB_URI)
//   node scripts/run-tests.js unit       -> only *.unit.test.js (+ module1.test.js, no DB needed)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const mode = process.argv[2] || 'all';
let files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
if (mode === 'unit') files = files.filter((f) => !f.includes('.integration.'));
if (mode === 'integration') files = files.filter((f) => f.includes('.integration.'));
if (!files.length) { console.error('No test files found for mode:', mode); process.exit(2); }

const r = spawnSync(process.execPath, ['--test', ...files.map((f) => path.join(dir, f))], { stdio: 'inherit', env: process.env });
process.exit(r.status === null ? 1 : r.status);
