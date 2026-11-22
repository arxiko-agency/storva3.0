'use strict';
// Module 6 step 4 against a REAL MongoDB through the real HTTP routes, with a FAKE Razorpay server API.
//   MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
// NOTE: written but NOT executed in the sandbox it was written in (no MongoDB, no npm registry). Do not read this file as proof that it passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('module 6 refund integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40); process.env.APP_URL = 'http://localhost:3000';
for (const k of ['CHECKOUT_RATE_LIMIT', 'QUOTE_RATE_LIMIT', 'PAYMENT_RATE_LIMIT', 'WEBHOOK_RATE_LIMIT', 'REFUND_RATE_LIMIT']) process.env[k] = '100000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitKey123'; process.env.RAZORPAY_KEY_SECRET = 'unit_secret_value_456'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_integration_789';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-m6r-uploads-' + process.pid);
const crypto = require('crypto');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product'); const Order = require('../src/models/Order'); const Counter = require('../src/models/Counter');
const WebhookEvent = require('../src/models/WebhookEvent');
const { hashPassword } = require('../src/utils/password');
const { webhookSignature } = require('../src/utils/razorpayWebhook');

const rnd = () => crypto.randomBytes(4).toString('hex'), PW = 'Passw0rd!x';
let server, base, A, B, item, ipSeq = 1;
const realFetch = globalThis.fetch, refundCalls = [], seenKeys = new Map(); let refundMode = 'ok';
globalThis.fetch = async (url, opts) => { // fake Razorpay server API only
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/')) return realFetch(url, opts);
  const b = JSON.parse(opts.body);
  if (u.endsWith('/orders')) return new Response(JSON.stringify({ id: 'order_' + crypto.randomBytes(8).toString('hex'), amount: b.amount, currency: b.currency }), { status: 200 });
  const m = /\/payments\/(pay_[A-Za-z0-9]+)\/refund$/.exec(u); assert.ok(m, 'unexpected Razorpay URL ' + u);
  refundCalls.push({ paymentId: m[1], amount: b.amount, key: opts.headers['X-Refund-Idempotency'], auth: opts.headers.authorization });
  if (refundMode === 'down') throw new Error('network');
  if (refundMode === 'refuse') return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR' } }), { status: 400 });
  const k = opts.headers['X-Refund-Idempotency']; if (!seenKeys.has(k)) seenKeys.set(k, { id: 'rfnd_' + crypto.randomBytes(7).toString('hex'), payment_id: m[1], amount: b.amount, status: 'pending' });
  return new Response(JSON.stringify(seenKeys.get(k)), { status: 200 });
};
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, { method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const key = () => 'k' + rnd() + rnd() + rnd();
const dbOrder = (u, n) => Order.findOne({ store: u.sid, orderNumber: n });
async function mkUser(label) {
  const email = `m6r${label}${rnd()}@example.com`;
  await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true });
  const l = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: email, password: PW }) });
  assert.equal(l.status, 200); const u = { jar: l.headers.getSetCookie()[0].split(';')[0], email };
  const s = await api(u, '/stores', { method: 'POST', body: { name: 'M6R ' + label, slug: `m6r${label}-${rnd()}`, whatsappNumber: '9876543210' } }); assert.equal(s.status, 201, JSON.stringify(s.json)); u.sid = s.json.store.id; u.slug = s.json.store.slug; return u;
}
// A paid online order, created through the real checkout and marked paid the way the capture webhook does (a direct, store-scoped write).
async function paidOrder(u, productId, total = 49950) {
  const r = await api(null, `/public/stores/${u.slug}/orders`, { method: 'POST', body: { name: 'Priya Nair', phone: '9876543210', address: { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, items: [{ productId, qty: 1 }], paymentMethod: 'razorpay' } });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const n = r.json.order.orderNumber;
  await Order.updateOne({ store: u.sid, orderNumber: n }, { $set: { paymentStatus: 'paid', paidAt: new Date(), razorpayPaymentId: 'pay_' + crypto.randomBytes(7).toString('hex'), razorpayOrderId: 'order_' + crypto.randomBytes(8).toString('hex') }, $inc: { paymentRev: 1 } });
  return n;
}
const refund = (u, n, body) => api(u, `/stores/${u.sid}/payments/${n}/refunds`, { method: 'POST', body });
const deliver = (obj) => { const raw = Buffer.from(JSON.stringify(obj)); return fetch(base + '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-event-id': 'evt_' + rnd() + rnd(), 'x-razorpay-signature': webhookSignature(raw, process.env.RAZORPAY_WEBHOOK_SECRET) }, body: raw }).then((r) => r.status); };

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Order.init(), Counter.init(), User.init(), WebhookEvent.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  A = await mkUser('a'); B = await mkUser('b');
  const p = await api(A, `/stores/${A.sid}/products`, { method: 'POST', body: { status: 'active', title: 'M6R Saree', price: 499.5, stock: 50 } }); assert.equal(p.status, 201, JSON.stringify(p.json)); item = p.json.product;
});
test.after(async () => {
  for (const u of [A, B]) { for (const M of [Product, Order, Counter]) await M.deleteMany({}).setOptions({ skipTenant: true }).where({ store: u.sid }); await Store.deleteMany({ _id: u.sid }); await User.deleteMany({ email: u.email }); }
  server.close(); await disconnectDb(); globalThis.fetch = realFetch;
});

