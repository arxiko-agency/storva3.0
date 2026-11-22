'use strict';
// Module 15: error monitoring without a third-party SDK.
//  - every server error / failed background job / crash is logged as ONE JSON line (easy to search in Render / any log tool)
//  - optionally posted to ALERT_WEBHOOK_URL (Slack, Discord or any endpoint that accepts JSON { text }), de-duplicated:
//    the same error at most once per 10 minutes, and at most 30 alerts per hour overall, so an outage can't flood you.
// Never include request bodies, cookies or headers: only method, path (without query string), request id and the error.
const crypto = require('crypto');
const recent = new Map(); let hourStart = Date.now(), hourCount = 0;
const counters = { errors: 0, alertsSent: 0, alertsDropped: 0, lastErrorAt: null };

const fingerprint = (err, ctx) => crypto.createHash('sha1').update(`${ctx.kind || ''}|${(err && err.name) || ''}|${String((err && err.message) || err).slice(0, 120)}|${ctx.path || ctx.job || ''}`).digest('hex').slice(0, 12);

function shouldAlert(fp, now = Date.now()) {
  if (now - hourStart > 3600e3) { hourStart = now; hourCount = 0; }
  const last = recent.get(fp);
  if (last && now - last < 10 * 60e3) return false;
  if (hourCount >= 30) return false;
  recent.set(fp, now); hourCount++;
  if (recent.size > 1000) for (const [k, t] of recent) if (now - t > 10 * 60e3) recent.delete(k);
  return true;
}

async function sendAlert(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !/^https:\/\//.test(url)) return false;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: ctrl.signal }); return r.ok; }
  catch { return false; } finally { clearTimeout(t); }
}

// ctx: { kind: 'request' | 'job' | 'crash' | 'unhandled', method, path, requestId, job, storeId }
function captureError(err, ctx = {}) {
  counters.errors++; counters.lastErrorAt = new Date();
  const fp = fingerprint(err, ctx);
  const line = { level: 'error', at: new Date().toISOString(), fp, ...ctx, error: { name: err && err.name, message: String((err && err.message) || err).slice(0, 500), code: err && typeof err.code !== 'object' ? err.code : undefined, stack: err && err.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined } };
  console.error(JSON.stringify(line));
  if (process.env.NODE_ENV === 'test' && !process.env.ALERT_WEBHOOK_URL) return fp;
  if (shouldAlert(fp)) {
    const brand = process.env.BRAND_NAME || 'STORVA';
    const where = ctx.kind === 'job' ? `job ${ctx.job}` : ctx.path ? `${ctx.method || ''} ${ctx.path}` : ctx.kind;
    sendAlert(`🚨 ${brand} ${process.env.NODE_ENV || ''}: ${line.error.name || 'Error'}: ${line.error.message}\n${where}${ctx.requestId ? ` · request ${ctx.requestId}` : ''} · ref ${fp}`).then((ok) => { if (ok) counters.alertsSent++; });
  } else counters.alertsDropped++;
  return fp;
}

let installed = false;
function installProcessHandlers() {
  if (installed) return; installed = true;
  process.on('unhandledRejection', (reason) => captureError(reason instanceof Error ? reason : new Error(String(reason)), { kind: 'unhandled' }));
  process.on('uncaughtException', (err) => { captureError(err, { kind: 'crash' }); setTimeout(() => process.exit(1), 1500).unref(); }); // state is unknown after a crash: let the host restart us
}
const stats = () => ({ ...counters });
module.exports = { captureError, installProcessHandlers, stats, _shouldAlert: shouldAlert, _reset: () => { recent.clear(); hourCount = 0; hourStart = Date.now(); } };
