'use strict';
// Module 6 step 3: pure webhook logic (signature, parsing, decisions). No database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/utils/razorpayWebhook');

const SECRET = 'whsec_unit_test_value', ORDER = 'order_Abc123XYZ789', PAY = 'pay_Abc123XYZ789', RF = 'rfnd_Abc123XYZ789';
const body = (o) => Buffer.from(JSON.stringify(o));
const payEvt = (event, extra = {}) => ({ entity: 'event', event, payload: { payment: { entity: { id: PAY, order_id: ORDER, amount: 49950, currency: 'INR', status: event === 'payment.failed' ? 'failed' : 'captured', created_at: 1760000000, error_description: 'Card declined', ...extra } } } });
const rfEvt = (event, extra = {}) => ({ entity: 'event', event, payload: { refund: { entity: { id: RF, payment_id: PAY, amount: 49950, status: 'processed', ...extra } } } });
const order = (o = {}) => ({ paymentMethod: 'razorpay', paymentStatus: 'pending', status: 'pending', totalPaise: 49950, razorpayOrderId: ORDER, razorpayPaymentId: null, refunds: [], refundedPaise: 0, ...o });

// ---------- signature ----------
test('signature: genuine HMAC of the raw body is accepted (upper/lower-case hex)', () => {
  const raw = body(payEvt('payment.captured')), sig = W.webhookSignature(raw, SECRET);
  assert.equal(W.verifyWebhookSignature(raw, sig, SECRET), true);
  assert.equal(W.verifyWebhookSignature(raw, sig.toUpperCase(), SECRET), true);
});
test('signature: forged, tampered, malformed or missing signatures are all rejected', () => {
  const raw = body(payEvt('payment.captured')), sig = W.webhookSignature(raw, SECRET);
  assert.equal(W.verifyWebhookSignature(Buffer.from(raw.toString().replace('49950', '1')), sig, SECRET), false, 'body changed after signing');
  assert.equal(W.verifyWebhookSignature(raw, W.webhookSignature(raw, 'another_secret'), SECRET), false, 'signed with another secret');
  assert.equal(W.verifyWebhookSignature(raw, sig, 'another_secret'), false);
  for (const bad of [undefined, null, '', 'abc', 'z'.repeat(64), sig.slice(1), sig + '0', ['x'], { a: 1 }, 123]) assert.equal(W.verifyWebhookSignature(raw, bad, SECRET), false, String(bad));
  assert.equal(W.verifyWebhookSignature(raw, sig, ''), false, 'no secret configured never verifies');
  assert.equal(W.verifyWebhookSignature(raw, sig, undefined), false);
  assert.equal(W.verifyWebhookSignature(Buffer.alloc(0), W.webhookSignature(Buffer.alloc(0), SECRET), SECRET), false, 'empty body');
  assert.equal(W.verifyWebhookSignature(raw.toString(), sig, SECRET), false, 'must be the raw Buffer, not a parsed or re-serialised body');
});
test('signature: re-serialising the JSON would break it (why the route reads the raw body)', () => {
  const pretty = Buffer.from(JSON.stringify(payEvt('payment.captured'), null, 2)), sig = W.webhookSignature(pretty, SECRET);
  assert.equal(W.verifyWebhookSignature(pretty, sig, SECRET), true);
  assert.equal(W.verifyWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(pretty))), sig, SECRET), false);
});
test('eventKeyFor: uses the Razorpay event id header, else a stable hash of the body', () => {
  const raw = body(payEvt('payment.captured'));
  assert.equal(W.eventKeyFor('evt_Abc12345-x', raw), 'evt_Abc12345-x');
  const h = W.eventKeyFor(undefined, raw); assert.match(h, /^body_[a-f0-9]{64}$/); assert.equal(W.eventKeyFor('bad id!', raw), h); assert.equal(W.eventKeyFor(['a'], raw), h);
  assert.notEqual(h, W.eventKeyFor(undefined, body(payEvt('payment.failed'))));
});

