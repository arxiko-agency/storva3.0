'use strict';
// Module 6 step 4 part 2 against a REAL MongoDB through the real HTTP routes and the real batch job, with a FAKE Razorpay read API.
//   MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
// NOTE: written but NOT executed in the sandbox it was written in (no MongoDB, no npm registry). Do not read this file as proof that it passes.
// What only this suite can prove: the real stuck-order query filters (dates, $or on a missing field, $type, $elemMatch) on real documents, the unique
// indexes, the tenant guard on the new model, and the owner routes end to end.
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('module 6 reconcile integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40); process.env.APP_URL = 'http://localhost:3000';
for (const k of ['CHECKOUT_RATE_LIMIT', 'QUOTE_RATE_LIMIT', 'PAYMENT_RATE_LIMIT', 'WEBHOOK_RATE_LIMIT', 'REFUND_RATE_LIMIT', 'RECONCILE_RATE_LIMIT']) process.env[k] = '100000';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitKey123'; process.env.RAZORPAY_KEY_SECRET = 'unit_secret_value_456'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_integration_789';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-m6c-uploads-' + process.pid);
const crypto = require('crypto');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product'); const Order = require('../src/models/Order'); const Counter = require('../src/models/Counter');
const WebhookEvent = require('../src/models/WebhookEvent'); const Issue = require('../src/models/ReconciliationIssue');
const { hashPassword } = require('../src/utils/password');
const { reconcileBatch } = require('../src/services/reconciliation');

const rnd = () => crypto.randomBytes(4).toString('hex'), PW = 'Passw0rd!x';
let server, base, A, B, item, ipSeq = 1;
const realFetch = globalThis.fetch, gwPayments = new Map(), gwRefunds = new Map();
globalThis.fetch = async (url, opts) => { // fake Razorpay READ API only
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/')) return realFetch(url, opts);
  assert.equal((opts && opts.method) || 'GET', 'GET', 'reconciliation must only read from Razorpay: ' + u);
  let m = /\/orders\/(order_[A-Za-z0-9]+)\/payments$/.exec(u); if (m) return new Response(JSON.stringify({ entity: 'collection', items: gwPayments.get(m[1]) || [] }), { status: 200 });
  m = /\/payments\/(pay_[A-Za-z0-9]+)\/refunds/.exec(u); if (m) return new Response(JSON.stringify({ entity: 'collection', items: gwRefunds.get(m[1]) || [] }), { status: 200 });
  throw new Error('unexpected Razorpay URL ' + u);
};
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, { method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
async function mkUser(label) {
  const email = `m6c${label}${rnd()}@example.com`;
  await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true });
  const l = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: email, password: PW }) });
  assert.equal(l.status, 200); const u = { jar: l.headers.getSetCookie()[0].split(';')[0], email };
  const s = await api(u, '/stores', { method: 'POST', body: { name: 'M6C ' + label, slug: `m6c${label}-${rnd()}`, whatsappNumber: '9876543210' } }); assert.equal(s.status, 201, JSON.stringify(s.json)); u.sid = s.json.store.id; u.slug = s.json.store.slug; return u;
}
// An online order placed through the real checkout that then "got stuck": Razorpay order known, nothing recorded, created 2 hours ago (raw write: createdAt is immutable in Mongoose).
async function stuckOrder(u, productId) {
  const r = await api(null, `/public/stores/${u.slug}/orders`, { method: 'POST', body: { name: 'Priya Nair', phone: '9876543210', address: { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, items: [{ productId, qty: 1 }], paymentMethod: 'razorpay' } });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const n = r.json.order.orderNumber, oid = 'order_' + crypto.randomBytes(8).toString('hex');
  await Order.updateOne({ store: u.sid, orderNumber: n }, { $set: { razorpayOrderId: oid } });
  await Order.collection.updateOne({ store: new (require('mongoose').Types.ObjectId)(u.sid), orderNumber: n }, { $set: { createdAt: new Date(Date.now() - 2 * 3600 * 1000) } });
  const o = await Order.findOne({ store: u.sid, orderNumber: n }); return { n, oid, total: o.totalPaise };
}
const captured = (s, over = {}) => ({ id: 'pay_' + crypto.randomBytes(7).toString('hex'), order_id: s.oid, amount: s.total, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0, created_at: Math.floor(Date.now() / 1000) - 3000, ...over });
const dbOrder = (u, n) => Order.findOne({ store: u.sid, orderNumber: n });

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Order.init(), Counter.init(), User.init(), WebhookEvent.init(), Issue.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  A = await mkUser('a'); B = await mkUser('b');
  const p = await api(A, `/stores/${A.sid}/products`, { method: 'POST', body: { status: 'active', title: 'M6C Saree', price: 499.5, stock: 50 } }); assert.equal(p.status, 201, JSON.stringify(p.json)); item = p.json.product;
});
test.after(async () => {
  for (const u of [A, B]) { for (const M of [Product, Order, Counter, Issue]) await M.deleteMany({}).setOptions({ skipTenant: true }).where({ store: u.sid }); await Store.deleteMany({ _id: u.sid }); await User.deleteMany({ email: u.email }); }
  server.close(); await disconnectDb(); globalThis.fetch = realFetch;
});

