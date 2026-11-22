'use strict';
// Module 6 step 4: the REAL services/refunds.js + services/webhooks.js run against IN-MEMORY FAKES of Order / WebhookEvent and a FAKE Razorpay refund API.
// Checks reservation, duplicate protection, retries and webhook races WITHOUT MongoDB. Not a substitute for a real-database run.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc12345'; process.env.RAZORPAY_KEY_SECRET = 'k_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_service_test';
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));

const orders = new Map(); let seq = 0;
function matches(d, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => matches(d, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) { if ('$exists' in v) return (d[k] !== undefined) === v.$exists; if ('$in' in v) return v.$in.includes(d[k]); }
    return v === null ? d[k] == null : d[k] === v;
  });
}
const FakeOrder = {
  afterRead: null,
  findOne(f) { const q = { setOptions() { return q; }, then(res, rej) { return (async () => { await tick(); const d = [...orders.values()].find((x) => matches(x, f)); const snap = d ? clone(d) : null; if (d && FakeOrder.afterRead) { const h = FakeOrder.afterRead; FakeOrder.afterRead = null; h(d); } return snap; })().then(res, rej); } }; return q; },
  async updateOne(f, u) { await tick(); if (!f.store) throw new Error('Tenant guard: updateOne without store'); const d = [...orders.values()].find((x) => matches(x, f)); if (!d) return { matchedCount: 0 };
    if (u.$set) Object.assign(d, clone(u.$set)); if (u.$push) for (const [k, v] of Object.entries(u.$push)) d[k] = [...(d[k] || []), clone(v)]; for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; return { matchedCount: 1 }; },
};
const events = new Map();
const FakeEvent = { async create() {}, async findOneAndUpdate() { return null; }, async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };

// Fake Razorpay refund API: records every call; behaviour is scripted per test.
const gw = { calls: [], seen: new Map(), mode: 'ok', status: 'pending', nextId: 1 };
const fakeGateway = {
  async createOrder() { throw new Error('not used'); },
  async createRefund(args) {
    gw.calls.push(args); await tick();
    if (gw.mode === 'refuse') { const e = new (require('../src/utils/AppError'))('refused', 502, 'refund_rejected'); e.definite = true; throw e; }
    if (gw.mode === 'down') { const e = new (require('../src/utils/AppError'))('down', 503, 'gateway_unreachable'); e.definite = false; throw e; }
    if (gw.seen.has(args.idempotencyKey)) return gw.seen.get(args.idempotencyKey); // Razorpay replays the original answer for a repeated key
    const r = { id: 'rfnd_Gw' + String(gw.nextId++).padStart(6, '0'), paymentId: args.paymentId, amount: gw.amountOverride || args.amountPaise, status: gw.status }; gw.seen.set(args.idempotencyKey, r); return r;
  },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req.endsWith('/models/Order')) return FakeOrder;
  if (req.endsWith('/models/WebhookEvent')) return FakeEvent;
  if (req.endsWith('/services/razorpayApi') || req === './razorpayApi') return fakeGateway;
  if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } }
  return origLoad.call(this, req, ...a);
};
const { initiateRefund, retryRefund } = require('../src/services/refunds');
const { applyToOrder } = require('../src/services/webhooks');
const W = require('../src/utils/razorpayWebhook');
Module._load = origLoad;

const store = { _id: 'S1', slug: 'shop' }, user = { _id: 'U1' };
let k = 0; const key = () => 'req' + String(++k).padStart(17, '0');
function mkOrder(extra = {}) {
  const id = 'o' + (++seq), o = { _id: id, store: 'S1', orderNumber: 1000 + seq, paymentMethod: 'razorpay', paymentStatus: 'paid', status: 'confirmed', totalPaise: 50000, paymentRev: 1, razorpayOrderId: 'order_T' + seq, razorpayPaymentId: 'pay_Test' + String(seq).padStart(6, '0'), refunds: [], refundedPaise: 0, customer: { name: 'A', phone: '1' }, ...extra };
  orders.set(id, o); return o;
}
const reset = () => { gw.calls = []; gw.seen.clear(); gw.mode = 'ok'; gw.status = 'pending'; gw.amountOverride = null; };
const full = (o, idempotencyKey = key()) => initiateRefund(store, user, o.orderNumber, { type: 'full', idempotencyKey });
const part = (o, amount, idempotencyKey = key()) => initiateRefund(store, user, o.orderNumber, { type: 'partial', amount, idempotencyKey });
const rejects = async (p, status, code) => { await assert.rejects(p, (e) => { assert.equal(e.status, status); if (code) assert.equal(e.code, code); return true; }); };

