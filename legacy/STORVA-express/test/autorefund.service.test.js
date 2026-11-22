'use strict';
// The REAL services/autoRefund.js + refunds.js + webhooks.js + refundEvents.js against IN-MEMORY FAKES of Order and a FAKE Razorpay refund API.
// Proves: exactly one refund per cancelled paid order (even with parallel triggers), correct handling of refused / unknown / pending refunds,
// retries with the same key, verification, notifications events, and that manual refunds still work. No MongoDB needed; not a substitute for a real-database run.
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
    if (v && typeof v === 'object' && !(v instanceof Date)) { if ('$exists' in v) return (d[k] !== undefined) === v.$exists; if ('$in' in v) return v.$in.includes(d[k]); if ('$ne' in v) return d[k] !== v.$ne; }
    return v === null ? d[k] == null : d[k] === v;
  });
}
const FakeOrder = {
  findOne(f) { const q = { setOptions() { return q; }, catch() { return q.then(); }, then(res, rej) { return (async () => { await tick(); const d = [...orders.values()].find((x) => matches(x, f)); return d ? clone(d) : null; })().then(res, rej); } }; return q; },
  async updateOne(f, u) { await tick(); if (!f.store) throw new Error('Tenant guard: updateOne without store'); const d = [...orders.values()].find((x) => matches(x, f)); if (!d) return { matchedCount: 0 };
    if (u.$set) Object.assign(d, clone(u.$set)); if (u.$push) for (const [k, v] of Object.entries(u.$push)) d[k] = [...(d[k] || []), clone(v)]; for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; return { matchedCount: 1 }; },
};
const gw = { calls: [], seen: new Map(), mode: 'ok', status: 'pending', nextId: 1, remote: new Map() };
const AppError = require('../src/utils/AppError');
const fakeGateway = {
  async createOrder() { throw new Error('not used'); },
  async createRefund(args) {
    gw.calls.push(args); await tick();
    if (gw.mode === 'refuse') { const e = new AppError('refused', 502, 'refund_rejected'); e.definite = true; throw e; }
    if (gw.mode === 'down') { const e = new AppError('down', 503, 'gateway_unreachable'); e.definite = false; throw e; }
    if (gw.seen.has(args.idempotencyKey)) return gw.seen.get(args.idempotencyKey); // Razorpay replays the original answer for a repeated key
    const r = { id: 'rfnd_Gw' + String(gw.nextId++).padStart(6, '0'), paymentId: args.paymentId, amount: args.amountPaise, status: gw.status }; gw.seen.set(args.idempotencyKey, r); gw.remote.set(r.id, r); return r;
  },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req.endsWith('/models/Order')) return FakeOrder;
  if (req.endsWith('/models/WebhookEvent')) return { async create() {}, async findOneAndUpdate() { return null; }, async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };
  if (req.endsWith('/services/razorpayApi') || req === './razorpayApi') return fakeGateway;
  if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } }
  return origLoad.call(this, req, ...a);
};
const refunds = require('../src/services/refunds');
const auto = require('../src/services/autoRefund');
const events = require('../src/services/events');
const { applyToOrder } = require('../src/services/webhooks');
const W = require('../src/utils/razorpayWebhook');
const refundEvents = require('../src/services/refundEvents');
Module._load = origLoad;

const store = { _id: 'S1', slug: 'shop' };
const seen = []; events.on('*', (p, name) => { seen.push({ name, ...p }); });
const names = () => seen.map((e) => e.name);
function mkOrder(extra = {}) {
  const id = 'o' + (++seq) + '0000000000000000000000'.slice(0, 20), o = { _id: id, store: 'S1', orderNumber: 1000 + seq, paymentMethod: 'razorpay', paymentStatus: 'paid', status: 'cancelled', totalPaise: 50000, paymentRev: 1, razorpayOrderId: 'order_T' + seq, razorpayPaymentId: 'pay_Test' + String(seq).padStart(6, '0'), refunds: [], refundedPaise: 0, customer: { name: 'A', phone: '1' }, ...extra };
  orders.set(id, o); return o;
}
let clock = Date.now();
// verify stand-in for reconciliation: reads the fake Razorpay state of the order's refunds and records it through the same pure decision, then announces.
async function verify(order) {
  const before = await FakeOrder.findOne({ _id: order._id, store: order.store });
  for (const e of before.refunds.filter((x) => x.refundId && ['created', 'pending'].includes(x.status))) {
    const g = gw.remote.get(e.refundId); if (!g) continue;
    await applyToOrder(() => FakeOrder.findOne({ _id: order._id, store: order.store }), (o) => W.decideRefund(o, { id: g.id, paymentId: o.razorpayPaymentId, amount: g.amount, status: g.status === 'processed' ? 'processed' : g.status === 'failed' ? 'failed' : 'created' }));
  }
  refundEvents.announce(before, await FakeOrder.findOne({ _id: order._id, store: order.store }));
}
const deps = (over = {}) => ({ Order: FakeOrder, Store: { async findById() { return store; } }, refunds, verify, enabled: () => true, settings: () => ({ maxAttempts: 3, retryBackoffMs: 15 * 60 * 1000, verifyAfterMs: 5 * 60 * 1000 }), now: () => clock, ...over });
const reset = () => { gw.calls = []; gw.seen.clear(); gw.remote.clear(); gw.mode = 'ok'; gw.status = 'pending'; seen.length = 0; clock = Date.now(); };
const get = (o) => orders.get(o._id);
const MIN = 60 * 1000;