test('the real batch finds a stuck order across stores with the real MongoDB filter, pays it once, and a second run changes nothing', async () => {
  const s = await stuckOrder(A, item.id); const pay = captured(s); gwPayments.set(s.oid, [pay]);
  const r1 = await reconcileBatch({ limit: 200 }); assert.ok(r1.applied >= 1, JSON.stringify(r1));
  const o = await dbOrder(A, s.n); assert.equal(o.paymentStatus, 'paid'); assert.equal(o.razorpayPaymentId, pay.id); assert.ok(o.paidAt); assert.ok(o.reconcileCheckedAt); const rev = o.paymentRev;
  await Order.collection.updateOne({ _id: o._id }, { $set: { reconcileCheckedAt: null } });
  await reconcileBatch({ limit: 200 }); assert.equal((await dbOrder(A, s.n)).paymentRev, rev, 'idempotent');
});
test('a young order, a recently checked order and a cash order are not selected', async () => {
  const s = await stuckOrder(A, item.id); gwPayments.set(s.oid, [captured(s)]);
  await Order.collection.updateOne({ store: new (require('mongoose').Types.ObjectId)(A.sid), orderNumber: s.n }, { $set: { createdAt: new Date(Date.now() - 60 * 1000) } });
  await reconcileBatch({ limit: 200 }); assert.equal((await dbOrder(A, s.n)).paymentStatus, 'pending', 'too young');
  await Order.collection.updateOne({ store: new (require('mongoose').Types.ObjectId)(A.sid), orderNumber: s.n }, { $set: { createdAt: new Date(Date.now() - 2 * 3600 * 1000), reconcileCheckedAt: new Date() } });
  await reconcileBatch({ limit: 200 }); assert.equal((await dbOrder(A, s.n)).paymentStatus, 'pending', 'checked a moment ago');
});
test('owner route: "Check with Razorpay" pays the order for the owner; another owner gets 404; logged out gets 401', async () => {
  const s = await stuckOrder(A, item.id); gwPayments.set(s.oid, [captured(s)]);
  assert.equal((await api(null, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} })).status, 401);
  assert.equal((await api(B, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} })).status, 404); assert.equal((await dbOrder(A, s.n)).paymentStatus, 'pending');
  const ok = await api(A, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} }); assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.changed, true); assert.equal(ok.json.payment.paymentStatus, 'paid');
  const again = await api(A, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} }); assert.equal(again.json.changed, false);
  assert.ok(!JSON.stringify(ok.json).includes('unit_secret_value_456'));
});
test('discrepancy: an amount mismatch changes nothing, shows up for its own owner only, and can be dismissed only by that owner', async () => {
  const s = await stuckOrder(A, item.id); gwPayments.set(s.oid, [captured(s, { amount: 100 })]);
  const r = await api(A, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} }); assert.equal(r.status, 200); assert.equal(r.json.changed, false); assert.equal(r.json.issues[0].code, 'amount_mismatch'); assert.equal(r.json.payment.paymentStatus, 'pending');
  const mine = await api(A, `/stores/${A.sid}/payments/issues`); const row = mine.json.issues.find((i) => i.orderNumber === s.n); assert.ok(row); assert.equal(row.code, 'amount_mismatch');
  assert.equal((await api(B, `/stores/${B.sid}/payments/issues`)).json.issues.length, 0, 'B sees none of A\'s');
  assert.equal((await api(B, `/stores/${B.sid}/payments/issues/${row.id}/dismiss`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await api(A, `/stores/${A.sid}/payments/issues/${row.id}/dismiss`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await api(A, `/stores/${A.sid}/payments/issues`)).json.issues.find((i) => i.orderNumber === s.n), undefined);
});
test('a refunded or paid order is never moved backwards, even if Razorpay (wrongly) answers "failed"', async () => {
  const s = await stuckOrder(A, item.id); gwPayments.set(s.oid, [captured(s)]); await api(A, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} });
  gwPayments.set(s.oid, [captured(s, { status: 'failed', captured: false })]);
  const r = await api(A, `/stores/${A.sid}/payments/${s.n}/reconcile`, { method: 'POST', body: {} }); assert.equal(r.status, 200); assert.equal((await dbOrder(A, s.n)).paymentStatus, 'paid');
});
test('the tenant guard covers the new issue collection: a query without a store filter throws', async () => {
  await assert.rejects(Issue.find({}), /Tenant guard/); await assert.rejects(Issue.updateMany({ status: 'open' }, { $set: { status: 'resolved' } }), /Tenant guard/);
});
