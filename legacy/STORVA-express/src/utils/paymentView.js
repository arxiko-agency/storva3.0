'use strict';
// Pure presentation rules for the owner payment dashboard: ONE place decides which status label an order shows.
const { refundable } = require('./refundMath');
const R2 = require('./refundMath');

// -> 'paid' | 'pending' | 'failed' | 'refunded' | 'partially_refunded' | 'refund_pending' | 'cod_paid' | 'cod_unpaid'
function displayStatus(o) {
  if (o.paymentMethod !== 'razorpay') return o.paymentStatus === 'paid' ? 'cod_paid' : 'cod_unpaid';
  if (o.paymentStatus === 'refunded') return 'refunded';
  if (o.paymentStatus === 'paid') {
    if (refundable(o).hasInFlight) return 'refund_pending';
    return (o.refundedPaise || 0) > 0 ? 'partially_refunded' : 'paid';
  }
  if (o.paymentStatus === 'failed') return 'failed';
  return 'pending';
}
const STATUS_TEXT = {
  paid: 'Paid', pending: 'Payment pending', failed: 'Payment failed', refunded: 'Fully refunded', partially_refunded: 'Partially refunded',
  refund_pending: 'Refund in progress', cod_paid: 'Cash received', cod_unpaid: 'Cash not received',
};

const rupees = (p) => (p == null ? null : p / 100);
// One row of the transaction list / the detail card. `o` is an Order document or plain snapshot.
function paymentApi(o, { detail = false } = {}) {
  const rf = refundable(o), ds = displayStatus(o), online = o.paymentMethod === 'razorpay';
  const out = {
    orderNumber: o.orderNumber, orderStatus: o.status, customer: { name: o.customer.name, phone: o.customer.phone },
    method: online ? 'online' : 'cod', paymentStatus: o.paymentStatus, displayStatus: ds, statusText: STATUS_TEXT[ds],
    amount: rupees(o.totalPaise), refundedAmount: rupees(rf.processedPaise), refundInProgressAmount: rupees(rf.inFlightPaise), refundableAmount: online && o.paymentStatus === 'paid' ? rupees(rf.refundablePaise) : 0,
    paidAt: o.paidAt || null, createdAt: o.createdAt,
  };
  if (detail) {
    out.razorpayOrderId = o.razorpayOrderId || null; out.razorpayPaymentId = o.razorpayPaymentId || null; out.paymentError = o.paymentError || '';
    out.refunds = (o.refunds || []).map((x) => ({ refundId: x.refundId || null, amount: rupees(x.amountPaise), status: x.status, reason: x.reason || '', source: x.source || 'gateway', error: x.error || '', idempotencyKey: x.idempotencyKey || null, createdAt: x.createdAt || null, updatedAt: x.updatedAt || null, canRetry: x.status === 'pending' && !x.refundId }));
    out.autoRefund = o.status === 'cancelled' && online ? { state: R2.buyerRefundState(o), attempts: (o.refunds || []).filter((x) => x.source === 'auto').length, needsAttention: Boolean(o.autoRefundExhausted) } : null; // automatic refund of a cancelled paid order
    out.canRefund = online && o.paymentStatus === 'paid' && !!o.razorpayPaymentId && rf.refundablePaise > 0 && !rf.hasInFlight;
    out.refundBlockedReason = out.canRefund ? '' : !online ? 'Cash on delivery orders are not refunded through Razorpay.' : o.paymentStatus === 'refunded' ? 'This payment is fully refunded.' : o.paymentStatus !== 'paid' ? 'Only paid orders can be refunded.' : rf.hasInFlight ? 'A refund is already in progress. Wait for it to finish (or retry it) before starting another.' : 'Nothing is left to refund.';
  }
  return out;
}

module.exports = { displayStatus, paymentApi, STATUS_TEXT };
