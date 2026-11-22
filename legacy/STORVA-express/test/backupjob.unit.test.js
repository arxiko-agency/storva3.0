'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bj = require('../src/services/backupJob');

const H = 3600e3;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'storva-bj-'));

test('isDue: no backup yet is due; a recent one is not; an old one is', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  assert.equal(bj.isDue({ now, lastAt: null, intervalMs: 24 * H }), true);
  assert.equal(bj.isDue({ now, lastAt: new Date(now - 23 * H), intervalMs: 24 * H }), false);
  assert.equal(bj.isDue({ now, lastAt: new Date(now - 24 * H), intervalMs: 24 * H }), true);
});
test('isDue with BACKUP_HOUR_IST: waits for that India-time hour, but never lets a backup get older than 1.5 intervals', () => {
  const at = (iso) => new Date(iso);
  const last = at('2026-11-17T20:30:00Z');                                  // 02:00 IST on the 18th
  assert.equal(bj.istHour(at('2026-11-18T20:30:00Z')), 2);
  assert.equal(bj.isDue({ now: at('2026-11-18T21:30:00Z'), lastAt: last, intervalMs: 24 * H, hourIst: 2 }), false, '03:00 IST: not the hour');
  assert.equal(bj.isDue({ now: at('2026-11-18T20:45:00Z'), lastAt: last, intervalMs: 24 * H, hourIst: 2 }), true, '02:15 IST');
  assert.equal(bj.isDue({ now: at('2026-11-19T09:00:00Z'), lastAt: last, intervalMs: 24 * H, hourIst: 2 }), true, 'overdue: catch up');
});
test('latestBackupAt reads the newest complete folder and ignores partial or unrelated ones', () => {
  const d = tmp();
  for (const n of ['storva-20261116-020000', 'storva-20261117-020000', 'storva-20261118-020000.partial', 'notes', 'storva-bad']) fs.mkdirSync(path.join(d, n));
  assert.equal(bj.latestBackupAt(d).toISOString(), '2026-11-17T02:00:00.000Z');
  assert.equal(bj.latestBackupAt(path.join(d, 'missing')), null);
});
test('settings: on by default only in production WITH a 32+ character BACKUP_KEY; the flag overrides', () => {
  const key = 'k'.repeat(32);
  assert.equal(bj.settings({ NODE_ENV: 'production', BACKUP_KEY: key }).enabled, true);
  assert.equal(bj.settings({ NODE_ENV: 'production' }).enabled, false);
  assert.equal(bj.settings({ NODE_ENV: 'development', BACKUP_KEY: key }).enabled, false);
  assert.equal(bj.settings({ NODE_ENV: 'production', BACKUP_KEY: key, BACKUP_SCHEDULE_ENABLED: 'false' }).enabled, false);
  assert.equal(bj.settings({ NODE_ENV: 'development', BACKUP_SCHEDULE_ENABLED: 'true' }).enabled, true);
  const s = bj.settings({ BACKUP_INTERVAL_HOURS: '6', BACKUP_HOUR_IST: '3' }); assert.equal(s.intervalMs, 6 * H); assert.equal(s.hourIst, 3);
  assert.equal(bj.settings({ BACKUP_HOUR_IST: '99' }).hourIst, null);
});
test('runIfDue runs the backup when due, skips when a fresh one exists, and refuses an unencrypted production backup', async () => {
  const d = tmp(), calls = [], logs = [];
  const e = { NODE_ENV: 'development', BACKUP_DIR: d, BACKUP_INTERVAL_HOURS: '24' };
  const run = async (opts) => { calls.push(opts); fs.mkdirSync(path.join(d, 'storva-20261118-100000')); return { dir: path.join(d, 'storva-20261118-100000'), removed: [] }; };
  const now = new Date('2026-11-18T10:00:00Z');
  assert.deepEqual(await bj.runIfDue({ now, e, run, log: (m) => logs.push(m) }), { ran: true, dir: path.join(d, 'storva-20261118-100000') });
  assert.equal(calls.length, 1);
  assert.deepEqual(await bj.runIfDue({ now: new Date(now.getTime() + 2 * H), e, run }), { ran: false });
  assert.equal(calls.length, 1);
  const d2 = tmp();
  await assert.rejects(bj.runIfDue({ now, e: { NODE_ENV: 'production', BACKUP_DIR: d2 }, run }), /BACKUP_KEY/);
  assert.equal(calls.length, 1, 'nothing was written');
});