test('auth and store isolation: logged-out is 401; another owner gets 404 on every payment endpoint and cannot refund', async () => {
  const n = await paidOrder(A, item.id), before = refundCalls.length;
  assert.equal((await api(null, `/stores/${A.sid}/payments/summary`)).status, 401);
  assert.equal((await api(null, `/stores/${A.sid}/payments/${n}/refunds`, { method: 'POST', body: { type: 'full', idempotencyKey: key() } })).status, 401);
  for (const [m, path, body] of [['GET', 'summary'], ['GET', 'transactions'], ['GET', String(n)], ['POST', `${n}/refunds`, { type: 'full', idempotencyKey: key() }], ['POST', `${n}/refunds/${key()}/retry`, {}]]) {
    const r = await api(B, `/stores/${A.sid}/payments/${path}`, { method: m, body }); assert.equal(r.status, 404, path); assert.equal(r.json.error.code, 'store_not_found');
  }
  // B's OWN store with A's order number: not found, and the order is untouched
  assert.equal((await api(B, `/stores/${B.sid}/payments/${n}`)).status, 404); assert.equal((await refund(B, n, { type: 'full', idempotencyKey: key() })).status, 404);
  assert.equal(refundCalls.length, before); assert.equal((await dbOrder(A, n)).refunds.length, 0);
  const t = await api(B, `/stores/${B.sid}/payments/transactions`); assert.equal(t.json.total, 0);
  const s = await api(B, `/stores/${B.sid}/payments/summary`); assert.equal(s.json.summary.successful.count, 0);
});
test('partial then full refund over HTTP; webhooks complete them; amounts are validated server-side; secrets never leak', async () => {
  const n = await paidOrder(A, item.id); refundMode = 'ok';
  assert.equal((await refund(A, n, { type: 'partial', amount: '600', idempotencyKey: key() })).status, 400);
  assert.equal((await refund(A, n, { type: 'partial', amount: '-1', idempotencyKey: key() })).status, 400);
  assert.equal((await refund(A, n, { type: 'partial', amount: '100', idempotencyKey: 'short' })).status, 400);
  const k1 = key(), r1 = await refund(A, n, { type: 'partial', amount: '100.00', reason: 'Item returned', idempotencyKey: k1 });
  assert.equal(r1.status, 201, JSON.stringify(r1.json)); assert.equal(r1.json.payment.displayStatus, 'refund_pending'); assert.equal(r1.json.refund.status, 'created');
  const again = await refund(A, n, { type: 'partial', amount: '100.00', idempotencyKey: k1 }); assert.equal(again.status, 200); assert.equal(again.json.replayed, true);
  assert.equal(refundCalls.filter((c) => c.amount === 10000).length, 1, 'one gateway call for one request key');
  assert.equal((await refund(A, n, { type: 'full', idempotencyKey: key() })).status, 409, 'blocked while a refund is in flight');
  const o1 = await dbOrder(A, n), rid = o1.refunds[0].refundId;
  assert.equal(await deliver({ event: 'refund.processed', payload: { refund: { entity: { id: rid, payment_id: o1.razorpayPaymentId, amount: 10000 } } } }), 200);
  const d1 = await api(A, `/stores/${A.sid}/payments/${n}`); assert.equal(d1.json.payment.displayStatus, 'partially_refunded'); assert.equal(d1.json.payment.refundedAmount, 100); assert.equal(d1.json.payment.refundableAmount, 399.5); assert.equal(d1.json.payment.refunds[0].reason, 'Item returned', 'webhook kept the owner\'s reason');
  assert.equal((await refund(A, n, { type: 'partial', amount: '399.51', idempotencyKey: key() })).status, 400);
  const r2 = await refund(A, n, { type: 'full', idempotencyKey: key() }); assert.equal(r2.status, 201); assert.equal(refundCalls.at(-1).amount, 39950);
  const o2 = await dbOrder(A, n), rid2 = o2.refunds[1].refundId;
  await deliver({ event: 'refund.processed', payload: { refund: { entity: { id: rid2, payment_id: o2.razorpayPaymentId, amount: 39950 } } } });
  const d2 = await api(A, `/stores/${A.sid}/payments/${n}`); assert.equal(d2.json.payment.displayStatus, 'refunded'); assert.equal(d2.json.payment.canRefund, false);
  assert.equal((await refund(A, n, { type: 'partial', amount: '1', idempotencyKey: key() })).status, 409);
  const text = JSON.stringify([r1.json, d1.json, d2.json]); assert.equal(text.includes(process.env.RAZORPAY_KEY_SECRET), false); assert.equal(text.includes(process.env.RAZORPAY_WEBHOOK_SECRET), false);
  assert.ok(refundCalls.every((c) => c.auth.startsWith('Basic ')), 'server-side credentials were used for the gateway call only');
});
test('gateway down: the refund stays pending and is retried safely; a refusal releases the money', async () => {
  const n = await paidOrder(A, item.id); refundMode = 'down';
  const kk = key(), r = await refund(A, n, { type: 'full', idempotencyKey: kk }); assert.equal(r.status, 503); assert.equal(r.json.error.details.payment.refunds[0].canRetry, true);
  assert.equal((await dbOrder(A, n)).refunds[0].status, 'pending');
  refundMode = 'ok'; const ok = await api(A, `/stores/${A.sid}/payments/${n}/refunds/${kk}/retry`, { method: 'POST', body: {} }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await dbOrder(A, n)).refunds.length, 1); assert.equal((await dbOrder(A, n)).refunds[0].status, 'created');
  const m = await paidOrder(A, item.id); refundMode = 'refuse';
  assert.equal((await refund(A, m, { type: 'full', idempotencyKey: key() })).status, 502); assert.equal((await dbOrder(A, m)).refunds[0].status, 'failed');
  refundMode = 'ok'; assert.equal((await refund(A, m, { type: 'full', idempotencyKey: key() })).status, 201);
});
test('20 parallel refund clicks (same key) hit Razorpay once; COD and unpaid orders cannot be refunded', async () => {
  const n = await paidOrder(A, item.id); refundMode = 'ok'; const kk = key(), before = refundCalls.length;
  const rs = await Promise.all(Array.from({ length: 20 }, () => refund(A, n, { type: 'full', idempotencyKey: kk })));
  assert.ok(rs.every((x) => [200, 201, 409].includes(x.status)), rs.map((x) => x.status).join()); assert.equal(refundCalls.length - before, 1); assert.equal((await dbOrder(A, n)).refunds.length, 1);
  const c = await api(null, `/public/stores/${A.slug}/orders`, { method: 'POST', body: { name: 'Cod Buyer', phone: '9876543211', address: { line1: '1 Road', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' }, items: [{ productId: item.id, qty: 1 }], paymentMethod: 'cod' } });
  assert.equal((await refund(A, c.json.order.orderNumber, { type: 'full', idempotencyKey: key() })).status, 400);
});
test('summary and transactions: numbers match the orders and are scoped to the store', async () => {
  const s = (await api(A, `/stores/${A.sid}/payments/summary`)).json.summary;
  assert.ok(s.successful.count >= 4); assert.ok(s.refunded.amount >= 499.5); assert.equal(s.netCollected, Math.round((s.successful.amount - s.refunded.amount) * 100) / 100);
  const t = await api(A, `/stores/${A.sid}/payments/transactions?status=refunded&limit=5`); assert.ok(t.json.total >= 1); assert.ok(t.json.transactions.every((x) => x.displayStatus === 'refunded'));
  const bad = await api(A, `/stores/${A.sid}/payments/transactions?status[$ne]=x&q[$gt]=1&method[$ne]=cod`); assert.equal(bad.status, 200, 'operator-shaped query params are ignored, not executed');
});
