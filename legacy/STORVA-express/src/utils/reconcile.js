'use strict';
// Pure payment-reconciliation rules (no database, no network): which orders count as "stuck", how Razorpay's API answers are validated,
// what should be done with them, and a last safety net that refuses any change that would move an order backwards.
// The actual state changes reuse the webhook decisions (decideCaptured / decideFailed / decideRefund), so reconciliation and webhooks can never disagree.
const { ledgerStatusOf, IN_FLIGHT } = require('./refundMath');

const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const DEFAULTS = {
  minAgeMs: 15 * MIN,          // never touch an order the buyer may still be paying for right now (verify + webhook normally settle it within seconds)
  maxAgeMs: 30 * DAY,          // older unsettled orders are abandoned; stop asking Razorpay about them
  recheckMs: 30 * MIN,         // minimum gap between two checks of the same order (keeps API calls bounded)
  refundMinAgeMs: 10 * MIN,    // a refund younger than this is probably still being processed by the normal flow
  refundUnconfirmedMs: 60 * MIN, // a dashboard refund Razorpay still does not know about after this long is reported for a human
};
const PAYMENT_STATES = ['pending', 'failed'];       // the only local states reconciliation may move FORWARD from (pending/failed -> paid, pending -> failed)

const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/, PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/, REFUND_ID = /^rfnd_[A-Za-z0-9]{6,40}$/;
const int = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const ms = (d) => (d ? new Date(d).getTime() : NaN);
const plainRefund = (r) => (r && typeof r.toObject === 'function' ? r.toObject() : { ...r });
const inFlight = (order) => (order.refunds || []).map(plainRefund).filter((r) => IN_FLIGHT.has(r.status));

// ---------- which orders ----------
function isStuckPayment(order, now, o = {}) {
  const c = { ...DEFAULTS, ...o };
  if (order.paymentMethod !== 'razorpay' || !PAYMENT_STATES.includes(order.paymentStatus)) return false;
  if (typeof order.razorpayOrderId !== 'string' || !order.razorpayOrderId) return false; // no Razorpay order was ever created: nothing to ask about
  const age = now - ms(order.createdAt);
  if (!(age >= c.minAgeMs && age <= c.maxAgeMs)) return false;
  const last = ms(order.reconcileCheckedAt);
  return !(last === last) || now - last >= c.recheckMs;
}
function isStuckRefund(order, now, o = {}) {
  const c = { ...DEFAULTS, ...o };
  if (order.paymentMethod !== 'razorpay' || order.paymentStatus !== 'paid' || typeof order.razorpayPaymentId !== 'string' || !order.razorpayPaymentId) return false;
  const old = inFlight(order).some((r) => now - ms(r.updatedAt || r.createdAt) >= c.refundMinAgeMs);
  if (!old) return false;
  const last = ms(order.reconcileCheckedAt);
  return !(last === last) || now - last >= c.recheckMs;
}
// MongoDB filters for the same two rules (the JS predicates above are applied again to every row that comes back).
function stuckPaymentFilter(now, o = {}) {
  const c = { ...DEFAULTS, ...o }, recheckBefore = new Date(now - c.recheckMs);
  return {
    paymentMethod: 'razorpay', paymentStatus: { $in: PAYMENT_STATES }, razorpayOrderId: { $type: 'string' },
    createdAt: { $lte: new Date(now - c.minAgeMs), $gte: new Date(now - c.maxAgeMs) },
    $or: [{ reconcileCheckedAt: null }, { reconcileCheckedAt: { $lte: recheckBefore } }], // null also matches a missing field
  };
}
function stuckRefundFilter(now, o = {}) {
  const c = { ...DEFAULTS, ...o }, recheckBefore = new Date(now - c.recheckMs);
  return {
    paymentMethod: 'razorpay', paymentStatus: 'paid', razorpayPaymentId: { $type: 'string' },
    refunds: { $elemMatch: { status: { $in: [...IN_FLIGHT] }, updatedAt: { $lte: new Date(now - c.refundMinAgeMs) } } },
    $or: [{ reconcileCheckedAt: null }, { reconcileCheckedAt: { $lte: recheckBefore } }],
  };
}

