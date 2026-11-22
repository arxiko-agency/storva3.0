'use strict';
// Module 6 step 2 payment backend against a REAL MongoDB with a FAKE Razorpay server API (global fetch is stubbed for api.razorpay.com only).
//   MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
// NOTE: written but NOT executed (no MongoDB and no npm registry in the sandbox it was written in).
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('module 6 integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40); process.env.APP_URL = 'http://localhost:3000';
process.env.CHECKOUT_RATE_LIMIT = '100000'; process.env.QUOTE_RATE_LIMIT = '100000'; process.env.PAYMENT_RATE_LIMIT = '100000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitKey123'; process.env.RAZORPAY_KEY_SECRET = 'unit_secret_value_456';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-m6-uploads-' + process.pid);
const crypto = require('crypto');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product'); const Order = require('../src/models/Order'); const Counter = require('../src/models/Counter');
const { hashPassword } = require('../src/utils/password');
const { computeSignature } = require('../src/utils/razorpay');

const rnd = () => crypto.randomBytes(4).toString('hex'), PW = 'Passw0rd!x';
let server, base, A, ipSeq = 1, gatewayCalls = [], gatewayMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { // fake Razorpay server API; everything else goes to the real fetch
  if (!String(url).startsWith('https://api.razorpay.com/')) return realFetch(url, opts);
  const b = JSON.parse(opts.body); gatewayCalls.push({ url: String(url), auth: opts.headers.authorization, body: b });
  if (gatewayMode === 'down') throw new Error('network down');
  if (gatewayMode === '500') return new Response(JSON.stringify({ error: { code: 'SERVER_ERROR', description: 'secret internal text' } }), { status: 500 });
  return new Response(JSON.stringify({ id: 'order_' + crypto.randomBytes(8).toString('hex'), amount: b.amount, currency: b.currency }), { status: 200 });
};
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, { method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (path, opts) => api(null, `/public/stores/${A.slug}${path}`, opts);
const ADDR = { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
let item;
const place = (paymentMethod, extra = {}) => pub('/orders', { method: 'POST', body: { name: 'Priya Nair', phone: '9876543210', address: ADDR, items: [{ productId: item.id, qty: 1 }], ...(paymentMethod ? { paymentMethod } : {}), ...extra } });

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Order.init(), Counter.init(), User.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const email = `m6${rnd()}@example.com`;
  await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true });
  const l = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: email, password: PW }) });
  assert.equal(l.status, 200); A = { jar: l.headers.getSetCookie()[0].split(';')[0], email };
  const s = await api(A, '/stores', { method: 'POST', body: { name: 'M6 Store', slug: `m6t-${rnd()}`, whatsappNumber: '9876543210' } }); assert.equal(s.status, 201, JSON.stringify(s.json));
  A.sid = s.json.store.id; A.slug = s.json.store.slug;
  const p = await api(A, `/stores/${A.sid}/products`, { method: 'POST', body: { status: 'active', title: 'M6 Saree', price: 499.5, stock: 20 } }); assert.equal(p.status, 201, JSON.stringify(p.json)); item = p.json.product;
});
test.after(async () => {
  for (const M of [Product, Order, Counter]) await M.deleteMany({}).setOptions({ skipTenant: true }).where({ store: A.sid });
  await Store.deleteMany({ _id: A.sid }); await User.deleteMany({ email: A.email }); server.close(); await disconnectDb(); globalThis.fetch = realFetch;
});

test('checkout without paymentMethod stays cash on delivery; unknown methods are refused', async () => {
  const r = await place(); assert.equal(r.status, 201); assert.equal(r.json.order.paymentMethod, 'cod'); assert.equal(r.json.order.paymentStatus, 'unpaid');
  const bad = await place('upi'); assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.paymentMethod);
});

