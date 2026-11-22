'use strict';
// Automatic refund of cancelled, paid online orders. Reuses the existing refund pipeline (services/refunds.js: reserve -> Razorpay with a stable
// idempotency key -> record through decideRefund) and the existing verification (services/reconciliation.js), and adds only the missing part:
// noticing that a paid online order was cancelled and making sure the money goes back, exactly once, even across crashes, retries and several servers.
//
// Why a duplicate refund cannot happen:
//   * each attempt has a deterministic request key (auto-<orderId>-<attempt>); initiateRefund replays an existing entry for the same key instead of creating another
//   * initiateRefund reserves the money with a compare-and-set on paymentRev and refuses to start while another refund is in flight
//   * Razorpay itself receives the same X-Refund-Idempotency header on every re-send of one attempt
//   * a NEW attempt is planned only after the earlier one reached 'failed' (Razorpay refused / failed it), never while one is pending or created
// Failure handling: a refusal or failure marks the attempt 'failed' and the next attempt starts after a growing back-off, up to AUTO_REFUND_MAX_ATTEMPTS.
// After that the order is flagged (autoRefundExhausted), the owner is alerted, and the owner can still refund by hand from the dashboard.
const { env } = require('../config/env');
const R = require('../utils/refundMath');
const events = require('./events');
const refundEvents = require('./refundEvents');

const defaultDeps = () => ({
  Order: require('../models/Order'),
  Store: require('../models/Store'),
  refunds: require('./refunds'),
  verify: (order) => require('./reconciliation').reconcileOrder(order, { now: new Date(), dryRun: false, t: { ...require('../utils/reconcile').DEFAULTS, refundMinAgeMs: 0, recheckMs: 0 } }),
  enabled: () => env.autoRefund.enabled && env.razorpay.enabled,
  settings: () => ({ maxAttempts: env.autoRefund.maxAttempts, retryBackoffMs: env.autoRefund.retryBackoffMs, verifyAfterMs: env.autoRefund.verifyAfterMs }),
  now: () => Date.now(),
});

const isDefinite = (e) => Boolean(e) && e.definite === true;

// Moves ONE order's automatic refund one step forward. Always safe to call again. -> { outcome, ... }
async function processOrder(storeId, orderId, deps = defaultDeps()) {
  if (!deps.enabled()) return { outcome: 'disabled' };
  const order = await deps.Order.findOne({ _id: orderId, store: storeId });
  if (!order) return { outcome: 'order_not_found' };
  const plan = R.planAutoRefund(order, deps.now(), deps.settings());
  if (plan.action === 'none' || plan.action === 'wait') return { outcome: plan.action + ':' + plan.reason };
  const store = await deps.Store.findById(storeId);
  if (!store) return { outcome: 'store_not_found' };

  if (plan.action === 'exhausted') return exhaust(deps, order, plan.attempts);

  if (plan.action === 'verify') { // Razorpay accepted it earlier: read its real status. This records processed / failed and tells the buyer and owner (refundEvents.announce).
    try { await deps.verify(order); } catch (e) { return { outcome: 'verify_failed', error: e && e.message }; }
    return { outcome: 'verified' };
  }

  try {
    if (plan.action === 'retry') { await deps.refunds.retryRefund(store, order.orderNumber, plan.key); return { outcome: 'retried' }; }
    await deps.refunds.initiateRefund(store, null, order.orderNumber, { type: 'full', reason: 'Order cancelled: automatic refund', idempotencyKey: plan.key }, { source: 'auto' });
    return { outcome: 'started', attempt: plan.attempt };
  } catch (e) {
    const code = e && e.code;
    if (code === 'refund_in_progress' || code === 'conflict' || code === 'already_refunded' || code === 'not_paid') return { outcome: 'skipped:' + code };
    if (code === 'payments_unavailable') return { outcome: 'skipped:payments_unavailable' };
    if (isDefinite(e)) { // Razorpay refused: the entry is now 'failed'. Tell the owner; the next attempt waits for the back-off.
      const fresh = await deps.Order.findOne({ _id: orderId, store: storeId });
      emitFailed(order, fresh, e);
      return { outcome: 'refused' };
    }
    console.error('[autoRefund] order #' + order.orderNumber + ' will be retried:', e && e.message); // unknown outcome (timeout / 5xx): still reserved, the sweep re-sends it with the same key
    return { outcome: 'unknown_will_retry' };
  }
}

