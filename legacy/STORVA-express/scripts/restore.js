#!/usr/bin/env node
'use strict';
// Module 15: restore a backup into the database in MONGODB_URI.
//   node scripts/restore.js backups/storva-20260101-020000 --yes            restore into an EMPTY database
//   ... --drop --yes                                                          replace existing collections
//   ... --only=orders,products --drop --yes                                   just some collections
// Production databases need --i-know-this-is-production as well. Checksums are verified before anything is written.
require('dotenv').config();
const mongoose = require('mongoose');
const { restore } = require('../src/services/backup');
const args = process.argv.slice(2), flag = (f) => args.includes(f), dir = args.find((a) => !a.startsWith('--'));
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
(async () => {
  if (!dir) throw new Error('Usage: node scripts/restore.js <backup-folder> [--drop] [--only=a,b] --yes');
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI to the database to restore INTO.');
  if (!flag('--yes')) throw new Error('Add --yes to confirm. Restoring writes to ' + process.env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@'));
  if (process.env.NODE_ENV === 'production' && !flag('--i-know-this-is-production')) throw new Error('NODE_ENV is production: add --i-know-this-is-production if you really mean to restore into the live database.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const r = await restore(dir, { drop: flag('--drop'), only: only.length ? only : null });
  console.log(`[restore] done: ${r.collections.length} collections from ${r.manifest.createdAt}`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('[restore] FAILED:', e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
