'use strict';
// Module 6 step 3 webhooks against a REAL MongoDB, through the real HTTP route (raw body + HMAC), with a FAKE Razorpay server API.
//   MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
// NOTE: written but NOT executed in the sandbox it was written in (no MongoDB, no npm registry). Do not read this file as proof that it passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('module 6 webhook integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40); process.env.APP_URL = 'http://localhost:3000';
process.env.CHECKOUT_RATE_LIMIT = '100000'; process.env.QUOTE_RATE_LIMIT = '100000'; process.env.PAYMENT_RATE_LIMIT = '100000'; process.env.WEBHOOK_RATE_LIMIT = '100000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitKey123'; process.env.RAZORPAY_KEY_SECRET = 'unit_secret_value_456'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_integration_789';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-m6w-uploads-' + process.pid);
const crypto = require('crypto');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product'); const Order = require('../src/models/Order'); const Counter = require('../src/models/Counter');
const WebhookEvent = require('../src/models/WebhookEvent');
const { hashPassword } = require('../src/utils/password');
const { webhookSignature } = require('../src/utils/razorpayWebhook');
const { handle } = require('../src/services/webhooks');

const WH = 'whsec_integration_789', rnd = () => crypto.randomBytes(4).toString('hex'), PW = 'Passw0rd!x';
let server, base, A, item, ipSeq = 1;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { // fake Razorpay server API only
  if (!String(url).startsWith('https://api.razorpay.com/')) return realFetch(url, opts);
  const b = JSON.parse(opts.body); return new Response(JSON.stringify({ id: 'order_' + crypto.randomBytes(8).toString('hex'), amount: b.amount, currency: b.currency }), { status: 200 });
};
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, { method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (path, opts) => api(null, `/public/stores/${A.slug}${path}`, opts);
const ADDR = { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
// An online order that already has its Razorpay order (as after the buyer pressed "Pay").
async function onlineOrder() {
  const r = await pub('/orders', { method: 'POST', body: { name: 'Priya Nair', phone: '9876543210', address: ADDR, items: [{ productId: item.id, qty: 1 }], paymentMethod: 'razorpay' } }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const p = await pub(`/orders/${r.json.order.orderNumber}/payment`, { method: 'POST', body: { token: r.json.token } }); assert.equal(p.status, 200, JSON.stringify(p.json));
  return { n: r.json.order.orderNumber, token: r.json.token, rzpOrder: p.json.payment.razorpayOrderId, pid: 'pay_' + crypto.randomBytes(7).toString('hex') };
}
const dbOrder = (n) => Order.findOne({ store: A.sid, orderNumber: n });
const stock = async () => (await Product.findOne({ _id: item.id, store: A.sid })).stock;
const evPay = (o, event, x = {}) => ({ entity: 'event', event, payload: { payment: { entity: { id: o.pid, order_id: o.rzpOrder, amount: 49950, currency: 'INR', status: event === 'payment.failed' ? 'failed' : 'captured', error_description: 'Card declined', created_at: Math.floor(Date.now() / 1000) - 5, ...x } } } });
const evRf = (o, event, x = {}) => ({ entity: 'event', event, payload: { refund: { entity: { id: 'rfnd_' + o.pid.slice(4), payment_id: o.pid, amount: 49950, ...x } } } });
// Delivers an event exactly as Razorpay would: raw JSON bytes, signature header, event-id header.
const deliver = (obj, { id = 'evt_' + rnd() + rnd(), secret = WH, sign = true, raw = Buffer.from(JSON.stringify(obj)), headers = {} } = {}) => fetch(base + '/webhooks/razorpay', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-event-id': id, ...(sign ? { 'x-razorpay-signature': webhookSignature(raw, secret) } : {}), ...headers }, body: raw,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), id }));

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Order.init(), Counter.init(), User.init(), WebhookEvent.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const email = `m6w${rnd()}@example.com`;
  await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true });
  const l = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: email, password: PW }) });
  assert.equal(l.status, 200); A = { jar: l.headers.getSetCookie()[0].split(';')[0], email };
  const s = await api(A, '/stores', { method: 'POST', body: { name: 'M6W Store', slug: `m6w-${rnd()}`, whatsappNumber: '9876543210' } }); assert.equal(s.status, 201, JSON.stringify(s.json)); A.sid = s.json.store.id; A.slug = s.json.store.slug;
  const p = await api(A, `/stores/${A.sid}/products`, { method: 'POST', body: { status: 'active', title: 'M6W Saree', price: 499.5, stock: 50 } }); assert.equal(p.status, 201, JSON.stringify(p.json)); item = p.json.product;
});
test.after(async () => {
  for (const M of [Product, Order, Counter]) await M.deleteMany({}).setOptions({ skipTenant: true }).where({ store: A.sid });
  await WebhookEvent.deleteMany({ storeId: A.sid }); await Store.deleteMany({ _id: A.sid }); await User.deleteMany({ email: A.email }); server.close(); await disconnectDb(); globalThis.fetch = realFetch;
});