let o, rzpId;
test('online order is saved as razorpay/pending; the Razorpay order uses the DATABASE amount and no secret reaches the response', async () => {
  const r = await place('razorpay'); assert.equal(r.status, 201); o = r.json; assert.equal(o.order.paymentMethod, 'razorpay'); assert.equal(o.order.paymentStatus, 'pending');
  assert.equal(o.order.razorpayOrderId, undefined, 'buyer API hides gateway ids');
  gatewayCalls = [];
  const p = await pub(`/orders/${o.order.orderNumber}/payment`, { method: 'POST', body: { token: o.token, amount: 1, total: 1 } }); // a tampered amount from the browser is ignored
  assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(gatewayCalls.length, 1); assert.equal(gatewayCalls[0].body.amount, 49950);
  assert.equal(p.json.payment.amount, 49950); assert.equal(p.json.payment.keyId, 'rzp_test_unitKey123'); rzpId = p.json.payment.razorpayOrderId;
  assert.ok(!JSON.stringify(p.json).includes('unit_secret_value_456'), 'secret never leaves the server');
  assert.equal(p.json.payment.prefill.contact, '+919876543210');
  const again = await pub(`/orders/${o.order.orderNumber}/payment`, { method: 'POST', body: { token: o.token } }); assert.equal(again.json.payment.razorpayOrderId, rzpId); assert.equal(gatewayCalls.length, 1, 'a retry reuses the Razorpay order');
});
test('payment endpoints need the order token', async () => {
  for (const token of [undefined, 'f'.repeat(32), 'nope']) assert.equal((await pub(`/orders/${o.order.orderNumber}/payment`, { method: 'POST', body: { token } })).status, 404);
});
test('verify: wrong signature, wrong Razorpay order and malformed input do NOT mark the order paid', async () => {
  const good = { token: o.token, razorpay_order_id: rzpId, razorpay_payment_id: 'pay_RealPayment01', razorpay_signature: computeSignature(rzpId, 'pay_RealPayment01', 'unit_secret_value_456') };
  for (const bad of [{ ...good, razorpay_signature: 'a'.repeat(64) }, { ...good, razorpay_order_id: 'order_SomeoneElse01', razorpay_signature: computeSignature('order_SomeoneElse01', 'pay_RealPayment01', 'unit_secret_value_456') }, { ...good, razorpay_payment_id: 'pay_Different0001' }, { token: o.token }]) {
    const r = await pub(`/orders/${o.order.orderNumber}/payment/verify`, { method: 'POST', body: bad }); assert.equal(r.status, 400); assert.notEqual(r.json.verified, true);
  }
  assert.equal((await Order.findOne({ store: A.sid, orderNumber: o.order.orderNumber })).paymentStatus, 'pending');
});
test('owner cannot mark an online order paid by hand', async () => {
  const r = await api(A, `/stores/${A.sid}/orders/${o.order.orderNumber}`, { method: 'PATCH', body: { paymentStatus: 'paid' } }); assert.equal(r.status, 400); assert.ok(r.json.error.fields.paymentStatus);
});
test('verify: a genuine signature marks the order paid once; repeating it is harmless', async () => {
  const body = { token: o.token, razorpay_order_id: rzpId, razorpay_payment_id: 'pay_RealPayment01', razorpay_signature: computeSignature(rzpId, 'pay_RealPayment01', 'unit_secret_value_456') };
  const r1 = await pub(`/orders/${o.order.orderNumber}/payment/verify`, { method: 'POST', body }); assert.equal(r1.status, 200); assert.equal(r1.json.verified, true); assert.equal(r1.json.alreadyVerified, false); assert.equal(r1.json.order.paymentStatus, 'paid'); assert.ok(r1.json.order.paidAt);
  const r2 = await pub(`/orders/${o.order.orderNumber}/payment/verify`, { method: 'POST', body }); assert.equal(r2.status, 200); assert.equal(r2.json.alreadyVerified, true);
  const par = await Promise.all([1, 2, 3].map(() => pub(`/orders/${o.order.orderNumber}/payment/verify`, { method: 'POST', body }))); assert.ok(par.every((x) => x.status === 200));
  const start = await pub(`/orders/${o.order.orderNumber}/payment`, { method: 'POST', body: { token: o.token } }); assert.equal(start.status, 409); assert.equal(start.json.error.code, 'already_paid');
  const owner = await api(A, `/stores/${A.sid}/orders/${o.order.orderNumber}`); assert.equal(owner.json.order.paymentStatus, 'paid'); assert.equal(owner.json.order.razorpayPaymentId, 'pay_RealPayment01');
});
test('COD orders have no online payment; cancelled orders cannot start one', async () => {
  const cod = (await place('cod')).json; assert.equal((await pub(`/orders/${cod.order.orderNumber}/payment`, { method: 'POST', body: { token: cod.token } })).json.error.code, 'not_online_order');
  const on = (await place('razorpay')).json; assert.equal((await api(A, `/stores/${A.sid}/orders/${on.order.orderNumber}`, { method: 'PATCH', body: { status: 'cancelled' } })).status, 200);
  assert.equal((await pub(`/orders/${on.order.orderNumber}/payment`, { method: 'POST', body: { token: on.token } })).json.error.code, 'order_cancelled');
});
test('gateway outage: shopper gets a safe message, never Razorpay internals, and the order stays pending', async () => {
  const on = (await place('razorpay')).json;
  for (const mode of ['down', '500']) { gatewayMode = mode; const r = await pub(`/orders/${on.order.orderNumber}/payment`, { method: 'POST', body: { token: on.token } }); assert.ok([502, 503].includes(r.status)); assert.ok(!JSON.stringify(r.json).includes('secret internal text')); }
  gatewayMode = 'ok'; assert.equal((await Order.findOne({ store: A.sid, orderNumber: on.order.orderNumber })).paymentStatus, 'pending');
});