// ---------- validating what Razorpay answers (never trusted blindly) ----------
// -> normalised payment or null. A fully refunded payment reports status "refunded" with captured=true: it WAS captured, so it is treated as captured here
// and its refunds are then synced separately.
function parseGatewayPayment(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !PAYMENT_ID.test(p.id) || typeof p.order_id !== 'string' || !ORDER_ID.test(p.order_id) || !int(p.amount) || typeof p.currency !== 'string' || typeof p.status !== 'string') return null;
  const status = p.status === 'refunded' && p.captured === true ? 'captured' : p.status;
  return {
    id: p.id, orderId: p.order_id, amount: p.amount, currency: p.currency, status,
    amountRefunded: int(p.amount_refunded) && p.amount_refunded > 0 ? p.amount_refunded : 0,
    createdAt: int(p.created_at) ? p.created_at : null,
    error: typeof p.error_description === 'string' ? p.error_description.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) : '',
  };
}
function parseGatewayRefund(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !REFUND_ID.test(r.id) || typeof r.payment_id !== 'string' || !PAYMENT_ID.test(r.payment_id) || !int(r.amount) || r.amount <= 0) return null;
  if (!['pending', 'processed', 'failed'].includes(r.status)) return null;
  return { id: r.id, paymentId: r.payment_id, amount: r.amount, status: r.status, createdAt: int(r.created_at) ? r.created_at : null };
}
const byAge = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1);

// ---------- what to do ----------
// -> { actions: [{ kind: 'captured' | 'failed', pay }], issues: [{ code, ref, detail }] }. Pure: says what Razorpay shows, never writes anything.
function planPayment(order, payments) {
  const plan = { actions: [], issues: [] };
  const mine = [];
  for (const p of payments) { if (p.orderId === order.razorpayOrderId) mine.push(p); else plan.issues.push({ code: 'foreign_payment', ref: p.id, detail: `payment ${p.id} belongs to ${p.orderId}` }); }
  const captured = mine.filter((p) => p.status === 'captured').sort(byAge);
  if (captured.length) {
    captured.forEach((pay) => plan.actions.push({ kind: 'captured', pay })); // the earliest wins; any later one is refused by decideCaptured and reported
    if (captured.length > 1) plan.issues.push({ code: 'multiple_captured_payments', ref: captured.map((p) => p.id).join(','), detail: `${captured.length} captured payments: ${captured.map((p) => p.id).join(', ')}` });
    return plan;
  }
  const authorized = mine.filter((p) => p.status === 'authorized');
  if (authorized.length) { plan.issues.push({ code: 'payment_authorized_not_captured', ref: authorized.map((p) => p.id).join(','), detail: `authorized but not captured: ${authorized.map((p) => p.id).join(', ')}` }); return plan; }
  const attemptInProgress = mine.some((p) => p.status === 'created');
  const failed = mine.filter((p) => p.status === 'failed').sort(byAge);
  if (failed.length && !attemptInProgress && order.paymentStatus === 'pending') plan.actions.push({ kind: 'failed', pay: failed[failed.length - 1] }); // the latest failed attempt; a later success always wins (decideCaptured)
  return plan;
}

// gatewayRefunds: parsed refunds of ONE payment. Local ledger entries are never invented or deleted here; unknown ones are reported.
function planRefunds(order, gatewayRefunds, now, o = {}) {
  const c = { ...DEFAULTS, ...o }, plan = { actions: [], issues: [] };
  const local = (order.refunds || []).map(plainRefund);
  const knownIds = new Set(local.map((r) => r.refundId).filter(Boolean));
  const list = [...gatewayRefunds].sort(byAge);
  for (const g of list) {
    if (g.paymentId !== order.razorpayPaymentId) { plan.issues.push({ code: 'refund_payment_mismatch', ref: g.id, detail: `refund ${g.id} names payment ${g.paymentId}` }); continue; }
    plan.actions.push({ kind: 'refund', rf: { id: g.id, paymentId: g.paymentId, amount: g.amount, status: ledgerStatusOf(g.status) } });
  }
  const gwIds = new Set(list.map((g) => g.id));
  const free = list.filter((g) => !knownIds.has(g.id)); // gateway refunds not yet in the ledger: candidates for adopting an unconfirmed dashboard entry
  for (const r of local) {
    if (!IN_FLIGHT.has(r.status)) continue;
    if (r.refundId) { if (!gwIds.has(r.refundId)) plan.issues.push({ code: 'refund_missing_at_gateway', ref: r.refundId, detail: `refund ${r.refundId} (₹${(r.amountPaise / 100).toFixed(2)}) is in progress here but Razorpay does not list it` }); continue; }
    const adopted = free.findIndex((g) => g.amount === r.amountPaise);
    if (adopted !== -1) { free.splice(adopted, 1); continue; }
    if (now - ms(r.updatedAt || r.createdAt) >= c.refundUnconfirmedMs) plan.issues.push({ code: 'refund_unconfirmed_at_gateway', ref: r.idempotencyKey || 'entry', detail: `a dashboard refund of ₹${(r.amountPaise / 100).toFixed(2)} was never confirmed by Razorpay` });
  }
  return plan;
}

