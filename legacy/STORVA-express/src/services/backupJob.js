'use strict';
// Scheduled encrypted backups (uses services/backup.js, the same code as `node scripts/backup.js`).
// ON by default in production when BACKUP_KEY is set (32+ chars); BACKUP_SCHEDULE_ENABLED=true/false overrides.
// A scheduled backup is never written unencrypted in production: without BACKUP_KEY the run fails loudly (alert) instead.
//   BACKUP_INTERVAL_HOURS  hours between backups (default 24, min 1)
//   BACKUP_HOUR_IST        optional 0-23: start the daily run in this India-time hour (default: as soon as one is due)
// The check runs every 30 minutes. Safe on several instances: each keeps its own BACKUP_DIR, and a backup only reads the database.
const fs = require('fs');
const path = require('path');
const jobs = require('./jobs');

const NAME = /^storva-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;
// Time of the newest complete backup folder in `dir` (names carry a UTC stamp), or null. Half-written `.partial` folders never match.
function latestBackupAt(dir) {
  let names; try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  for (const n of names) {
    const m = NAME.exec(n); if (!m) continue;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best);
}
const istHour = (d) => new Date(d.getTime() + 5.5 * 3600e3).getUTCHours();
// Pure decision. With hourIst set, the run waits for that hour but never lets a backup get older than 1.5 intervals.
function isDue({ now, lastAt, intervalMs, hourIst = null }) {
  if (!lastAt) return true;
  const age = now.getTime() - lastAt.getTime();
  if (age < intervalMs) return false;
  if (hourIst === null || hourIst === undefined) return true;
  return istHour(now) === hourIst || age >= intervalMs * 1.5;
}
function settings(e = process.env) {
  const flag = e.BACKUP_SCHEDULE_ENABLED;
  const keyOk = Boolean(e.BACKUP_KEY && e.BACKUP_KEY.length >= 32);
  const enabled = flag === 'false' ? false : flag === 'true' ? true : (e.NODE_ENV === 'production' && keyOk);
  const h = e.BACKUP_HOUR_IST === undefined || e.BACKUP_HOUR_IST === '' ? null : Number(e.BACKUP_HOUR_IST);
  return { enabled, dir: e.BACKUP_DIR || './backups', intervalMs: Math.max(1, Number(e.BACKUP_INTERVAL_HOURS) || 24) * 3600e3, hourIst: Number.isInteger(h) && h >= 0 && h <= 23 ? h : null, isProd: e.NODE_ENV === 'production', keyOk };
}

async function runIfDue({ now = new Date(), e = process.env, run = (opts) => require('./backup').backup(opts), log = console.log } = {}) {
  const s = settings(e);
  if (!isDue({ now, lastAt: latestBackupAt(path.resolve(s.dir)), intervalMs: s.intervalMs, hourIst: s.hourIst })) return { ran: false };
  if (s.isProd && !s.keyOk) throw new Error('Scheduled backup refused: BACKUP_KEY (32+ characters) is not set, and production backups must be encrypted.');
  const r = await run({ now });
  log(`[backup-job] done: ${r.dir}${r.removed && r.removed.length ? `; removed ${r.removed.length} old backup(s)` : ''}`);
  return { ran: true, dir: r.dir };
}

function startBackupJob() {
  const s = settings();
  if (!s.enabled) return null;
  return jobs.startJob('backup', () => runIfDue(), { intervalMs: 30 * 60 * 1000, firstDelayMs: 2 * 60 * 1000 });
}

module.exports = { startBackupJob, runIfDue, isDue, latestBackupAt, settings, istHour };
