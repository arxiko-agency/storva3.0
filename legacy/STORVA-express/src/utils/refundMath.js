'use strict';
// Pure refund rules (no database, no network) so every money rule is unit-tested.
// All amounts are INTEGER PAISE. Rupee input is parsed from text, never through floating point.
const crypto = require('crypto');

const IN_FLIGHT = new Set(['pending', 'created']); // pending = we are about to call / are waiting on Razorpay; created = Razorpay accepted it, not processed yet
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const REASON_MAX = 200;

// "499.50" | 499.5 | "500" -> 49950 | null. At most 2 decimals, positive, safe integer. Rejects NaN, exponent forms, negatives, hex, spaces.
function parseRupeesToPaise(v) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; v = String(v); }
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

const sum = (refunds, pred) => (refunds || []).filter(pred).reduce((s, r) => s + (r.amountPaise || 0), 0);

// -> { totalPaise, processedPaise, inFlightPaise, refundablePaise, hasInFlight }
// Failed refunds count for nothing. In-flight refunds are RESERVED so two clicks can never promise the same money twice.
function refundable(order) {
  const processedPaise = sum(order.refunds, (r) => r.status === 'processed');
  const inFlightPaise = sum(order.refunds, (r) => IN_FLIGHT.has(r.status));
  const refundablePaise = Math.max(0, order.totalPaise - processedPaise - inFlightPaise);
  return { totalPaise: order.totalPaise, processedPaise, inFlightPaise, refundablePaise, hasInFlight: (order.refunds || []).some((r) => IN_FLIGHT.has(r.status)) };
}

// Can this order be refunded at all? -> { ok: true } | { ok: false, code, message, status }
function refundEligibility(order) {
  if (order.paymentMethod !== 'razorpay') return { ok: false, status: 400, code: 'not_online_order', message: 'Only online (Razorpay) payments can be refunded here. Cash on delivery is returned to the customer by you.' };
  if (!order.razorpayPaymentId) return { ok: false, status: 409, code: 'not_paid', message: 'This order has no captured online payment to refund.' };
  if (order.paymentStatus === 'refunded') return { ok: false, status: 409, code: 'already_refunded', message: 'This payment is already fully refunded.' };
  if (order.paymentStatus !== 'paid') return { ok: false, status: 409, code: 'not_paid', message: 'Only a paid order can be refunded.' };
  return { ok: true };
}

// input = { type: 'full' | 'partial', amount?, reason?, idempotencyKey } -> { value: { amountPaise, full, reason, idempotencyKey } } | { fields }
// `refundablePaise` comes from the SERVER's saved order; the browser never supplies a limit.
function readRefundInput(input, refundablePaise) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fields = {};
  if (typeof b.idempotencyKey !== 'string' || !KEY.test(b.idempotencyKey)) fields.idempotencyKey = 'A request key of 16 to 64 letters, numbers, - or _ is required. Reload the page and try again.';
  let reason = '';
  if (b.reason !== undefined && b.reason !== null && b.reason !== '') {
    if (typeof b.reason !== 'string') fields.reason = 'Reason must be text.';
    else { reason = b.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); if (reason.length > REASON_MAX) fields.reason = `Reason must be at most ${REASON_MAX} characters.`; }
  }
  let amountPaise = null, full = false;
  if (b.type === 'full') {
    if (b.amount !== undefined && b.amount !== null && b.amount !== '') fields.amount = 'Leave the amount empty for a full refund.';
    full = true; amountPaise = refundablePaise;
  } else if (b.type === 'partial') {
    amountPaise = parseRupeesToPaise(b.amount);
    if (amountPaise === null) fields.amount = 'Enter an amount in rupees greater than 0, with at most 2 decimals.';
  } else fields.type = 'Choose a full or partial refund.';
  if (!fields.amount && amountPaise !== null) {
    if (refundablePaise <= 0) fields.amount = 'Nothing is left to refund on this order.';
    else if (amountPaise > refundablePaise) fields.amount = `You can refund at most ₹${(refundablePaise / 100).toFixed(2)} more on this order.`;
  }
  if (Object.keys(fields).length) return { fields };
  // A "partial" refund of the whole remaining amount is still just money going back; "full" is only a convenience for "everything left".
  return { value: { amountPaise, full, reason, idempotencyKey: b.idempotencyKey } };
}

// Razorpay idempotency header for a ledger entry: stable for retries of the SAME request, different for any other request.
const gatewayKeyFor = (storeId, orderId, idempotencyKey) => 'rf_' + crypto.createHash('sha256').update(`${storeId}:${orderId}:${idempotencyKey}`).digest('hex').slice(0, 40);

// Razorpay refund status -> our ledger status.
const ledgerStatusOf = (s) => (s === 'processed' ? 'processed' : s === 'failed' ? 'failed' : 'created');

