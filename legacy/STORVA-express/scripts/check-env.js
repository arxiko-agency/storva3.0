#!/usr/bin/env node
'use strict';
// Offline production configuration check (no network, nothing is sent).   npm run check:env
// Reads .env (if present) and the real environment. Exit code 1 when anything is an error, so it can gate a deploy.
//   NODE_ENV=production npm run check:env      -> check as production will run
require('dotenv').config();
const { evaluate, hasErrors } = require('../src/config/preflight');
const items = evaluate(process.env);
const icon = { error: 'ERROR', warn: 'warn ', info: 'info ' };
console.log(`STORVA environment check (NODE_ENV=${process.env.NODE_ENV || 'development'})\n`);
for (const i of items) console.log(`${icon[i.level]}  ${i.key}: ${i.message}`);
const n = (l) => items.filter((i) => i.level === l).length;
console.log(`\n${n('error')} error(s), ${n('warn')} warning(s), ${n('info')} optional feature(s) off.`);
if (process.env.NODE_ENV !== 'production') console.log('Tip: run with NODE_ENV=production to see the production-only checks.');
process.exit(hasErrors(items) ? 1 : 0);
