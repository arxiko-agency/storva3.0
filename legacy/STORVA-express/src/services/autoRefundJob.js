'use strict';
// Background timer for automatic refunds of cancelled paid online orders (see services/autoRefund.js). Idempotent and compare-and-set,
// so several instances may run it at once. Registered with services/jobs so Module 15 health/metrics show its runs and failures.
const { env } = require('../config/env');

function start() {
  if (!env.autoRefund.enabled || !env.razorpay.enabled) return null;
  const job = require('./jobs').startJob('auto-refund', async () => {
    const r = await require('./autoRefund').sweep();
    if (r.started || r.retried || r.verified || r.exhausted || r.errors) console.log('[autoRefund]', JSON.stringify(r));
  }, { intervalMs: env.autoRefund.intervalMs, firstDelayMs: 60 * 1000 });
  console.log(`[autoRefund] cancelled paid online orders are refunded automatically; sweep every ${Math.round(env.autoRefund.intervalMs / 60000)} min, up to ${env.autoRefund.maxAttempts} attempts`);
  return job;
}
module.exports = { start };
