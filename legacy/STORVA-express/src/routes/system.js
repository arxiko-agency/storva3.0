'use strict';
const router = require('express').Router();
const mongoose = require('mongoose');
const { env } = require('../config/env');

// Liveness + DB state. Used by Render's health check.
router.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? 'up' : 'down', uptime: Math.round(process.uptime()) });
});

// Module 15: readiness for uptime monitors (UptimeRobot, Better Stack, Render). Pings the database with a 2 s timeout.
// Public answer: { ok, db }. With "Authorization: Bearer <HEALTH_TOKEN>" (or outside production) it also reports background
// jobs, the message queue, error counters and memory, so you can see a stuck job or failing emails at a glance.
const crypto = require('crypto');
const tokenOk = (req) => { const t = process.env.HEALTH_TOKEN, h = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''); if (!t || t.length < 16) return false; const hb = Buffer.from(h, 'utf8'), tb = Buffer.from(t, 'utf8'); return hb.length === tb.length && crypto.timingSafeEqual(hb, tb); };
router.get('/ready', async (req, res) => {
  const t0 = Date.now();
  let db = 'down';
  try { if (mongoose.connection.readyState === 1) { await Promise.race([mongoose.connection.db.admin().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]); db = 'up'; } } catch { db = 'down'; }
  const out = { ok: db === 'up', db, dbPingMs: Date.now() - t0 };
  res.set('Cache-Control', 'no-store');
  if (!env.isProd || tokenOk(req)) {
    const now = Date.now();
    const jobs = require('../services/jobs').stats().map((j) => ({ name: j.name, runs: j.runs, failures: j.failures, lastOkAt: j.lastOkAt, lastError: j.lastError || null, stale: Boolean(j.intervalMs && j.lastRunAt && now - new Date(j.lastOkAt || 0).getTime() > j.intervalMs * 3) }));
    let queue = null;
    if (db === 'up') {
      const OM = require('../models/OutboundMessage'), since = new Date(now - 864e5);
      const [queued, failed24h, oldest] = await Promise.all([
        OM.countDocuments({ status: { $in: ['queued', 'sending'] } }).setOptions({ skipTenant: true }),
        OM.countDocuments({ status: 'failed', updatedAt: { $gte: since } }).setOptions({ skipTenant: true }),
        OM.findOne({ status: { $in: ['queued', 'sending'] } }).sort({ createdAt: 1 }).select('createdAt').setOptions({ skipTenant: true }).lean(),
      ]).catch(() => [null, null, null]);
      queue = { waiting: queued, failedLast24h: failed24h, oldestWaitingMinutes: oldest ? Math.round((now - new Date(oldest.createdAt).getTime()) / 60000) : 0 };
    }
    const m = process.memoryUsage();
    Object.assign(out, { version: require('../../package.json').version, node: process.version, env: env.nodeEnv, uptimeSec: Math.round(process.uptime()), memoryMb: { rss: Math.round(m.rss / 1048576), heapUsed: Math.round(m.heapUsed / 1048576) }, jobs, queue, errors: require('../services/monitor').stats(), rateLimitStore: process.env.RATE_LIMIT_STORE === 'mongo' ? 'mongo' : 'memory' });
    if (jobs.some((j) => j.stale)) out.warnings = ['A background job has not succeeded recently: ' + jobs.filter((j) => j.stale).map((j) => j.name).join(', ')];
  }
  res.status(out.ok ? 200 : 503).json(out);
});

// Non-secret settings the frontend needs. Never put secrets here.
router.get('/config/public', (req, res) => {
  res.json({
    brand: env.brandName,
    supportEmail: env.supportEmail,
    supportWhatsapp: env.supportWhatsapp,
    instagramUrl: env.instagramUrl,
  });
});

module.exports = router;