// ---------- safety net ----------
// Whatever a decision says, reconciliation must never move an order backwards. -> reason string, or null when the change is fine.
const RANK = { unpaid: 0, pending: 1, failed: 1, paid: 2, refunded: 3 };
const SETTLED = new Set(['processed', 'failed']);
function downgradeProblem(order, set) {
  if (!set || typeof set !== 'object') return null;
  if (set.paymentStatus !== undefined) {
    const before = RANK[order.paymentStatus], after = RANK[set.paymentStatus];
    if (after === undefined) return 'unknown_payment_status';
    if (before !== undefined && after < before) return 'would_downgrade';
  }
  if (['paid', 'refunded'].includes(order.paymentStatus) && set.razorpayPaymentId && order.razorpayPaymentId && set.razorpayPaymentId !== order.razorpayPaymentId) return 'would_replace_payment';
  if (set.refundedPaise !== undefined && set.refundedPaise < (order.refundedPaise || 0)) return 'would_downgrade';
  if (Array.isArray(set.refunds)) {
    const after = new Map(set.refunds.map(plainRefund).filter((r) => r.refundId).map((r) => [r.refundId, r]));
    for (const b of (order.refunds || []).map(plainRefund)) {
      if (!b.refundId || !SETTLED.has(b.status)) continue;
      const a = after.get(b.refundId); // a refund that already reached processed/failed may not change status, amount, or disappear
      if (!a || a.status !== b.status || a.amountPaise !== b.amountPaise) return 'would_downgrade';
    }
  }
  return null;
}
// Wraps a decision function so an unsafe "apply" becomes an "ignore" (which is then logged for review).
const safeDecide = (decide) => (order) => {
  const d = decide(order);
  if (d && d.action === 'apply') { const problem = downgradeProblem(order, d.set); if (problem) return { action: 'ignore', reason: problem }; }
  return d;
};

// Fixed texts (no customer data) shown to the owner and written to the log.
const ISSUE_TEXT = {
  amount_mismatch: 'Razorpay shows a payment for a different amount than this order. Nothing was changed. Check it in your Razorpay dashboard.',
  second_payment_for_paid_order: 'This order was paid more than once. Money may need to be refunded for the extra payment in your Razorpay dashboard.',
  multiple_captured_payments: 'More than one payment was captured for this order. The first one was kept; check Razorpay for the others.',
  payment_authorized_not_captured: 'A payment was authorized but not captured, so the money has not been collected. Capture it in Razorpay or let it expire.',
  order_mismatch: 'Razorpay returned a payment that does not belong to this order. Nothing was changed.',
  foreign_payment: 'Razorpay returned a payment that does not belong to this order. Nothing was changed.',
  not_online_order: 'This is not an online order, so nothing was changed.',
  payment_mismatch: 'A refund refers to a different payment than this order. Nothing was changed.',
  refund_payment_mismatch: 'A refund refers to a different payment than this order. Nothing was changed.',
  refund_exceeds_total: 'A refund is larger than the order total. Nothing was changed. Check it in your Razorpay dashboard.',
  refunds_exceed_total: 'The refunds add up to more than the order total. Nothing was changed. Check it in your Razorpay dashboard.',
  refund_amount_changed: 'Razorpay reports a different amount for a refund we already track. Nothing was changed.',
  refund_missing_at_gateway: 'A refund that is in progress here is not listed by Razorpay. Check your Razorpay dashboard before refunding again.',
  refund_unconfirmed_at_gateway: 'A refund you started was never confirmed by Razorpay. Use "Check / retry" on the payment, or check your Razorpay dashboard.',
  gateway_order_not_found: 'Razorpay does not know the order saved for this payment (wrong test/live keys?). Nothing was changed.',
  gateway_bad_response: 'Razorpay sent an answer we could not read. Nothing was changed.',
  would_downgrade: 'A change that would have moved this order backwards was blocked.',
  would_replace_payment: 'A change that would have replaced the recorded payment was blocked.',
  unknown_payment_status: 'An unexpected payment status was blocked.',
  unknown: 'The data at Razorpay and here do not agree. Nothing was changed.',
};
// Only issues that the SAME pass can observe again are closed automatically when they stop appearing. The rest need a human to dismiss them.
const AUTO_RESOLVE = {
  payment: ['gateway_order_not_found', 'gateway_bad_response', 'payment_authorized_not_captured', 'foreign_payment'],
  refund: ['refund_missing_at_gateway', 'refund_unconfirmed_at_gateway', 'refund_payment_mismatch', 'gateway_bad_response'],
};

module.exports = {
  DEFAULTS, PAYMENT_STATES, isStuckPayment, isStuckRefund, stuckPaymentFilter, stuckRefundFilter,
  parseGatewayPayment, parseGatewayRefund, planPayment, planRefunds, downgradeProblem, safeDecide, ISSUE_TEXT, AUTO_RESOLVE,
};
