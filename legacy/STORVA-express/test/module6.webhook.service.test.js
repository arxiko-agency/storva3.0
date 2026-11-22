'use strict';
// Module 6 step 3: the REAL services/webhooks.js and utils/razorpayWebhook.js run against IN-MEMORY FAKES of the Order and WebhookEvent models
// (the fakes imitate the Mongo operations the service uses: unique key, $or filters, $set/$inc, snapshots on read). This checks idempotency,
// concurrency and compare-and-set logic WITHOUT MongoDB. It is not a substitute for test/module6.webhook.integration.test.js (real MongoDB).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc12345'; process.env.RAZORPAY_KEY_SECRET = 'k_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_service_test';
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));

// ---- fakes ----
const orders = new Map(), events = new Map(); let seq = 0;
const getPath = (d, k) => d[k];
function matches(d, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => matches(d, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$exists' in v) return (d[k] !== undefined) === v.$exists;
      if ('$lt' in v) return d[k] != null && d[k] < v.$lt;
      if ('$in' in v) return v.$in.includes(d[k]);
    }
    return (v === null ? d[k] == null : getPath(d, k) === v);
  });
}
const applyUpdate = (d, u) => { Object.assign(d, clone(u.$set || {}), Object.fromEntries(Object.entries(u.$set || {}).filter(([, v]) => v instanceof Date))); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; };
const FakeOrder = {
  afterRead: null, // test hook: runs right after a snapshot was handed out, to imitate another writer changing the order before our write
  findOne(f) { const q = { setOptions() { return q; }, then(res, rej) { return (async () => { await tick(); const d = [...orders.values()].find((x) => matches(x, f)); const snap = d ? { ...clone(d), paidAt: d.paidAt } : null; if (d && FakeOrder.afterRead) { const h = FakeOrder.afterRead; FakeOrder.afterRead = null; h(d); } return snap; })().then(res, rej); } }; return q; },
  async updateOne(f, u) { await tick(); if (!f.store) throw new Error('Tenant guard: updateOne without store'); const d = [...orders.values()].find((x) => matches(x, f)); if (!d) return { matchedCount: 0 }; applyUpdate(d, u); return { matchedCount: 1 }; },
};
const FakeEvent = {
  async create(doc) { await tick(); if (events.has(doc.eventKey)) { const e = new Error('dup'); e.code = 11000; throw e; } events.set(doc.eventKey, { ...doc, attempts: doc.attempts || 1, error: '' }); },
  async findOneAndUpdate(f, u) { await tick(); const d = events.get(f.eventKey); if (!d || !matches(d, { $or: f.$or })) return null; applyUpdate(d, u); return { ...d }; },
  async findOne(f) { await tick(); const d = events.get(f.eventKey); return d ? { ...d } : null; },
  async updateOne(f, u) { await tick(); const d = events.get(f.eventKey); if (d) applyUpdate(d, u); return { matchedCount: d ? 1 : 0 }; },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req.endsWith('/models/Order')) return FakeOrder;
  if (req.endsWith('/models/WebhookEvent')) return FakeEvent;
  if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } }
  return origLoad.call(this, req, ...a);
};
// Module 8 added a fallback for unknown orders (a STORVA plan payment?). This suite has no database, so billing is faked here.
const billingPath = require.resolve('../src/services/billing');
require.cache[billingPath] = { id: billingPath, filename: billingPath, loaded: true, exports: { handleGatewayEvent: async () => null } };
const { handle, LOCK_MS } = require('../src/services/webhooks');
const W = require('../src/utils/razorpayWebhook');
Module._load = origLoad;