test('full refund: reserved, sent once with a stable key, recorded as in progress; order stays paid until processed', async () => {
  reset(); const o = mkOrder(), r = await full(o);
  assert.equal(r.replayed, false); assert.equal(gw.calls.length, 1); assert.equal(gw.calls[0].amountPaise, 50000); assert.equal(gw.calls[0].paymentId, o.razorpayPaymentId); assert.match(gw.calls[0].idempotencyKey, /^rf_/);
  const d = orders.get(o._id); assert.equal(d.refunds.length, 1); assert.equal(d.refunds[0].status, 'created'); assert.match(d.refunds[0].refundId, /^rfnd_/); assert.equal(d.refunds[0].source, 'dashboard'); assert.equal(d.refunds[0].requestedBy, 'U1');
  assert.equal(d.paymentStatus, 'paid'); assert.equal(d.refundedPaise, 0); assert.equal(r.payment.displayStatus, 'refund_pending');
});
test('instantly processed refund marks the order refunded', async () => {
  reset(); gw.status = 'processed'; const o = mkOrder(), r = await full(o);
  const d = orders.get(o._id); assert.equal(d.refunds[0].status, 'processed'); assert.equal(d.refundedPaise, 50000); assert.equal(d.paymentStatus, 'refunded'); assert.equal(r.payment.displayStatus, 'refunded');
});
test('partial refund then the rest; amounts above what is left are refused and never reach Razorpay', async () => {
  reset(); gw.status = 'processed'; const o = mkOrder();
  await part(o, '120.50'); assert.equal(orders.get(o._id).refundedPaise, 12050); assert.equal(orders.get(o._id).paymentStatus, 'paid');
  await assert.rejects(part(o, '379.51'), (e) => e.code === 'validation_error' && /at most ₹379\.50/.test(e.fields.amount)); assert.equal(gw.calls.length, 1);
  await part(o, '379.50'); assert.equal(orders.get(o._id).refundedPaise, 50000); assert.equal(orders.get(o._id).paymentStatus, 'refunded'); assert.equal(gw.calls.length, 2);
  await rejects(part(o, '1'), 409, 'already_refunded');
});
test('only paid online orders: COD, unpaid, failed and missing payment id are refused without calling Razorpay', async () => {
  reset();
  await rejects(full(mkOrder({ paymentMethod: 'cod', paymentStatus: 'paid', razorpayPaymentId: null })), 400, 'not_online_order');
  for (const s of ['pending', 'failed', 'unpaid']) await rejects(full(mkOrder({ paymentStatus: s })), 409, 'not_paid');
  await rejects(full(mkOrder({ razorpayPaymentId: null })), 409, 'not_paid'); assert.equal(gw.calls.length, 0);
});
test('another store\'s order is simply "not found"; bad order numbers too', async () => {
  reset(); const o = mkOrder({ store: 'OTHER' });
  await rejects(full(o), 404, 'not_found'); await rejects(initiateRefund(store, user, 'abc', { type: 'full', idempotencyKey: key() }), 404); await rejects(initiateRefund(store, user, 5, { type: 'full', idempotencyKey: key() }), 404); assert.equal(gw.calls.length, 0);
  await rejects(retryRefund(store, o.orderNumber, key()), 404);
});
test('same request key twice (double click / reload): one refund, second call is a replay', async () => {
  reset(); const o = mkOrder(), kk = key(); const a = await full(o, kk), b = await full(o, kk);
  assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(orders.get(o._id).refunds.length, 1); assert.equal(gw.calls.length, 1);
  await rejects(part(o, '10', kk), 409, 'key_reused');
});
test('10 simultaneous identical clicks create exactly one refund and one gateway call', async () => {
  reset(); const o = mkOrder(), kk = key();
  const rs = await Promise.allSettled(Array.from({ length: 10 }, () => full(o, kk)));
  assert.ok(rs.every((x) => x.status === 'fulfilled' || (x.reason && [409].includes(x.reason.status))), 'each succeeds as a replay or is told to retry');
  assert.equal(orders.get(o._id).refunds.length, 1); assert.equal(gw.calls.filter((c) => c.amountPaise === 50000).length, 1);
});
test('10 simultaneous DIFFERENT requests: the money is promised once (only one refund in flight per order)', async () => {
  reset(); const o = mkOrder();
  const rs = await Promise.allSettled(Array.from({ length: 10 }, () => full(o)));
  assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1); assert.equal(orders.get(o._id).refunds.length, 1); assert.equal(gw.calls.length, 1);
  assert.ok(rs.filter((x) => x.status === 'rejected').every((x) => [409, 400].includes(x.reason.status)));
});
test('a second refund while one is in progress is refused until it finishes', async () => {
  reset(); const o = mkOrder(); await part(o, '100'); await rejects(part(o, '50'), 409, 'refund_in_progress'); assert.equal(gw.calls.length, 1);
  await applyToOrder(() => FakeOrder.findOne({ _id: o._id, store: 'S1' }), (x) => W.decideRefund(x, { id: orders.get(o._id).refunds[0].refundId, paymentId: o.razorpayPaymentId, amount: 10000, status: 'processed' }));
  assert.equal(orders.get(o._id).refundedPaise, 10000); await part(o, '50'); assert.equal(orders.get(o._id).refunds.length, 2);
});
test('Razorpay refuses: entry becomes failed, money is released, owner can try again with a new key', async () => {
  reset(); gw.mode = 'refuse'; const o = mkOrder();
  await rejects(full(o), 502, 'refund_rejected'); const e = orders.get(o._id).refunds[0]; assert.equal(e.status, 'failed'); assert.ok(e.error);
  gw.mode = 'ok'; await full(o); assert.equal(orders.get(o._id).refunds.length, 2); assert.equal(orders.get(o._id).refunds[1].status, 'created');
});
test('unknown outcome (timeout): entry stays reserved; retrying with the same key never refunds twice', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder(), kk = key();
  await rejects(full(o, kk), 503); const e = orders.get(o._id).refunds[0]; assert.equal(e.status, 'pending'); assert.equal(e.refundId, null);
  await rejects(part(o, '10'), 409, 'refund_in_progress'); // money stays reserved while the outcome is unknown
  const sentKey = gw.calls[0].idempotencyKey;
  gw.mode = 'ok'; const r = await retryRefund(store, o.orderNumber, kk);
  assert.equal(gw.calls.at(-1).idempotencyKey, sentKey, 'same gateway key on retry'); assert.equal(orders.get(o._id).refunds.length, 1); assert.equal(orders.get(o._id).refunds[0].status, 'created'); assert.equal(r.payment.displayStatus, 'refund_pending'); assert.equal(orders.get(o._id).refunds[0].error, '');
  await rejects(retryRefund(store, o.orderNumber, kk), 409, 'nothing_to_retry');
});
test('re-sending the same key after an unknown outcome works through "initiate" too (page reload, lost response)', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder(), kk = key(); await rejects(full(o, kk), 503); gw.mode = 'ok';
  const fresh = await full(o, kk); assert.equal(fresh.replayed, true); assert.equal(orders.get(o._id).refunds[0].status, 'pending', 'a very recent pending entry is not re-sent by a repeated click');
  orders.get(o._id).refunds[0].createdAt = new Date(Date.now() - 60000); // now it looks abandoned
  const r = await full(o, kk); assert.equal(r.replayed, true); assert.equal(orders.get(o._id).refunds.length, 1); assert.equal(orders.get(o._id).refunds[0].status, 'created');
});
test('a retry that Razorpay now refuses releases the reserved money', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder(), kk = key(); await rejects(full(o, kk), 503); gw.mode = 'refuse';
  await rejects(retryRefund(store, o.orderNumber, kk), 502); assert.equal(orders.get(o._id).refunds[0].status, 'failed'); gw.mode = 'ok'; await full(o);
});
test('webhook beats the API response: it adopts the pending entry, no duplicate, dashboard fields kept', async () => {
  reset(); gw.status = 'pending'; const o = mkOrder(), kk = key();
  const real = fakeGateway.createRefund;
  fakeGateway.createRefund = async (args) => { // while "Razorpay is answering", the refund.processed webhook is applied first
    const rf = { id: 'rfnd_Early00001', paymentId: o.razorpayPaymentId, amount: args.amountPaise, status: 'processed' };
    await applyToOrder(() => FakeOrder.findOne({ _id: o._id, store: 'S1' }), (x) => W.decideRefund(x, rf));
    return { id: rf.id, paymentId: rf.paymentId, amount: rf.amount, status: 'pending' };
  };
  try { await initiateRefund(store, user, o.orderNumber, { type: 'full', reason: 'Damaged', idempotencyKey: kk }); } finally { fakeGateway.createRefund = real; }
  const d = orders.get(o._id); assert.equal(d.refunds.length, 1, 'one entry'); assert.equal(d.refunds[0].status, 'processed', 'a late "pending" answer never downgrades processed'); assert.equal(d.refunds[0].reason, 'Damaged'); assert.equal(d.refunds[0].idempotencyKey, kk); assert.equal(d.paymentStatus, 'refunded');
});
test('compare-and-set: an order changed between read and reserve is re-read and re-validated', async () => {
  reset(); const o = mkOrder();
  FakeOrder.afterRead = (d) => { d.paymentRev += 1; d.refunds = [{ refundId: 'rfnd_Other00001', amountPaise: 49000, status: 'processed' }]; d.refundedPaise = 49000; };
  await assert.rejects(part(o, '100'), (e) => e.code === 'validation_error' && /at most ₹10\.00/.test(e.fields.amount)); assert.equal(gw.calls.length, 0);
});
test('gateway answers with a different amount: nothing is guessed, entry stays reserved and flagged', async () => {
  reset(); gw.amountOverride = 1; const o = mkOrder();
  await rejects(full(o), 502, 'gateway_mismatch'); const e = orders.get(o._id).refunds[0]; assert.equal(e.status, 'pending'); assert.ok(e.error); assert.equal(orders.get(o._id).refundedPaise, 0);
});
test('invalid input never reaches Razorpay', async () => {
  reset(); const o = mkOrder();
  for (const input of [{}, { type: 'partial', amount: '-5', idempotencyKey: key() }, { type: 'partial', amount: 'NaN', idempotencyKey: key() }, { type: 'full' }, { type: 'partial', amount: { $gt: 0 }, idempotencyKey: key() }]) await rejects(initiateRefund(store, user, o.orderNumber, input), 400, 'validation_error');
  assert.equal(gw.calls.length, 0); assert.equal(orders.get(o._id).refunds.length, 0);
});
