'use strict';
// Pure Razorpay webhook logic (no database, no network): signature check, payload parsing and the decisions that say how an event may
// change an order. Keeping decisions pure means every rule below is unit-tested without MongoDB.
const crypto = require('crypto');

const SUPPORTED_EVENTS = ['payment.captured', 'payment.failed', 'refund.created', 'refund.processed', 'refund.failed'];
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/, PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/, REFUND_ID = /^rfnd_[A-Za-z0-9]{6,40}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{6,100}$/;
const TERMINAL = new Set(['processed', 'failed']);
const REFUND_STATUS_OF = { 'refund.created': 'created', 'refund.processed': 'processed', 'refund.failed': 'failed' };

// ---------- signature ----------
// Razorpay signs the EXACT raw request body: hex(HMAC_SHA256(rawBody, webhookSecret)) in the X-Razorpay-Signature header.
const webhookSignature = (rawBody, secret) => crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex');
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || !rawBody.length || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const a = Buffer.from(webhookSignature(rawBody, secret), 'hex'), b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The idempotency key: Razorpay's X-Razorpay-Event-Id (the same for every retry of one event). Without it, a hash of the signed body.
const eventKeyFor = (headerValue, rawBody) => (typeof headerValue === 'string' && EVENT_ID.test(headerValue) ? headerValue : 'body_' + crypto.createHash('sha256').update(rawBody).digest('hex'));

// ---------- parsing ----------
const int = (v) => typeof v === 'number' && Number.isSafeInteger(v);
// -> { event, supported, payment?, refund? } or { problem }. Only fields in the exact documented shapes are accepted.
function parseWebhook(rawBody) {
  let j; try { j = JSON.parse(rawBody.toString('utf8')); } catch { return { problem: 'Body is not valid JSON.' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || typeof j.event !== 'string' || j.event.length > 60) return { problem: 'Missing event name.' };
  if (j.event.startsWith('subscription.')) return require('./razorpaySubscription').parseSubscriptionEvent(j); // auto-renew plans
  if (!SUPPORTED_EVENTS.includes(j.event)) return { event: j.event, supported: false };
  const pl = j.payload && typeof j.payload === 'object' ? j.payload : {};
  const pe = pl.payment && pl.payment.entity, re = pl.refund && pl.refund.entity;
  const out = { event: j.event, supported: true };
  if (j.event.startsWith('payment.')) {
    // Payments collected by a Razorpay invoice / subscription are reported through subscription.* events; they carry no order id of ours. Acknowledge instead of rejecting (a 400 would make Razorpay retry for days).
    if (pe && typeof pe === 'object' && !pe.order_id && (pe.invoice_id || pe.subscription_id)) return { event: j.event, supported: false };
    if (!pe || typeof pe !== 'object' || typeof pe.id !== 'string' || !PAYMENT_ID.test(pe.id) || typeof pe.order_id !== 'string' || !ORDER_ID.test(pe.order_id) || !int(pe.amount) || typeof pe.currency !== 'string') return { problem: 'Invalid payment entity.' };
    out.payment = { id: pe.id, orderId: pe.order_id, amount: pe.amount, currency: pe.currency, status: typeof pe.status === 'string' ? pe.status : '', createdAt: int(pe.created_at) ? pe.created_at : null,
      error: typeof pe.error_description === 'string' ? pe.error_description.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160) : '' };
  } else {
    if (!re || typeof re !== 'object' || typeof re.id !== 'string' || !REFUND_ID.test(re.id) || typeof re.payment_id !== 'string' || !PAYMENT_ID.test(re.payment_id) || !int(re.amount) || re.amount <= 0) return { problem: 'Invalid refund entity.' };
    out.refund = { id: re.id, paymentId: re.payment_id, amount: re.amount, status: REFUND_STATUS_OF[j.event] };
  }
  return out;
}

// ---------- decisions ----------
// Each takes a plain order snapshot and returns { action: 'apply' | 'noop' | 'ignore', reason, set? }.
//   apply  = write `set`          noop = already in that state (safe replay / out-of-order)
//   ignore = an anomaly that must NOT change the order (logged and recorded on the event for a human to review)
const noop = (reason) => ({ action: 'noop', reason }), ignore = (reason) => ({ action: 'ignore', reason }), apply = (set, reason) => ({ action: 'apply', set, reason });