test('cancelled paid online order: ONE full automatic refund, recorded with source auto, buyer/owner event raised', async () => {
  reset(); const o = mkOrder(), r = await auto.processOrder('S1', o._id, deps());
  assert.equal(r.outcome, 'started'); assert.equal(gw.calls.length, 1); assert.equal(gw.calls[0].amountPaise, 50000); assert.equal(gw.calls[0].paymentId, o.razorpayPaymentId);
  const d = get(o); assert.equal(d.refunds.length, 1); assert.equal(d.refunds[0].source, 'auto'); assert.equal(d.refunds[0].status, 'created'); assert.equal(d.refunds[0].requestedBy, null); assert.match(d.refunds[0].idempotencyKey, /^auto-/);
  assert.equal(d.paymentStatus, 'paid'); // not refunded until Razorpay says processed
  assert.ok(names().includes('order.refund_initiated')); assert.equal(seen.find((e) => e.name === 'order.refund_initiated').auto, true);
});

test('instantly processed: order and payment become refunded, buyer told, never refunded again', async () => {
  reset(); gw.status = 'processed'; const o = mkOrder();
  await auto.processOrder('S1', o._id, deps());
  const d = get(o); assert.equal(d.paymentStatus, 'refunded'); assert.equal(d.refundedPaise, 50000); assert.ok(names().includes('order.refunded'));
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'none:already_refunded'); assert.equal(gw.calls.length, 1);
});

test('five parallel triggers (cancel event + sweep + second server) create exactly one refund', async () => {
  reset(); const o = mkOrder();
  await Promise.allSettled(Array.from({ length: 5 }, () => auto.processOrder('S1', o._id, deps())));
  assert.equal(get(o).refunds.length, 1); assert.equal(new Set(gw.calls.map((c) => c.idempotencyKey)).size, 1); assert.equal(gw.remote.size, 1);
});

test('not eligible: COD, unpaid, failed, not cancelled, other store: no Razorpay call', async () => {
  reset();
  const cases = [mkOrder({ paymentMethod: 'cod', razorpayPaymentId: null }), mkOrder({ paymentStatus: 'pending' }), mkOrder({ paymentStatus: 'failed' }), mkOrder({ status: 'confirmed' }), mkOrder({ status: 'shipped' })];
  for (const o of cases) assert.match((await auto.processOrder('S1', o._id, deps())).outcome, /^none:/);
  const other = mkOrder({ store: 'OTHER' }); assert.equal((await auto.processOrder('S1', other._id, deps())).outcome, 'order_not_found');
  assert.equal(gw.calls.length, 0);
});

test('kill switch: AUTO_REFUND_ENABLED=false does nothing', async () => {
  reset(); const o = mkOrder(); assert.equal((await auto.processOrder('S1', o._id, deps({ enabled: () => false }))).outcome, 'disabled'); assert.equal(gw.calls.length, 0);
});

test('only the money still owed is refunded after an earlier manual partial refund', async () => {
  reset(); const o = mkOrder({ refunds: [{ refundId: 'rfnd_Prev123456', amountPaise: 20000, status: 'processed', source: 'dashboard', createdAt: new Date(), updatedAt: new Date() }], refundedPaise: 20000 });
  await auto.processOrder('S1', o._id, deps()); assert.equal(gw.calls[0].amountPaise, 30000);
});

test('Razorpay refuses: attempt marked failed, owner event, back-off, then a NEW attempt; success after a retry refunds once in total', async () => {
  reset(); gw.mode = 'refuse'; const o = mkOrder();
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'refused');
  assert.equal(get(o).refunds[0].status, 'failed'); assert.ok(names().includes('order.refund_failed')); assert.equal(seen.find((e) => e.name === 'order.refund_failed').final, false);
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'wait:backoff'); assert.equal(gw.calls.length, 1);
  clock += 20 * MIN; gw.mode = 'ok'; gw.status = 'processed';
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'started');
  const d = get(o); assert.equal(d.refunds.length, 2); assert.notEqual(d.refunds[0].idempotencyKey, d.refunds[1].idempotencyKey); assert.equal(d.paymentStatus, 'refunded'); assert.equal(d.refundedPaise, 50000);
});