// A refusal has no gateway id, so announce() cannot see it: raise the failure event directly (listener is deduplicated per attempt).
function emitFailed(before, after, e) {
  const entry = after && (after.refunds || []).filter((r) => r.source === 'auto').pop();
  events.emit('order.refund_failed', { storeId: before.store, orderId: before._id, refundId: entry && entry.refundId || null, amountPaise: entry ? entry.amountPaise : before.totalPaise, auto: true, final: false, attempt: (after.refunds || []).filter((r) => r.source === 'auto').length, reason: e && e.gatewayCode || '' });
}

// Every allowed attempt failed. Flag it once (compare-and-set), alert the owner (+ tell the buyer), stop retrying.
async function exhaust(deps, order, attempts) {
  const upd = await deps.Order.updateOne({ _id: order._id, store: order.store, autoRefundExhausted: { $ne: true } }, { $set: { autoRefundExhausted: true } });
  if (upd && upd.matchedCount === 0) return { outcome: 'exhausted:already_flagged' };
  console.error(`[autoRefund] store=${order.store} order=#${order.orderNumber}: ${attempts} automatic refund attempts failed. Refund it from the dashboard or in Razorpay.`);
  events.emit('order.refund_failed', { storeId: order.store, orderId: order._id, refundId: null, amountPaise: order.totalPaise, auto: true, final: true, attempt: attempts });
  return { outcome: 'exhausted', attempts };
}

// Background pass: every cancelled paid online order that is still owed money (cancel happened while the server was down, a webhook was missed,
// the payment was captured AFTER the order was cancelled, an attempt failed and its back-off is over, or a refund needs its status checked).
async function sweep(opts = {}, deps = defaultDeps()) {
  const report = { checked: 0, started: 0, retried: 0, verified: 0, exhausted: 0, waiting: 0, errors: 0 };
  if (!deps.enabled()) return { ...report, disabled: true };
  const limit = opts.limit || env.autoRefund.batch;
  const rows = await deps.Order.find({ status: 'cancelled', paymentMethod: 'razorpay', paymentStatus: 'paid', razorpayPaymentId: { $type: 'string' }, autoRefundExhausted: { $ne: true } })
    .setOptions({ skipTenant: true }).sort({ updatedAt: 1 }).limit(limit); // platform job: the only cross-store read; every write below is store-scoped
  for (const o of rows) {
    report.checked++;
    try {
      const r = await processOrder(o.store, o._id, deps);
      if (r.outcome === 'started') report.started++; else if (r.outcome === 'retried') report.retried++; else if (r.outcome.startsWith('verified')) report.verified++;
      else if (r.outcome.startsWith('exhausted')) report.exhausted++; else if (r.outcome.startsWith('wait') || r.outcome.startsWith('skipped')) report.waiting++;
      else if (r.outcome === 'unknown_will_retry' || r.outcome === 'verify_failed') report.errors++;
    } catch (e) { report.errors++; console.error('[autoRefund] sweep failed for an order:', e && e.message); }
  }
  return report;
}

// Event wiring: a cancelled paid online order (dashboard or WhatsApp CANCEL) and a late payment on an already-cancelled order both start the refund at once.
let registered = false;
function register(deps) {
  if (registered) return; registered = true;
  const run = (payload) => processOrder(payload.storeId, payload.orderId, deps || undefined).catch((e) => console.error('[autoRefund] could not process the order now; the background sweep will:', e && e.message));
  events.on('order.status_changed', (p) => (p.to === 'cancelled' ? run(p) : undefined));
  events.on('order.paid', run); // late capture after cancellation (processOrder ignores everything that is not cancelled + paid)
}

module.exports = { processOrder, sweep, register, refundEvents };