let n = 0;
function mkOrder(extra = {}) {
  n++; const id = 'o' + (++seq), o = { _id: id, store: 'S1', orderNumber: 1000 + seq, paymentMethod: 'razorpay', paymentStatus: 'pending', status: 'pending', totalPaise: 49950, paymentRev: 0,
    razorpayOrderId: 'order_Test' + String(seq).padStart(6, '0'), razorpayPaymentId: null, refunds: [], refundedPaise: 0, paymentError: '', paidAt: null, ...extra }; orders.set(id, o); return o;
}
const send = (obj, { id = 'evt_' + Math.random().toString(36).slice(2, 12), secret = 'whsec_service_test', sign = true } = {}) => {
  const raw = Buffer.from(JSON.stringify(obj)); return handle({ raw, signature: sign ? W.webhookSignature(raw, secret) : undefined, eventId: id });
};
const pay = (o, event, x = {}, pid = 'pay_Test' + String(seq).padStart(6, '0')) => ({ event, payload: { payment: { entity: { id: pid, order_id: o.razorpayOrderId, amount: o.totalPaise, currency: 'INR', status: event === 'payment.failed' ? 'failed' : 'captured', error_description: 'Declined by bank', ...x } } } });
const rfd = (pid, event, x = {}) => ({ event, payload: { refund: { entity: { id: 'rfnd_Test000001', payment_id: pid, amount: 49950, ...x } } } });