test('every attempt refused: exhausted once, owner (and buyer) alerted, no more calls, manual refund still possible', async () => {
  reset(); gw.mode = 'refuse'; const o = mkOrder();
  for (let i = 0; i < 3; i++) { await auto.processOrder('S1', o._id, deps()); clock += 3 * 60 * MIN; }
  assert.equal(gw.calls.length, 3); assert.equal(get(o).refunds.length, 3);
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'exhausted'); assert.equal(get(o).autoRefundExhausted, true);
  assert.equal(seen.filter((e) => e.name === 'order.refund_failed' && e.final).length, 1);
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'none:exhausted'); assert.equal(gw.calls.length, 3);
  gw.mode = 'ok'; gw.status = 'processed'; // the owner steps in
  const m = await refunds.initiateRefund(store, { _id: 'U1' }, o.orderNumber, { type: 'full', idempotencyKey: 'manual-key-0000000001' });
  assert.equal(m.payment.displayStatus, 'refunded'); assert.equal(get(o).refunds.at(-1).source, 'dashboard');
});

test('unknown outcome (Razorpay unreachable): stays reserved; the sweep re-sends the SAME key and Razorpay refunds once', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder();
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'unknown_will_retry');
  assert.equal(get(o).refunds[0].status, 'pending'); assert.equal(get(o).refunds[0].refundId, null);
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'wait:request_in_flight'); // just started: do not hammer
  clock += MIN; gw.mode = 'ok';
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'retried');
  assert.equal(get(o).refunds.length, 1); assert.equal(get(o).refunds[0].status, 'created'); assert.equal(gw.remote.size, 1);
  assert.equal(new Set(gw.calls.map((c) => c.idempotencyKey)).size, 1);
});

test('pending at Razorpay is verified later: processed -> order refunded and buyer told; failed -> retried automatically', async () => {
  reset(); const o = mkOrder(); await auto.processOrder('S1', o._id, deps());
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'wait:refund_in_progress'); // too soon to ask
  clock += 6 * MIN; seen.length = 0; gw.remote.get(get(o).refunds[0].refundId).status = 'processed';
  assert.equal((await auto.processOrder('S1', o._id, deps())).outcome, 'verified');
  assert.equal(get(o).paymentStatus, 'refunded'); assert.ok(names().includes('order.refunded'));

  reset(); const o2 = mkOrder(); await auto.processOrder('S1', o2._id, deps());
  clock += 6 * MIN; seen.length = 0; gw.remote.get(get(o2).refunds[0].refundId).status = 'failed';
  await auto.processOrder('S1', o2._id, deps()); assert.equal(get(o2).refunds[0].status, 'failed'); assert.ok(names().includes('order.refund_failed'));
  clock += 20 * MIN; gw.status = 'processed'; assert.equal((await auto.processOrder('S1', o2._id, deps())).outcome, 'started');
  assert.equal(get(o2).paymentStatus, 'refunded');
});

test('sweep picks up cancelled paid orders missed by the event (crash / late capture) and reports', async () => {
  reset();
  const o = mkOrder(), D = deps({ Order: { ...FakeOrder, find() { const q = { setOptions() { return q; }, sort() { return q; }, limit() { return Promise.resolve([...orders.values()].filter((x) => x._id === o._id && x.status === 'cancelled' && x.paymentStatus === 'paid' && x.razorpayPaymentId && !x.autoRefundExhausted).map(clone)); } }; return q; } } });
  const rep = await auto.sweep({}, D); assert.equal(rep.started >= 1, true); assert.equal(get(o).refunds.length, 1); assert.equal(rep.errors, 0);
});

test('a request cannot claim to be an automatic refund: source comes only from the server', async () => {
  reset(); const o = mkOrder({ status: 'confirmed' });
  await refunds.initiateRefund(store, { _id: 'U1' }, o.orderNumber, { type: 'full', source: 'auto', idempotencyKey: 'spoof-key-000000000001' });
  assert.equal(get(o).refunds[0].source, 'dashboard'); assert.equal(get(o).refunds[0].requestedBy, 'U1');
});

test('manual refund of a cancelled order still works exactly as before (replay-safe)', async () => {
  reset(); gw.status = 'processed'; const o = mkOrder({ status: 'cancelled' });
  const k = 'manual-key-0000000002', a = await refunds.initiateRefund(store, { _id: 'U1' }, o.orderNumber, { type: 'full', idempotencyKey: k }), b = await refunds.initiateRefund(store, { _id: 'U1' }, o.orderNumber, { type: 'full', idempotencyKey: k });
  assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(gw.calls.length, 1);
});
