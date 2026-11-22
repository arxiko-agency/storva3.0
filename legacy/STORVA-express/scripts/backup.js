#!/usr/bin/env node
'use strict';
// Module 15: make a backup now.   node scripts/backup.js            (uses MONGODB_URI, BACKUP_DIR, BACKUP_KEY, BACKUP_KEEP, UPLOAD_DIR)
// Schedule it daily (Render cron job / crontab):  0 2 * * *  cd /app && node scripts/backup.js
// Then copy BACKUP_DIR somewhere else (another disk, Google Drive, S3). A backup on the same disk does not survive losing that disk.
require('dotenv').config();
const mongoose = require('mongoose');
const { backup } = require('../src/services/backup');
(async () => {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const r = await backup();
  console.log(`[backup] done: ${r.dir}${r.manifest.encrypted ? ' (encrypted)' : ' (NOT encrypted: set BACKUP_KEY to encrypt)'}${r.removed.length ? `; removed ${r.removed.length} old backup(s)` : ''}`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error('[backup] FAILED:', e.message); try { await require('../src/services/monitor').captureError(e, { kind: 'job', job: 'backup' }); } catch { /* ignore */ } await new Promise((r) => setTimeout(r, 1500)); process.exit(1); });