function decideCaptured(order, pay) {
  if (order.paymentMethod !== 'razorpay') return ignore('not_online_order');
  if (!order.razorpayOrderId || order.razorpayOrderId !== pay.orderId) return ignore('order_mismatch');
  if (pay.amount !== order.totalPaise || pay.currency !== 'INR') return ignore('amount_mismatch'); // never accept a payment for a different amount
  if (pay.status !== 'captured') return ignore('payment_not_captured');
  if (order.paymentStatus === 'refunded') return noop('already_refunded');
  if (order.paymentStatus === 'paid') return order.razorpayPaymentId === pay.id ? noop('already_paid') : ignore('second_payment_for_paid_order'); // a different payment on an already-paid order: money moved twice, a human must refund
  const paidAt = pay.createdAt ? new Date(Math.min(pay.createdAt * 1000, Date.now())) : new Date();
  return apply({ paymentStatus: 'paid', paidAt, razorpayPaymentId: pay.id, paymentError: '' }, order.status === 'cancelled' ? 'paid_on_cancelled_order' : 'paid'); // a cancelled order that got paid is paid: it needs a refund, not a silent "unpaid"
}

function decideFailed(order, pay) {
  if (order.paymentMethod !== 'razorpay') return ignore('not_online_order');
  if (!order.razorpayOrderId || order.razorpayOrderId !== pay.orderId) return ignore('order_mismatch');
  if (order.paymentStatus === 'pending') return apply({ paymentStatus: 'failed', paymentError: pay.error || 'The payment could not be completed.' }, 'marked_failed');
  return noop(order.paymentStatus === 'failed' ? 'already_failed' : 'not_pending'); // never downgrade paid or refunded; a late "failed" for an earlier attempt must not undo a later success
}

// order.refunds: [{ refundId, amountPaise, status }]. Terminal states (processed, failed) are final for a given refund id.
function decideRefund(order, rf) {
  if (order.paymentMethod !== 'razorpay') return ignore('not_online_order');
  if (order.razorpayPaymentId && order.razorpayPaymentId !== rf.paymentId) return ignore('payment_mismatch');
  if (rf.amount > order.totalPaise) return ignore('refund_exceeds_total');
  // Plain copies that KEEP the dashboard fields (reason, idempotencyKey, source, error...) so a webhook never erases what the owner entered.
  const plain = (r) => { const o = typeof r.toObject === 'function' ? r.toObject() : r; return { ...o }; };
  const refunds = (order.refunds || []).map(plain);
  let i = refunds.findIndex((r) => r.refundId === rf.id);
  const now = new Date();
  // A refund the owner started from the dashboard is stored as 'pending' with no gateway id until Razorpay answers. If the webhook arrives first, it
  // adopts that entry (same amount; only one refund may be in flight per order, so the match is unambiguous) instead of creating a duplicate.
  if (i === -1) { const j = refunds.findIndex((r) => !r.refundId && r.status === 'pending' && r.amountPaise === rf.amount); if (j !== -1) { refunds[j] = { ...refunds[j], refundId: rf.id, updatedAt: now }; i = j; } }
  if (i === -1) refunds.push({ refundId: rf.id, amountPaise: rf.amount, status: rf.status, createdAt: now, updatedAt: now });
  if (i !== -1 && refunds[i].status === 'pending' && refunds[i].amountPaise !== rf.amount) return ignore('refund_amount_changed');
  if (i !== -1 && refunds[i].status === 'pending') refunds[i] = { ...refunds[i], status: rf.status, updatedAt: now };
  else if (i !== -1) {
    if (refunds[i].amountPaise !== rf.amount) return ignore('refund_amount_changed');
    if (refunds[i].status === rf.status || TERMINAL.has(refunds[i].status)) return noop('refund_already_' + refunds[i].status); // replay, "created" arriving after "processed", or a conflicting second terminal state
    refunds[i] = { ...refunds[i], status: rf.status, updatedAt: now };
  }
  const refundedPaise = refunds.filter((r) => r.status === 'processed').reduce((s, r) => s + r.amountPaise, 0);
  if (refundedPaise > order.totalPaise) return ignore('refunds_exceed_total');
  const set = { refunds, refundedPaise };
  if (!order.razorpayPaymentId) set.razorpayPaymentId = rf.paymentId;
  if (refundedPaise >= order.totalPaise) set.paymentStatus = 'refunded'; // partial refunds keep the order "paid" and are shown through refundedPaise
  return apply(set, rf.status === 'processed' ? (set.paymentStatus ? 'fully_refunded' : 'partially_refunded') : 'refund_' + rf.status);
}

module.exports = { SUPPORTED_EVENTS, webhookSignature, verifyWebhookSignature, eventKeyFor, parseWebhook, decideCaptured, decideFailed, decideRefund };
