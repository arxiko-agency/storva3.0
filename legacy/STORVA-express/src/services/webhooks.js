'use strict';
// Razorpay webhook processing (Module 6 step 3). Flow: verify signature on the raw body -> claim the event id (idempotency) ->
// apply the pure decision with a compare-and-set update -> record the outcome. Returns { status, body } for the route to send.
const Order = require('../models/Order');
const WebhookEvent = require('../models/WebhookEvent');
const { env } = require('../config/env');
const W = require('../utils/razorpayWebhook');

const LOCK_MS = 2 * 60 * 1000;   // a "processing" claim older than this is assumed to belong to a crashed worker and may be taken over
const MAX_CAS_TRIES = 6;
class RetryLater extends Error {}

// Optional hook run after a FULL refund was written (registered by app.js: returns stock for not-yet-shipped orders). Kept injectable so this file stays free of the DB layer in unit tests.
let postApply = null;
const setPostApplyHook = (fn) => { postApply = typeof fn === 'function' ? fn : null; };

const reply = (status, code, extra = {}) => ({ status, body: status < 300 ? { ok: true, ...extra } : { error: { code, message: extra.message || code } } });
const findByGatewayId = (field, value) => Order.findOne({ [field]: value }).setOptions({ skipTenant: true }); // global lookup: the store is not known yet; every write below is store-scoped

// Idempotency claim. -> { claimed: true } | { claimed: false, current }
async function claim(eventKey, event) {
  const now = new Date();
  try { await WebhookEvent.create({ eventKey, event, status: 'processing', attempts: 1, lockedAt: now }); return { claimed: true }; }
  catch (e) { if (!(e && e.code === 11000)) throw e; }
  // The event was seen before. Retake it only if the earlier attempt failed or its worker died; otherwise it is a duplicate or still running.
  const retaken = await WebhookEvent.findOneAndUpdate(
    { eventKey, $or: [{ status: 'failed' }, { status: 'processing', lockedAt: { $lt: new Date(now - LOCK_MS) } }] },
    { $set: { status: 'processing', lockedAt: now, error: '' }, $inc: { attempts: 1 } }, { new: true });
  if (retaken) return { claimed: true };
  return { claimed: false, current: await WebhookEvent.findOne({ eventKey }) };
}

// Read order -> decide -> write only if nobody changed it meanwhile (paymentRev). Retries on conflict; never overwrites a newer state.
async function applyToOrder(lookup, decide) {
  for (let i = 0; i < MAX_CAS_TRIES; i++) {
    const order = await lookup();
    if (!order) return { outcome: 'ignored:order_not_found', order: null };
    const d = decide(order);
    if (d.action !== 'apply') return { outcome: (d.action === 'noop' ? 'noop:' : 'ignored:') + d.reason, order };
    const rev = order.paymentRev || 0;
    const upd = await Order.updateOne(
      { _id: order._id, store: order.store, ...(rev === 0 ? { $or: [{ paymentRev: 0 }, { paymentRev: { $exists: false } }] } : { paymentRev: rev }) },
      { $set: d.set, $inc: { paymentRev: 1 } });
    if (upd.matchedCount) {
      // A FULL refund of a not-yet-shipped order cancels it and returns its stock once. Failure here must never fail the payment write; the abandoned-order sweep repairs it.
      if (postApply && d.set && d.set.paymentStatus === 'refunded') await Promise.resolve().then(() => postApply(order.store, order._id)).catch((e) => console.error('[settle] stock return after refund failed, the sweep will retry:', e && e.message));
      return { outcome: 'applied:' + d.reason, order };
    }
  }
  throw new Error('Could not update the order after several attempts (concurrent changes).');
}