// Filter fragment for compare-and-set on paymentRev (orders created before step 3 have no paymentRev field).
const revFilter = (order) => { const rev = order.paymentRev || 0; return rev === 0 ? { $or: [{ paymentRev: 0 }, { paymentRev: { $exists: false } }] } : { paymentRev: rev }; };


// ---------- automatic refund of cancelled, paid online orders (pure rules) ----------
// An order that was paid online and then cancelled owes the buyer their money back. The ledger (order.refunds) is the single record: automatic
// entries carry source 'auto' and a deterministic request key, so the SAME attempt can never be created twice, not even by two servers at once.
const AUTO_DEFAULTS = { maxAttempts: 3, retryBackoffMs: 15 * 60 * 1000, verifyAfterMs: 5 * 60 * 1000 };
const autoEntries = (order) => (order.refunds || []).filter((r) => r.source === 'auto');
// "auto-" + order id + "-" + attempt: 16 to 64 safe characters, valid for readRefundInput.
const autoKeyFor = (order, attempt) => `auto-${String(order._id)}-${attempt}`;
const ms = (d) => (d ? new Date(d).getTime() : NaN);

// -> { ok: true } | { ok: false, reason }. Same payment rules as a manual refund, plus: the order must be cancelled.
function autoRefundEligibility(order) {
  if (order.status !== 'cancelled') return { ok: false, reason: 'not_cancelled' };
  const base = refundEligibility(order);
  if (!base.ok) return { ok: false, reason: base.code };
  if (refundable(order).refundablePaise <= 0 && !refundable(order).hasInFlight) return { ok: false, reason: 'nothing_to_refund' };
  return { ok: true };
}

// What should happen to this order's automatic refund right now? Pure: reads the order, never writes.
//   { action: 'none', reason }            not eligible / already settled
//   { action: 'start', key, attempt }     create the next automatic refund (the first one, or a new one after a failed one)
//   { action: 'retry', key }              an entry was reserved but Razorpay never confirmed it: re-send it with the SAME key
//   { action: 'verify', key? }            Razorpay accepted a refund that is not processed yet: ask Razorpay for its real status
//   { action: 'wait', reason }            too soon (backoff / a refund started moments ago)
//   { action: 'exhausted', attempts }     every allowed attempt failed: needs a human
function planAutoRefund(order, now = Date.now(), o = {}) {
  const c = { ...AUTO_DEFAULTS, ...o };
  const el = autoRefundEligibility(order);
  if (!el.ok) return { action: 'none', reason: el.reason };
  const rows = (order.refunds || []).map((r) => (r && typeof r.toObject === 'function' ? r.toObject() : r));
  const live = rows.filter((r) => IN_FLIGHT.has(r.status));
  if (live.length) {
    const e = live[0], age = now - ms(e.updatedAt || e.createdAt);
    if (e.status === 'pending' && !e.refundId) return age >= 30 * 1000 ? { action: 'retry', key: e.idempotencyKey, auto: e.source === 'auto' } : { action: 'wait', reason: 'request_in_flight' };
    return age >= c.verifyAfterMs ? { action: 'verify', key: e.idempotencyKey } : { action: 'wait', reason: 'refund_in_progress' };
  }
  const mine = autoEntries({ refunds: rows }), failed = mine.filter((r) => r.status === 'failed');
  if (order.autoRefundExhausted) return { action: 'none', reason: 'exhausted' };
  if (mine.length >= c.maxAttempts) return { action: 'exhausted', attempts: mine.length };
  if (failed.length) {
    const last = Math.max(...failed.map((r) => ms(r.updatedAt || r.createdAt) || 0));
    if (now - last < c.retryBackoffMs * failed.length) return { action: 'wait', reason: 'backoff' };
  }
  const attempt = mine.length + 1;
  return { action: 'start', key: autoKeyFor(order, attempt), attempt };
}

// What the BUYER may see about a refund (never gateway ids or error text). -> 'none' | 'in_progress' | 'processed' | 'partial' | 'attention'
function buyerRefundState(order) {
  if (order.paymentMethod !== 'razorpay') return 'none';
  const rf = refundable(order);
  if (order.paymentStatus === 'refunded') return 'processed';
  if (rf.hasInFlight) return 'in_progress';
  if (rf.processedPaise > 0) return 'partial';
  // A failed AUTOMATIC attempt is retried, so the buyer still sees "in progress" (matching notifications, which tell the buyer only when no attempt is left).
  // 'attention' = every automatic attempt failed, or a refund started by hand failed (nothing retries that one).
  if (order.status === 'cancelled' && order.paymentStatus === 'paid') return order.autoRefundExhausted || (order.refunds || []).some((r) => r.status === 'failed' && r.source !== 'auto') ? 'attention' : 'in_progress';
  return 'none';
}

module.exports = { AUTO_DEFAULTS, autoKeyFor, autoRefundEligibility, planAutoRefund, buyerRefundState,  IN_FLIGHT, parseRupeesToPaise, refundable, refundEligibility, readRefundInput, gatewayKeyFor, ledgerStatusOf, revFilter, REASON_MAX };