// ---------- parsing ----------
test('parseWebhook: the five supported events parse to the fields the decisions need', () => {
  const c = W.parseWebhook(body(payEvt('payment.captured'))); assert.equal(c.supported, true);
  assert.deepEqual(c.payment, { id: PAY, orderId: ORDER, amount: 49950, currency: 'INR', status: 'captured', createdAt: 1760000000, error: 'Card declined' });
  assert.equal(W.parseWebhook(body(payEvt('payment.failed'))).payment.status, 'failed');
  for (const [ev, st] of [['refund.created', 'created'], ['refund.processed', 'processed'], ['refund.failed', 'failed']]) assert.deepEqual(W.parseWebhook(body(rfEvt(ev))).refund, { id: RF, paymentId: PAY, amount: 49950, status: st }, 'status comes from the event name');
});
test('parseWebhook: unsupported events are recognised and not an error; garbage is a problem', () => {
  assert.deepEqual(W.parseWebhook(body({ event: 'payment.authorized', payload: {} })), { event: 'payment.authorized', supported: false });
  for (const bad of ['not json', '[]', 'null', '{}', '{"event":5}', JSON.stringify({ event: 'x'.repeat(100) })]) assert.ok(W.parseWebhook(Buffer.from(bad)).problem, bad);
});
test('parseWebhook: malformed or hostile entities are refused', () => {
  const bad = [
    payEvt('payment.captured', { id: 'nope' }), payEvt('payment.captured', { order_id: { $ne: 1 } }), payEvt('payment.captured', { amount: '49950' }), payEvt('payment.captured', { amount: 1.5 }), payEvt('payment.captured', { currency: 5 }),
    { event: 'payment.captured', payload: {} }, { event: 'payment.captured' },
    rfEvt('refund.processed', { id: 'x' }), rfEvt('refund.processed', { payment_id: ['pay_x'] }), rfEvt('refund.processed', { amount: 0 }), rfEvt('refund.processed', { amount: -5 }), { event: 'refund.created', payload: { payment: {} } },
  ];
  for (const b of bad) assert.ok(W.parseWebhook(body(b)).problem, JSON.stringify(b).slice(0, 90));
  assert.equal(W.parseWebhook(body(payEvt('payment.failed', { error_description: 'a\nb\u0000' + 'x'.repeat(500) }))).payment.error.length, 160);
});