async function dispatch(parsed) {
  if (!parsed.supported) return { outcome: 'ignored:unsupported_event' };
  if (parsed.subscription) return require('./billing').handleSubscriptionEvent(parsed); // subscription.* (auto-renew plans)
  if (parsed.event === 'payment.captured' || parsed.event === 'payment.failed') {
    const r = await applyToOrder(() => findByGatewayId('razorpayOrderId', parsed.payment.orderId), (o) => (parsed.event === 'payment.captured' ? W.decideCaptured(o, parsed.payment) : W.decideFailed(o, parsed.payment)));
    if (r.outcome === 'ignored:order_not_found') { // Module 8: not a storefront order; it may be a STORVA plan payment
      const billing = await require('./billing').handleGatewayEvent(parsed.event, parsed.payment);
      if (billing) return { outcome: billing, order: null };
    }
    if (r.outcome.startsWith('applied:') && r.order) require('./events').emit(parsed.event === 'payment.captured' ? 'order.paid' : 'order.payment_failed', { storeId: r.order.store, orderId: r.order._id });
    return r;
  }
  // refund.*: a refund names only its payment id. If we do not know that payment yet (the capture has not been recorded), ask Razorpay to deliver it again later.
  const r = await applyToOrder(() => findByGatewayId('razorpayPaymentId', parsed.refund.paymentId), (o) => W.decideRefund(o, parsed.refund));
  if (r.outcome === 'ignored:order_not_found') throw new RetryLater('refund for a payment we have not recorded yet');
  if (r.outcome.startsWith('applied:') && r.order && parsed.refund.status === 'processed') require('./events').emit('order.refunded', { storeId: r.order.store, orderId: r.order._id, refundId: parsed.refund.id, amountPaise: parsed.refund.amount, full: (r.order.refundedPaise || 0) + (parsed.refund.amount || 0) >= r.order.totalPaise });
  if (r.outcome.startsWith('applied:') && r.order && parsed.refund.status !== 'processed') { // created / failed: same buyer + owner messages as every other refund path (deduplicated by refund id)
    const after = await Order.findOne({ _id: r.order._id, store: r.order.store }).catch(() => null);
    require('./refundEvents').announce(r.order, after, { final: Boolean(after && after.autoRefundExhausted) });
  }
  return r;
}

// opts: { raw: Buffer, signature, eventId, secret? }  (secret defaults to RAZORPAY_WEBHOOK_SECRET; injectable for tests)
async function handle({ raw, signature, eventId, secret = env.razorpay.webhookSecret }) {
  if (!secret) return reply(503, 'webhook_not_configured', { message: 'Webhook secret is not configured.' });
  if (!W.verifyWebhookSignature(raw, signature, secret)) { console.warn('[webhook] rejected: invalid or missing signature'); return reply(400, 'invalid_signature', { message: 'Invalid signature.' }); }
  const parsed = W.parseWebhook(raw);
  if (parsed.problem) { console.warn('[webhook] rejected: signed but malformed (' + parsed.problem + ')'); return reply(400, 'invalid_payload', { message: parsed.problem }); }

  const eventKey = W.eventKeyFor(eventId, raw);
  const c = await claim(eventKey, parsed.event);
  if (!c.claimed) {
    if (c.current && c.current.status === 'processed') return reply(200, null, { duplicate: true, outcome: c.current.outcome });
    return reply(409, 'in_progress', { message: 'This event is being processed. Please retry shortly.' }); // Razorpay retries any non-2xx
  }
  try {
    const r = await dispatch(parsed);
    const ord = r.order;
    await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'processed', outcome: r.outcome, lockedAt: null, storeId: ord ? ord.store : null, orderNumber: ord ? ord.orderNumber : null } });
    if (r.outcome.startsWith('ignored:') && r.outcome !== 'ignored:unsupported_event') console.warn(`[webhook] ${parsed.event} ${eventKey} did not change any order: ${r.outcome}${ord ? ` (order #${ord.orderNumber})` : ''}`);
    return reply(200, null, { duplicate: false, outcome: r.outcome });
  } catch (e) {
    const retry = e instanceof RetryLater;
    await WebhookEvent.updateOne({ eventKey }, { $set: { status: 'failed', error: String(e.message).slice(0, 200), lockedAt: null } }).catch(() => {});
    if (!retry) console.error('[webhook] processing failed for', eventKey, e);
    return reply(retry ? 409 : 500, retry ? 'retry_later' : 'processing_failed', { message: retry ? 'Not ready yet. Please retry later.' : 'Processing failed. Please retry.' });
  }
}

module.exports = { handle, claim, applyToOrder, setPostApplyHook, LOCK_MS };
