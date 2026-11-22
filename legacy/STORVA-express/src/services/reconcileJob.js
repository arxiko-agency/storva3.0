'use strict';
// Runs payment reconciliation in the background of the web process. Safe by design: reconciliation is idempotent and compare-and-set, so several
// instances (or this timer plus scripts/reconcile.js) can run at once without double-applying anything; the worst case is a few duplicate Razorpay reads.
const { env } = require('../config/env');
const { reconcileBatch } = require('./reconciliation');

function start() {
  if (!env.razorpay.enabled || !env.reconcile.enabled) return null;
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap with itself
    running = true;
    try { await reconcileBatch(); } catch (e) { console.error('[reconcile] run failed:', e && e.message); } finally { running = false; }
  };
  const first = setTimeout(tick, 60 * 1000), every = setInterval(tick, env.reconcile.intervalMs);
  first.unref(); every.unref(); // never keep the process alive just for this
  console.log(`[reconcile] background check every ${Math.round(env.reconcile.intervalMs / 60000)} min`);
  return { stop() { clearTimeout(first); clearInterval(every); }, tick };
}

module.exports = { start };