// ---------- payment.captured ----------
test('captured: marks a pending or failed order paid and records payment id and time', () => {
  for (const st of ['pending', 'failed']) {
    const d = W.decideCaptured(order({ paymentStatus: st }), W.parseWebhook(body(payEvt('payment.captured'))).payment);
    assert.equal(d.action, 'apply'); assert.equal(d.set.paymentStatus, 'paid'); assert.equal(d.set.razorpayPaymentId, PAY); assert.equal(d.set.paymentError, ''); assert.ok(d.set.paidAt instanceof Date); assert.equal(d.set.paidAt.getTime(), 1760000000 * 1000);
  }
});
test('captured: anomalies never mark anything paid (amount, currency, order id, method, status)', () => {
  const pay = (x) => W.parseWebhook(body(payEvt('payment.captured', x))).payment;
  assert.equal(W.decideCaptured(order(), pay({ amount: 100 })).reason, 'amount_mismatch');
  assert.equal(W.decideCaptured(order(), pay({ currency: 'USD' })).reason, 'amount_mismatch');
  assert.equal(W.decideCaptured(order({ razorpayOrderId: 'order_Different999' }), pay()).reason, 'order_mismatch');
  assert.equal(W.decideCaptured(order({ razorpayOrderId: null }), pay()).reason, 'order_mismatch');
  assert.equal(W.decideCaptured(order({ paymentMethod: 'cod', paymentStatus: 'unpaid' }), pay()).reason, 'not_online_order');
  assert.equal(W.decideCaptured(order(), pay({ status: 'authorized' })).reason, 'payment_not_captured');
  for (const r of ['amount_mismatch', 'order_mismatch', 'not_online_order', 'payment_not_captured']) assert.ok(r);
  assert.equal(W.decideCaptured(order(), pay({ amount: 100 })).action, 'ignore');
});
test('captured: replays are no-ops; a different payment on a paid order is flagged, not applied; a refunded order stays refunded', () => {
  const pay = W.parseWebhook(body(payEvt('payment.captured'))).payment;
  assert.deepEqual(W.decideCaptured(order({ paymentStatus: 'paid', razorpayPaymentId: PAY }), pay), { action: 'noop', reason: 'already_paid' });
  assert.deepEqual(W.decideCaptured(order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_OtherPayment1' }), pay), { action: 'ignore', reason: 'second_payment_for_paid_order' });
  assert.equal(W.decideCaptured(order({ paymentStatus: 'refunded', razorpayPaymentId: PAY }), pay).action, 'noop');
});
test('captured: a cancelled order that received money becomes paid (so the owner can see it needs a refund)', () => {
  const d = W.decideCaptured(order({ status: 'cancelled' }), W.parseWebhook(body(payEvt('payment.captured'))).payment);
  assert.equal(d.action, 'apply'); assert.equal(d.reason, 'paid_on_cancelled_order'); assert.equal(d.set.paymentStatus, 'paid');
});

// ---------- payment.failed ----------
test('failed: only a pending order becomes failed, and the gateway text is kept', () => {
  const pay = W.parseWebhook(body(payEvt('payment.failed'))).payment;
  const d = W.decideFailed(order(), pay); assert.equal(d.action, 'apply'); assert.deepEqual(d.set, { paymentStatus: 'failed', paymentError: 'Card declined' });
  assert.equal(W.decideFailed(order(), { ...pay, error: '' }).set.paymentError, 'The payment could not be completed.');
});
test('failed: never downgrades paid or refunded (a late failure of an earlier attempt must not undo a later success)', () => {
  const pay = W.parseWebhook(body(payEvt('payment.failed'))).payment;
  for (const st of ['paid', 'refunded', 'failed']) assert.equal(W.decideFailed(order({ paymentStatus: st }), pay).action, 'noop', st);
  assert.equal(W.decideFailed(order({ razorpayOrderId: 'order_Different999' }), pay).reason, 'order_mismatch');
  assert.equal(W.decideFailed(order({ paymentMethod: 'cod', paymentStatus: 'unpaid' }), pay).reason, 'not_online_order');
});

// ---------- refunds ----------
const rf = (ev, x) => W.parseWebhook(body(rfEvt(ev, x))).refund;
test('refund: created is recorded without changing the payment status; processed (full) makes the order refunded', () => {
  const o = order({ paymentStatus: 'paid', razorpayPaymentId: PAY });
  const c = W.decideRefund(o, rf('refund.created', { status: 'created' })); assert.equal(c.action, 'apply'); assert.equal(c.set.refundedPaise, 0); assert.equal(c.set.paymentStatus, undefined); assert.equal(c.set.refunds[0].status, 'created');
  const p = W.decideRefund({ ...o, refunds: c.set.refunds }, rf('refund.processed')); assert.equal(p.action, 'apply'); assert.equal(p.set.refundedPaise, 49950); assert.equal(p.set.paymentStatus, 'refunded'); assert.equal(p.reason, 'fully_refunded'); assert.equal(p.set.refunds.length, 1);
});
test('refund: a partial refund keeps the order paid; a second one that completes the total makes it refunded', () => {
  const o = order({ paymentStatus: 'paid', razorpayPaymentId: PAY });
  const a = W.decideRefund(o, rf('refund.processed', { amount: 10000 })); assert.equal(a.set.refundedPaise, 10000); assert.equal(a.set.paymentStatus, undefined); assert.equal(a.reason, 'partially_refunded');
  const b = W.decideRefund({ ...o, refunds: a.set.refunds, refundedPaise: 10000 }, W.parseWebhook(body(rfEvt('refund.processed', { id: 'rfnd_SecondRefund1', amount: 39950 }))).refund);
  assert.equal(b.set.refundedPaise, 49950); assert.equal(b.set.paymentStatus, 'refunded'); assert.equal(b.set.refunds.length, 2);
});
test('refund: failed refunds never count; terminal states are final; replays and out-of-order delivery are no-ops', () => {
  const o = order({ paymentStatus: 'paid', razorpayPaymentId: PAY });
  const f = W.decideRefund(o, rf('refund.failed', { status: 'failed' })); assert.equal(f.set.refundedPaise, 0); assert.equal(f.set.paymentStatus, undefined);
  assert.equal(W.decideRefund({ ...o, refunds: f.set.refunds }, rf('refund.processed')).reason, 'refund_already_failed', 'failed then processed: first terminal wins');
  const p = W.decideRefund(o, rf('refund.processed')).set;
  const withP = { ...o, refunds: p.refunds, refundedPaise: p.refundedPaise, paymentStatus: 'refunded' };
  assert.equal(W.decideRefund(withP, rf('refund.processed')).action, 'noop', 'replay');
  assert.equal(W.decideRefund(withP, rf('refund.created', { status: 'created' })).action, 'noop', 'created arriving after processed');
  assert.equal(W.decideRefund(withP, rf('refund.failed', { status: 'failed' })).action, 'noop', 'processed then failed: processed stays');
});
test('refund: payment mismatch, amount above the order total, changed amount and over-refunding are ignored', () => {
  const o = order({ paymentStatus: 'paid', razorpayPaymentId: PAY });
  assert.equal(W.decideRefund({ ...o, razorpayPaymentId: 'pay_OtherPayment1' }, rf('refund.processed')).reason, 'payment_mismatch');
  assert.equal(W.decideRefund(o, rf('refund.processed', { amount: 49951 })).reason, 'refund_exceeds_total');
  const created = W.decideRefund(o, rf('refund.created', { status: 'created' })).set.refunds;
  assert.equal(W.decideRefund({ ...o, refunds: created }, rf('refund.processed', { amount: 100 })).reason, 'refund_amount_changed');
  const full = W.decideRefund(o, rf('refund.processed')).set.refunds;
  assert.equal(W.decideRefund({ ...o, refunds: full }, W.parseWebhook(body(rfEvt('refund.processed', { id: 'rfnd_SecondRefund1', amount: 5000 }))).refund).reason, 'refunds_exceed_total');
  assert.equal(W.decideRefund(order({ paymentMethod: 'cod', paymentStatus: 'unpaid' }), rf('refund.processed')).reason, 'not_online_order');
});
test('refund: arriving before the capture was recorded still stores the payment id; the order is never set to refunded without a processed full refund', () => {
  const d = W.decideRefund(order(), rf('refund.processed', { amount: 100 })); assert.equal(d.set.razorpayPaymentId, PAY); assert.equal(d.set.paymentStatus, undefined);
});