test('forged requests: no/invalid signature or unconfigured secret change nothing and write no ledger row', async () => {
  const o = mkOrder(), before = events.size;
  assert.equal((await send(pay(o, 'payment.captured'), { sign: false })).status, 400);
  assert.equal((await send(pay(o, 'payment.captured'), { secret: 'wrong' })).status, 400);
  const raw = Buffer.from(JSON.stringify(pay(o, 'payment.captured'))), sig = W.webhookSignature(raw, 'whsec_service_test');
  assert.equal((await handle({ raw: Buffer.from(raw.toString().replace('49950', '1')), signature: sig, eventId: 'evt_tamper1' })).status, 400);
  assert.equal((await handle({ raw, signature: sig, eventId: 'evt_nosecret', secret: '' })).status, 503);
  assert.equal(orders.get(o._id).paymentStatus, 'pending'); assert.equal(events.size, before);
});
test('signed but malformed payload is a 400 and is not recorded', async () => {
  const before = events.size; const raw = Buffer.from('{"event":"payment.captured","payload":{}}');
  assert.equal((await handle({ raw, signature: W.webhookSignature(raw, 'whsec_service_test'), eventId: 'evt_malformed1' })).status, 400); assert.equal(events.size, before);
});
test('payment.captured marks paid once; the same event id again is a duplicate and changes nothing', async () => {
  const o = mkOrder(), body = pay(o, 'payment.captured', { created_at: 1760000000 });
  const r1 = await send(body, { id: 'evt_cap_0001' }); assert.equal(r1.status, 200); assert.equal(r1.body.outcome, 'applied:paid');
  const d = orders.get(o._id); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.paymentRev, 1); assert.ok(d.razorpayPaymentId);
  const r2 = await send(body, { id: 'evt_cap_0001' }); assert.equal(r2.status, 200); assert.equal(r2.body.duplicate, true); assert.equal(orders.get(o._id).paymentRev, 1);
  const r3 = await send(body, { id: 'evt_cap_0002' }); assert.equal(r3.body.outcome, 'noop:already_paid'); assert.equal(orders.get(o._id).paymentRev, 1, 'a new event id for the same payment is a harmless no-op');
  assert.equal(events.get('evt_cap_0001').status, 'processed');
});
test('10 simultaneous deliveries of one event apply it exactly once', async () => {
  const o = mkOrder(), body = pay(o, 'payment.captured');
  const rs = await Promise.all(Array.from({ length: 10 }, () => send(body, { id: 'evt_parallel_1' })));
  assert.ok(rs.every((r) => [200, 409].includes(r.status)), 'each is a duplicate (200) or told to retry (409), never an error');
  assert.equal(rs.filter((r) => r.status === 200 && r.body.duplicate === false).length, 1); assert.equal(orders.get(o._id).paymentRev, 1); assert.equal(orders.get(o._id).paymentStatus, 'paid');
});
test('different events racing on one order (capture + refund) end in a consistent state', async () => {
  const o = mkOrder(), pid = 'pay_RaceTest0001';
  await Promise.all([send(pay(o, 'payment.captured', {}, pid)), send(rfd(pid, 'refund.processed'))]);
  await send(rfd(pid, 'refund.processed'), { id: 'evt_retry_after' }); // whichever lost the race is delivered again by Razorpay
  const d = orders.get(o._id); assert.equal(d.razorpayPaymentId, pid); assert.equal(d.refundedPaise, 49950); assert.equal(d.paymentStatus, 'refunded', 'a capture arriving after a full refund must not bring the order back to paid');
});
test('anomalies are acknowledged (200) but never change the order: wrong amount, unknown order, other payment, unsupported event', async () => {
  const o = mkOrder();
  assert.equal((await send(pay(o, 'payment.captured', { amount: 100 }))).body.outcome, 'ignored:amount_mismatch');
  assert.equal((await send(pay({ ...o, razorpayOrderId: 'order_Unknown00001' }, 'payment.captured'))).body.outcome, 'ignored:order_not_found');
  assert.equal((await send({ event: 'payment.authorized', payload: {} })).body.outcome, 'ignored:unsupported_event');
  assert.equal(orders.get(o._id).paymentStatus, 'pending'); assert.equal(orders.get(o._id).paymentRev, 0);
  await send(pay(o, 'payment.captured', {}, 'pay_FirstPayment01'));
  assert.equal((await send(pay(o, 'payment.captured', {}, 'pay_SecondPayment1'))).body.outcome, 'ignored:second_payment_for_paid_order'); assert.equal(orders.get(o._id).razorpayPaymentId, 'pay_FirstPayment01');
});
test('payment.failed then a retry that succeeds; a late failure never undoes a success', async () => {
  const o = mkOrder();
  assert.equal((await send(pay(o, 'payment.failed', {}, 'pay_FailedTry0001'))).body.outcome, 'applied:marked_failed'); assert.equal(orders.get(o._id).paymentStatus, 'failed'); assert.equal(orders.get(o._id).paymentError, 'Declined by bank');
  assert.equal((await send(pay(o, 'payment.captured', {}, 'pay_GoodPayment01'))).body.outcome, 'applied:paid'); assert.equal(orders.get(o._id).paymentStatus, 'paid'); assert.equal(orders.get(o._id).paymentError, '');
  assert.equal((await send(pay(o, 'payment.failed', {}, 'pay_FailedTry0002'))).body.outcome, 'noop:not_pending'); assert.equal(orders.get(o._id).paymentStatus, 'paid');
});
test('refunds: created -> processed (partial, then full); failed refunds do not count; replays are harmless', async () => {
  const o = mkOrder(), pid = 'pay_RefundFlow001'; await send(pay(o, 'payment.captured', {}, pid));
  await send(rfd(pid, 'refund.created', { amount: 10000 })); assert.equal(orders.get(o._id).refundedPaise, 0); assert.equal(orders.get(o._id).paymentStatus, 'paid');
  await send(rfd(pid, 'refund.processed', { amount: 10000 })); assert.equal(orders.get(o._id).refundedPaise, 10000); assert.equal(orders.get(o._id).paymentStatus, 'paid');
  await send(rfd(pid, 'refund.processed', { amount: 10000 })); assert.equal(orders.get(o._id).refundedPaise, 10000, 'replay');
  await send(rfd(pid, 'refund.failed', { id: 'rfnd_Test000002', amount: 5000 })); assert.equal(orders.get(o._id).refundedPaise, 10000); assert.equal(orders.get(o._id).refunds.find((r) => r.refundId === 'rfnd_Test000002').status, 'failed');
  await send(rfd(pid, 'refund.processed', { id: 'rfnd_Test000003', amount: 39950 })); assert.equal(orders.get(o._id).refundedPaise, 49950); assert.equal(orders.get(o._id).paymentStatus, 'refunded');
});
test('a refund for a payment we have not recorded yet gets 409 so Razorpay retries; once recorded, the retry succeeds', async () => {
  const o = mkOrder(), pid = 'pay_NotYetKnown001', evt = rfd(pid, 'refund.processed');
  const r1 = await send(evt, { id: 'evt_refund_early' }); assert.equal(r1.status, 409); assert.equal(events.get('evt_refund_early').status, 'failed');
  await send(pay(o, 'payment.captured', {}, pid));
  const r2 = await send(evt, { id: 'evt_refund_early' }); assert.equal(r2.status, 200); assert.equal(r2.body.duplicate, false); assert.equal(orders.get(o._id).paymentStatus, 'refunded'); assert.equal(events.get('evt_refund_early').attempts, 2);
});
test('a "processing" claim from a crashed worker is taken over after the lock expires, but not before', async () => {
  const o = mkOrder(), body = pay(o, 'payment.captured');
  events.set('evt_stuck_0001', { eventKey: 'evt_stuck_0001', event: 'payment.captured', status: 'processing', attempts: 1, lockedAt: new Date() });
  assert.equal((await send(body, { id: 'evt_stuck_0001' })).status, 409); assert.equal(orders.get(o._id).paymentStatus, 'pending');
  events.get('evt_stuck_0001').lockedAt = new Date(Date.now() - LOCK_MS - 1000);
  assert.equal((await send(body, { id: 'evt_stuck_0001' })).status, 200); assert.equal(orders.get(o._id).paymentStatus, 'paid');
});
test('webhooks never touch stock fields or the order lifecycle status', async () => {
  const o = mkOrder({ status: 'cancelled', inventoryReleased: true, stockNote: 'untouched' }), pid = 'pay_CancelledPay01';
  await send(pay(o, 'payment.captured', {}, pid)); await send(rfd(pid, 'refund.processed'));
  const d = orders.get(o._id); assert.equal(d.status, 'cancelled'); assert.equal(d.inventoryReleased, true); assert.equal(d.stockNote, 'untouched'); assert.equal(d.paymentStatus, 'refunded');
});
test('a failure while applying is recorded as failed and answered 500 so Razorpay retries', async () => {
  const o = mkOrder(), real = FakeOrder.updateOne; FakeOrder.updateOne = async () => { throw new Error('db down'); };
  try { const r = await send(pay(o, 'payment.captured'), { id: 'evt_dbdown_01' }); assert.equal(r.status, 500); assert.equal(events.get('evt_dbdown_01').status, 'failed'); }
  finally { FakeOrder.updateOne = real; }
  assert.equal((await send(pay(o, 'payment.captured'), { id: 'evt_dbdown_01' })).status, 200); assert.equal(orders.get(o._id).paymentStatus, 'paid');
});

