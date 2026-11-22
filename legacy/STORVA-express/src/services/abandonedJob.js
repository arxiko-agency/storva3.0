'use strict';
// Background timer for abandoned-order cleanup. Idempotent and compare-and-set, so several instances may run it at once.
const { env } = require('../config/env');
const { cleanupAbandoned } = require('./orderSettlement');

function start() {
  if (!env.abandon.enabled) return null;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { const r = await cleanupAbandoned(); if (r.cancelled || r.refundSettled || r.errors) console.log('[abandoned]', JSON.stringify(r)); }
    catch (e) { console.error('[abandoned] run failed:', e && e.message); } finally { running = false; }
  };
  const first = setTimeout(tick, 90 * 1000), every = setInterval(tick, env.abandon.intervalMs);
  first.unref(); every.unref();
  console.log(`[abandoned] cleanup every ${Math.round(env.abandon.intervalMs / 60000)} min, unpaid online orders older than ${Math.round(env.abandon.maxAgeMs / 60000)} min`);
  return { stop() { clearTimeout(first); clearInterval(every); }, tick };
}
module.exports = { start };
