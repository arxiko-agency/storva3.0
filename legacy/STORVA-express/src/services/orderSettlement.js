'use strict';
// Stock / order tidy-ups that follow payment events, all idempotent and safe to run twice or concurrently:
//   * settleFullRefund: a fully refunded, not-yet-shipped order is cancelled and its stock + coupon use returned exactly once
//     (releaseOrderInventory is a compare-and-set on inventoryReleased).
//   * cleanupAbandoned: online orders nobody paid are cancelled and their stock released, after confirming with Razorpay that no payment exists.
//   * sweep: also repairs refunded orders whose stock release was missed (crash between the refund and the release).
const Order = require('../models/Order');
const { env } = require('../config/env');
const { decideAbandon, hasLivePayment, decideRefundSettlement } = require('../utils/orderCleanup');

const defaultDeps = () => ({
  Order,
  release: (storeId, order) => require('./storefront').releaseOrderInventory(storeId, order),
  fetchPayments: (id) => require('./razorpayApi').fetchOrderPayments(id),
  gatewayEnabled: env.razorpay.enabled,
  now: () => Date.now(),
});

async function cancelIfStill(deps, order, fromStatus, extraFilter = {}) {
  const upd = await deps.Order.updateOne({ _id: order._id, store: order.store, status: fromStatus, ...extraFilter },
    { $set: { status: 'cancelled' }, $push: { statusHistory: { status: 'cancelled', at: new Date(deps.now()) } } });
  return upd.matchedCount === 1;
}

async function settleFullRefund(storeId, orderId, deps = defaultDeps()) {
  for (let i = 0; i < 3; i++) {
    const o = await deps.Order.findOne({ _id: orderId, store: storeId });
    if (!o) return { outcome: 'order_not_found' };
    const d = decideRefundSettlement(o);
    if (d.action === 'none') return { outcome: d.reason };
    if (d.action === 'cancel_and_release' && !(await cancelIfStill(deps, o, o.status))) continue; // status changed under us: re-read and re-decide
    const released = await deps.release(storeId, o);
    return { outcome: d.action, released };
  }
  return { outcome: 'conflict' };
}

async function cleanupAbandoned(opts = {}, deps = defaultDeps()) {
  const maxAgeMs = opts.maxAgeMs || env.abandon.maxAgeMs, limit = opts.limit || env.abandon.batch;
  const report = { checked: 0, cancelled: 0, kept: 0, errors: 0, refundSettled: 0 };
  const now = deps.now();
  const cutoff = new Date(now - maxAgeMs);
  const stale = await deps.Order.find({ paymentMethod: 'razorpay', status: 'pending', paymentStatus: { $in: ['pending', 'failed'] }, createdAt: { $lt: cutoff } }).setOptions({ skipTenant: true }).sort({ createdAt: 1 }).limit(limit);
  for (const o of stale) {
    report.checked++;
    if (decideAbandon(o, now, maxAgeMs).action !== 'cancel') { report.kept++; continue; }
    if (!deps.gatewayEnabled) { report.kept++; continue; } // cannot confirm "no payment exists" without Razorpay: never guess
    // Snapshot the payment state BEFORE asking Razorpay: a webhook that lands during that call bumps paymentRev, so the write below then matches nothing.
    const rev = o.paymentRev || 0, payStatus = o.paymentStatus;
    try {
      if (o.razorpayOrderId && hasLivePayment(await deps.fetchPayments(o.razorpayOrderId))) { report.kept++; continue; }
      const guard = { paymentStatus: payStatus, ...(rev === 0 ? { $or: [{ paymentRev: 0 }, { paymentRev: { $exists: false } }] } : { paymentRev: rev }) };
      if (await cancelIfStill(deps, o, 'pending', guard)) { await deps.release(o.store, o); report.cancelled++; } else report.kept++;
    } catch (e) {
      report.errors++; // transient gateway trouble: change nothing, try again next run
      if (e && e.kind === 'auth') { console.error('[abandoned] Razorpay rejected our keys; stopping this run'); break; }
    }
  }
  // Repair pass: fully refunded orders whose stock was never returned.
  const refunded = await deps.Order.find({ paymentStatus: 'refunded', status: { $in: ['pending', 'confirmed', 'cancelled'] }, inventoryReleased: false }).setOptions({ skipTenant: true }).limit(limit);
  for (const o of refunded) { try { const r = await settleFullRefund(o.store, o._id, deps); if (r.released) report.refundSettled++; } catch { report.errors++; } }
  return report;
}

module.exports = { settleFullRefund, cleanupAbandoned };