test('compare-and-set: an order changed by someone else between our read and our write is re-read and re-decided, never overwritten', async () => {
  const o = mkOrder();
  // A "payment.failed" webhook reads the order as pending; before it writes, the buyer's verify call marks the order paid (and bumps the revision).
  FakeOrder.afterRead = (d) => { d.paymentStatus = 'paid'; d.razorpayPaymentId = 'pay_VerifiedFirst1'; d.paymentRev += 1; };
  const r = await send(pay(o, 'payment.failed', {}, 'pay_FailedTry0009'));
  assert.equal(r.status, 200); assert.equal(r.body.outcome, 'noop:not_pending', 'the retry saw the newer state and left it alone');
  assert.equal(orders.get(o._id).paymentStatus, 'paid'); assert.equal(orders.get(o._id).razorpayPaymentId, 'pay_VerifiedFirst1');
});
test('compare-and-set: a refund event that loses a race re-reads the order and still records the refund once', async () => {
  const o = mkOrder({ paymentStatus: 'paid', razorpayPaymentId: 'pay_RaceRefund001', paymentRev: 3 }); // rev 3: exercises the non-zero revision filter
  FakeOrder.afterRead = (d) => { d.paymentRev += 1; d.refunds = [{ refundId: 'rfnd_Test000009', amountPaise: 1000, status: 'processed' }]; d.refundedPaise = 1000; };
  await send(rfd('pay_RaceRefund001', 'refund.processed', { amount: 20000 }));
  const d = orders.get(o._id); assert.equal(d.refunds.length, 2, 'the other writer\'s refund was kept, ours was added'); assert.equal(d.refundedPaise, 21000);
});
