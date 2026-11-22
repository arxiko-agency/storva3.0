'use strict';
// Pure decisions for (a) cleaning up abandoned online orders and (b) returning stock after a FULL refund. No I/O here so every rule is unit-testable.

// (a) An online order the buyer never paid. Only a still-pending order whose payment never completed, and that is old enough, may be cancelled.
function decideAbandon(order, nowMs, maxAgeMs) {
  if (order.paymentMethod !== 'razorpay') return { action: 'skip', reason: 'not_online_order' };
  if (order.status !== 'pending') return { action: 'skip', reason: 'order_' + order.status };
  if (!['pending', 'failed'].includes(order.paymentStatus)) return { action: 'skip', reason: 'payment_' + order.paymentStatus };
  if ((order.refunds || []).length) return { action: 'skip', reason: 'has_refunds' };
  if (nowMs - new Date(order.createdAt).getTime() < maxAgeMs) return { action: 'skip', reason: 'too_recent' };
  return { action: 'cancel', reason: 'abandoned' };
}

// Money-bearing payment states: if Razorpay shows ANY of these for the order, it is NOT abandoned (reconciliation settles it instead).
const LIVE_PAYMENT = new Set(['captured', 'authorized']);
const hasLivePayment = (items) => !Array.isArray(items) || items.some((p) => !p || typeof p.status !== 'string' || LIVE_PAYMENT.has(p.status)); // unreadable => assume live (safe)

// (b) After an order's payment becomes fully refunded. Stock returns only while the goods cannot have left the store (pending / confirmed).
// Shipped / delivered orders are NOT restocked automatically: the goods may be with the buyer; the owner decides.
function decideRefundSettlement(order) {
  if (order.paymentStatus !== 'refunded') return { action: 'none', reason: 'not_fully_refunded' };
  if (order.status === 'cancelled') return order.inventoryReleased ? { action: 'none', reason: 'already_released' } : { action: 'release', reason: 'cancelled_not_yet_released' };
  if (order.status === 'pending' || order.status === 'confirmed') return { action: 'cancel_and_release', reason: 'refunded_before_shipping' };
  return { action: 'none', reason: 'goods_may_have_shipped' };
}
module.exports = { decideAbandon, hasLivePayment, decideRefundSettlement };