test('forged webhooks are rejected and change nothing: no signature, wrong secret, body altered after signing', async () => {
  const o = await onlineOrder(), body = evPay(o, 'payment.captured'), before = await WebhookEvent.countDocuments({});
  assert.equal((await deliver(body, { sign: false })).status, 400);
  assert.equal((await deliver(body, { secret: 'not-the-secret' })).status, 400);
  const raw = Buffer.from(JSON.stringify(body)), sig = webhookSignature(raw, WH);
  const tampered = await fetch(base + '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_tampered01' }, body: Buffer.from(raw.toString().replace('49950', '100')) });
  assert.equal(tampered.status, 400);
  assert.equal((await dbOrder(o.n)).paymentStatus, 'pending'); assert.equal(await WebhookEvent.countDocuments({}), before, 'rejected requests leave no ledger row');
  // the buyer-facing verify endpoint is a different, token-guarded route; the webhook cannot be reached through /api either
  assert.equal((await realFetch(base + '/api/webhooks/razorpay', { method: 'POST', body: '{}' })).status, 404);
});
test('webhook secret not configured -> 503 and nothing is applied', async () => {
  const o = await onlineOrder(), raw = Buffer.from(JSON.stringify(evPay(o, 'payment.captured')));
  const r = await handle({ raw, signature: webhookSignature(raw, WH), eventId: 'evt_nosecret1', secret: '' }); assert.equal(r.status, 503); assert.equal((await dbOrder(o.n)).paymentStatus, 'pending');
});
test('payment.captured marks the order paid; a replay of the same event is a duplicate; the owner sees it; stock is untouched', async () => {
  const o = await onlineOrder(), stockBefore = await stock(), body = evPay(o, 'payment.captured');
  const r1 = await deliver(body); assert.equal(r1.status, 200); assert.equal(r1.json.outcome, 'applied:paid');
  const d = await dbOrder(o.n); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.razorpayPaymentId, o.pid); assert.ok(d.paidAt); assert.equal(d.paymentRev, 1);
  const r2 = await deliver(body, { id: r1.id }); assert.equal(r2.status, 200); assert.equal(r2.json.duplicate, true); assert.equal((await dbOrder(o.n)).paymentRev, 1);
  assert.equal(await WebhookEvent.countDocuments({ eventKey: r1.id }), 1);
  const owner = await api(A, `/stores/${A.sid}/orders/${o.n}`); assert.equal(owner.json.order.paymentStatus, 'paid'); assert.equal(owner.json.order.razorpayPaymentId, o.pid);
  const buyer = await pub(`/orders/${o.n}?t=${o.token}`); assert.equal(buyer.json.order.paymentStatus, 'paid'); assert.equal(buyer.json.order.razorpayPaymentId, undefined, 'gateway ids stay private');
  assert.equal(await stock(), stockBefore, 'a payment never changes stock');
});
test('the buyer verify endpoint and the webhook agree: whichever comes first wins, the other is a no-op', async () => {
  const o = await onlineOrder(); const { computeSignature } = require('../src/utils/razorpay');
  const v = await pub(`/orders/${o.n}/payment/verify`, { method: 'POST', body: { token: o.token, razorpay_order_id: o.rzpOrder, razorpay_payment_id: o.pid, razorpay_signature: computeSignature(o.rzpOrder, o.pid, 'unit_secret_value_456') } }); assert.equal(v.status, 200);
  const w = await deliver(evPay(o, 'payment.captured')); assert.equal(w.json.outcome, 'noop:already_paid');
});
test('20 simultaneous deliveries of one event: applied exactly once, no errors', async () => {
  const o = await onlineOrder(), body = evPay(o, 'payment.captured'), id = 'evt_par_' + rnd();
  const rs = await Promise.all(Array.from({ length: 20 }, () => deliver(body, { id }))); assert.ok(rs.every((r) => r.status === 200 || r.status === 409), JSON.stringify(rs.map((r) => r.status)));
  assert.equal(rs.filter((r) => r.status === 200 && r.json.duplicate === false).length, 1); assert.equal((await dbOrder(o.n)).paymentRev, 1); assert.equal((await dbOrder(o.n)).paymentStatus, 'paid');
});
test('anomalies are acknowledged but never change an order: wrong amount, unknown Razorpay order, second payment, unsupported event', async () => {
  const o = await onlineOrder();
  assert.equal((await deliver(evPay(o, 'payment.captured', { amount: 100 }))).json.outcome, 'ignored:amount_mismatch');
  assert.equal((await deliver(evPay(o, 'payment.captured', { order_id: 'order_NotOurs000001' }))).json.outcome, 'ignored:order_not_found');
  assert.equal((await deliver({ event: 'payment.authorized', payload: {} })).json.outcome, 'ignored:unsupported_event');
  assert.equal((await dbOrder(o.n)).paymentStatus, 'pending');
  await deliver(evPay(o, 'payment.captured')); const second = await deliver(evPay(o, 'payment.captured', { id: 'pay_SecondPayment01' }));
  assert.equal(second.json.outcome, 'ignored:second_payment_for_paid_order'); assert.equal((await dbOrder(o.n)).razorpayPaymentId, o.pid);
});
test('payment.failed marks a pending order failed (reason kept for the owner); a retry that succeeds makes it paid; a late failure cannot undo it', async () => {
  const o = await onlineOrder();
  assert.equal((await deliver(evPay(o, 'payment.failed', { id: 'pay_FirstAttempt001' }))).json.outcome, 'applied:marked_failed');
  let d = await dbOrder(o.n); assert.equal(d.paymentStatus, 'failed'); assert.equal(d.paymentError, 'Card declined');
  assert.equal((await api(A, `/stores/${A.sid}/orders/${o.n}`)).json.order.paymentError, 'Card declined');
  const again = await pub(`/orders/${o.n}/payment`, { method: 'POST', body: { token: o.token } }); assert.equal(again.status, 200, 'a failed order can be paid again (same Razorpay order)'); assert.equal(again.json.payment.razorpayOrderId, o.rzpOrder);
  assert.equal((await deliver(evPay(o, 'payment.captured'))).json.outcome, 'applied:paid'); d = await dbOrder(o.n); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.paymentError, '');
  assert.equal((await deliver(evPay(o, 'payment.failed', { id: 'pay_LateFailure0001' }))).json.outcome, 'noop:not_pending'); assert.equal((await dbOrder(o.n)).paymentStatus, 'paid');
});
test('refunds: created -> processed (partial then full); failed refunds do not count; replays are harmless; owner API shows the ledger', async () => {
  const o = await onlineOrder(); await deliver(evPay(o, 'payment.captured'));
  await deliver(evRf(o, 'refund.created', { status: 'created', amount: 10000 })); let d = await dbOrder(o.n); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.refundedPaise, 0);
  await deliver(evRf(o, 'refund.processed', { amount: 10000 })); d = await dbOrder(o.n); assert.equal(d.refundedPaise, 10000); assert.equal(d.paymentStatus, 'paid');
  await deliver(evRf(o, 'refund.processed', { amount: 10000 })); assert.equal((await dbOrder(o.n)).refundedPaise, 10000);
  await deliver(evRf(o, 'refund.failed', { id: 'rfnd_FailedOne0001', amount: 5000 })); assert.equal((await dbOrder(o.n)).refundedPaise, 10000);
  const owner = (await api(A, `/stores/${A.sid}/orders/${o.n}`)).json.order; assert.equal(owner.refundedAmount, 100); assert.equal(owner.refunds.length, 2);
  await deliver(evRf(o, 'refund.processed', { id: 'rfnd_RestOfIt00001', amount: 39950 })); d = await dbOrder(o.n); assert.equal(d.refundedPaise, 49950); assert.equal(d.paymentStatus, 'refunded');
  const buyer = (await pub(`/orders/${o.n}?t=${o.token}`)).json.order; assert.equal(buyer.paymentStatus, 'refunded'); assert.equal(buyer.refunds, undefined);
});
test('a refund for a payment we have not recorded yet is answered 409 (Razorpay retries) and succeeds once the capture is recorded', async () => {
  const o = await onlineOrder(), evt = evRf(o, 'refund.processed'), id = 'evt_early_' + rnd();
  assert.equal((await deliver(evt, { id })).status, 409); assert.equal((await WebhookEvent.findOne({ eventKey: id })).status, 'failed');
  await deliver(evPay(o, 'payment.captured')); const r = await deliver(evt, { id }); assert.equal(r.status, 200); assert.equal((await dbOrder(o.n)).paymentStatus, 'refunded'); assert.equal((await WebhookEvent.findOne({ eventKey: id })).attempts, 2);
});
test('stock and order consistency: cancel returns stock once; a later capture and full refund change neither stock nor the order status', async () => {
  const s0 = await stock(), o = await onlineOrder(); assert.equal(await stock(), s0 - 1, 'the order reserved one unit');
  assert.equal((await api(A, `/stores/${A.sid}/orders/${o.n}`, { method: 'PATCH', body: { status: 'cancelled' } })).status, 200); assert.equal(await stock(), s0, 'cancel released it');
  await deliver(evPay(o, 'payment.captured')); await deliver(evRf(o, 'refund.processed'));
  const d = await dbOrder(o.n); assert.equal(d.status, 'cancelled'); assert.equal(d.paymentStatus, 'refunded'); assert.equal(await stock(), s0, 'no double release, no extra reservation');
});
test('a malformed signed payload is a 400; an oversized body is rejected before parsing', async () => {
  const raw = Buffer.from('{"event":"payment.captured","payload":{}}'); assert.equal((await deliver(null, { raw })).status, 400);
  const big = Buffer.alloc(300 * 1024, 'a'); assert.equal((await deliver(null, { raw: big })).status, 413);
});
