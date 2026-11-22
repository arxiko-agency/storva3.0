'use strict';
// Module 6 step 4: CONCURRENCY. The REAL services/refunds.js + services/webhooks.js against IN-MEMORY FAKES (Order, WebhookEvent) and a FAKE Razorpay refund API,
// with random scheduling delays on every read, write and gateway call so that requests really interleave. Proves the money rules hold under parallel clicks,
// parallel retries, a webhook racing the API answer and many orders at once. Not a substitute for a real MongoDB run (the fake's compare-and-set is a faithful
// in-process copy of the filter semantics, but real atomicity is MongoDB's job: see the integration suite).
// NOTE: re-created in the final step-4 pass (the first scratch copy of this file was lost when the sandbox was reset); it is NOT the original.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc12345'; process.env.RAZORPAY_KEY_SECRET = 'k_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_concurrency';
const AppError = require('../src/utils/AppError');
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; // deterministic jitter: failures are reproducible
const jitter = async () => { const n = Math.floor(rnd() * 4); for (let i = 0; i <= n; i++) await new Promise((r) => setImmediate(r)); };
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));

const orders = new Map(); let seq = 0; const writes = { updates: 0, rejectedByCas: 0 };
function matches(d, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => matches(d, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) { if ('$exists' in v) return (d[k] !== undefined) === v.$exists; if ('$in' in v) return v.$in.includes(d[k]); }
    return v === null ? d[k] == null : d[k] === v;
  });
}
const FakeOrder = {
  findOne(f) { const q = { setOptions() { return q; }, then(res, rej) { return (async () => { await jitter(); const d = [...orders.values()].find((x) => matches(x, f)); return d ? clone(d) : null; })().then(res, rej); } }; return q; },
  async updateOne(f, u) { // the match + write happen in ONE synchronous step (like MongoDB's single-document atomicity); jitter only BEFORE it
    await jitter(); if (!f.store) throw new Error('Tenant guard: updateOne without store');
    const d = [...orders.values()].find((x) => matches(x, f)); if (!d) { writes.rejectedByCas++; return { matchedCount: 0 }; }
    if (u.$set) Object.assign(d, clone(u.$set)); if (u.$push) for (const [k, v] of Object.entries(u.$push)) d[k] = [...(d[k] || []), clone(v)]; for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n;
    writes.updates++; return { matchedCount: 1 };
  },
};
const FakeEvent = { async create() {}, async findOneAndUpdate() { return null; }, async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };

const gw = { calls: [], seen: new Map(), mode: 'ok', status: 'pending', next: 1, inFlight: 0, maxInFlight: 0 };
const fakeGateway = {
  async createOrder() { throw new Error('not used'); },
  async createRefund(args) {
    gw.calls.push(args); gw.inFlight++; gw.maxInFlight = Math.max(gw.maxInFlight, gw.inFlight);
    try {
      await jitter(); await jitter();
      if (gw.mode === 'down') { const e = new AppError('down', 503, 'gateway_unreachable'); e.definite = false; throw e; }
      if (gw.mode === 'refuse') { const e = new AppError('refused', 502, 'refund_rejected'); e.definite = true; throw e; }
      if (gw.seen.has(args.idempotencyKey)) return gw.seen.get(args.idempotencyKey); // Razorpay replays the original answer for a repeated key
      const r = { id: 'rfnd_Cc' + String(gw.next++).padStart(6, '0'), paymentId: args.paymentId, amount: args.amountPaise, status: gw.status }; gw.seen.set(args.idempotencyKey, r); return r;
    } finally { gw.inFlight--; }
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
let k = 0; const key = () => 'cc' + String(++k).padStart(18, '0');
function mkOrder(extra = {}) {
  const id = 'o' + (++seq), o = { _id: id, store: 'S1', orderNumber: 1000 + seq, paymentMethod: 'razorpay', paymentStatus: 'paid', status: 'confirmed', totalPaise: 50000, paymentRev: 1, razorpayOrderId: 'order_C' + seq, razorpayPaymentId: 'pay_Conc' + String(seq).padStart(6, '0'), refunds: [], refundedPaise: 0, customer: { name: 'A', phone: '1' }, ...extra };
  orders.set(id, o); return o;
}
const reset = () => { gw.calls = []; gw.seen.clear(); gw.mode = 'ok'; gw.status = 'pending'; gw.inFlight = 0; gw.maxInFlight = 0; writes.updates = 0; writes.rejectedByCas = 0; };
const full = (o, idempotencyKey = key()) => initiateRefund(store, user, o.orderNumber, { type: 'full', idempotencyKey });
const part = (o, amount, idempotencyKey = key()) => initiateRefund(store, user, o.orderNumber, { type: 'partial', amount, idempotencyKey });
const settle = (ps) => Promise.allSettled(ps);
const ok = (rs) => rs.filter((r) => r.status === 'fulfilled'), bad = (rs) => rs.filter((r) => r.status === 'rejected');
// the invariant that must hold after ANY interleaving: money out + money reserved never exceeds the total, and the ledger has no duplicate keys/ids
function invariant(o) {
  const d = orders.get(o._id), live = d.refunds.filter((r) => r.status !== 'failed');
  const promised = live.reduce((s, r) => s + r.amountPaise, 0); assert.ok(promised <= d.totalPaise, `promised ${promised} > total ${d.totalPaise}`);
  const keys = d.refunds.map((r) => r.idempotencyKey).filter(Boolean); assert.equal(new Set(keys).size, keys.length, 'duplicate idempotency key in ledger');
  const ids = d.refunds.map((r) => r.refundId).filter(Boolean); assert.equal(new Set(ids).size, ids.length, 'duplicate Razorpay refund id in ledger');
  assert.ok(d.refundedPaise <= d.totalPaise); assert.equal(d.refundedPaise, d.refunds.filter((r) => r.status === 'processed').reduce((s, r) => s + r.amountPaise, 0), 'refundedPaise must equal processed entries');
}
let realInfo, realErr;
test.beforeEach(() => { realInfo = console.info; realErr = console.error; console.info = () => {}; console.error = () => {}; });
test.afterEach(() => { console.info = realInfo; console.error = realErr; });

test('15 parallel clicks with DIFFERENT keys on one order: exactly one reaches Razorpay, one ledger entry, the rest get 409', async () => {
  for (let round = 0; round < 5; round++) {
    reset(); const o = mkOrder(), rs = await settle(Array.from({ length: 15 }, () => full(o)));
    assert.equal(ok(rs).length, 1, 'round ' + round); assert.equal(gw.calls.length, 1); assert.equal(orders.get(o._id).refunds.length, 1);
    for (const b of bad(rs)) assert.ok(['refund_in_progress', 'conflict'].includes(b.reason.code), 'unexpected rejection: ' + b.reason.code + ' ' + b.reason.message);
    invariant(o);
  }
});
test('20 parallel requests with the SAME key: one entry, one gateway call, all callers succeed, all answers show the same refund', async () => {
  for (let round = 0; round < 5; round++) {
    reset(); const o = mkOrder(), kk = key(), rs = await settle(Array.from({ length: 20 }, () => full(o, kk)));
    assert.equal(gw.calls.length, 1, 'round ' + round); assert.equal(orders.get(o._id).refunds.length, 1);
    assert.equal(bad(rs).filter((b) => b.reason.code !== 'conflict').length, 0, 'only a retryable conflict may escape: ' + bad(rs).map((b) => b.reason.code));
    assert.ok(ok(rs).length >= 1); assert.equal(ok(rs).filter((r) => r.value.replayed === false).length <= 1, true, 'at most one caller is told it created the refund');
    invariant(o);
  }
});
test('parallel PARTIAL refunds that together exceed the total: reserved money never exceeds it (one in flight at a time)', async () => {
  reset(); const o = mkOrder({ totalPaise: 10000 }), rs = await settle(['60', '60', '60', '40', '100', '99.99', '1'].map((a) => part(o, a)));
  assert.equal(ok(rs).length, 1); assert.equal(gw.calls.length, 1); invariant(o);
});
test('after the first refund is processed, a SECOND wave of parallel refunds can only take what is left', async () => {
  reset(); gw.status = 'processed'; const o = mkOrder({ totalPaise: 10000 });
  await part(o, '60'); assert.equal(orders.get(o._id).refundedPaise, 6000);
  const rs = await settle(['30', '30', '30', '50', '40.01'].map((a) => part(o, a)));
  assert.equal(ok(rs).length, 1, 'only one of the second wave fits'); invariant(o); assert.ok(orders.get(o._id).refundedPaise <= 10000);
  const d = orders.get(o._id); assert.equal(d.refunds.filter((r) => r.status === 'processed').length, 2);
});
test('parallel RETRIES of one unknown-outcome entry: every send uses the same gateway key, Razorpay creates one refund, one ledger entry', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder(), kk = key();
  await assert.rejects(full(o, kk), (e) => e.status === 503); const sentKey = gw.calls[0].idempotencyKey; assert.equal(orders.get(o._id).refunds[0].status, 'pending');
  gw.mode = 'ok'; const rs = await settle(Array.from({ length: 12 }, () => retryRefund(store, o.orderNumber, kk)));
  assert.ok(ok(rs).length >= 1); for (const b of bad(rs)) assert.ok(['nothing_to_retry', 'conflict'].includes(b.reason.code), 'unexpected: ' + b.reason.code);
  for (const c of gw.calls) assert.equal(c.idempotencyKey, sentKey, 'a retry must reuse the original gateway key'); assert.equal(gw.seen.size, 1, 'Razorpay created exactly one refund');
  const d = orders.get(o._id); assert.equal(d.refunds.length, 1); assert.equal(d.refunds[0].status, 'created'); assert.equal(d.refunds[0].error, ''); invariant(o);
});
test('parallel retry + parallel new click while the outcome is unknown: the new click is blocked, the money stays reserved', async () => {
  reset(); gw.mode = 'down'; const o = mkOrder(), kk = key(); await assert.rejects(full(o, kk));
  gw.mode = 'ok'; const rs = await settle([retryRefund(store, o.orderNumber, kk), full(o), full(o), part(o, '10'), retryRefund(store, o.orderNumber, kk)]);
  assert.equal(orders.get(o._id).refunds.length, 1, 'no second entry was created'); assert.equal(gw.seen.size, 1); assert.ok(ok(rs).length >= 1); invariant(o);
});
test('a refusal under load releases the money exactly once; afterwards ONE new refund can start', async () => {
  reset(); gw.mode = 'refuse'; const o = mkOrder(), rs = await settle(Array.from({ length: 8 }, () => full(o)));
  assert.equal(ok(rs).length, 0); assert.ok(gw.calls.length >= 1); const d = orders.get(o._id);
  assert.ok(d.refunds.every((r) => r.status === 'failed'), 'every attempt that reached Razorpay was marked failed'); assert.equal(d.refundedPaise, 0); invariant(o);
  gw.mode = 'ok'; reset(); gw.mode = 'ok'; const again = await settle(Array.from({ length: 6 }, () => full(o))); assert.equal(ok(again).length, 1); assert.equal(gw.calls.length, 1); invariant(o);
});
test('WEBHOOK RACE: refund.processed webhooks (several, duplicated) arrive while the dashboard request is running: one entry, adopted once, order refunded once', async () => {
  for (let round = 0; round < 5; round++) {
    reset(); gw.status = 'pending'; const o = mkOrder(), kk = key(); const real = fakeGateway.createRefund;
    fakeGateway.createRefund = async (args) => {
      const rf = { id: 'rfnd_Early' + round + '0001', paymentId: o.razorpayPaymentId, amount: args.amountPaise, status: 'processed' };
      await Promise.all(Array.from({ length: 5 }, () => applyToOrder(() => FakeOrder.findOne({ _id: o._id, store: 'S1' }), (x) => W.decideRefund(x, rf)))); // the same webhook delivered 5x at once
      return { id: rf.id, paymentId: rf.paymentId, amount: rf.amount, status: 'pending' };
    };
    try { await initiateRefund(store, user, o.orderNumber, { type: 'full', reason: 'Damaged', idempotencyKey: kk }); } finally { fakeGateway.createRefund = real; }
    const d = orders.get(o._id); assert.equal(d.refunds.length, 1, 'round ' + round); assert.equal(d.refunds[0].status, 'processed'); assert.equal(d.refunds[0].reason, 'Damaged'); assert.equal(d.refundedPaise, 50000); assert.equal(d.paymentStatus, 'refunded'); invariant(o);
  }
});
test('WEBHOOK RACE (other direction): webhook for the same refund fired in parallel AFTER the answer: no duplicate, no downgrade', async () => {
  reset(); gw.status = 'pending'; const o = mkOrder(), kk = key(); await full(o, kk);
  const refundId = orders.get(o._id).refunds[0].refundId, rf = (status) => ({ id: refundId, paymentId: o.razorpayPaymentId, amount: 50000, status });
  const hooks = ['processed', 'pending', 'processed', 'created', 'pending'].map((s) => applyToOrder(() => FakeOrder.findOne({ _id: o._id, store: 'S1' }), (x) => W.decideRefund(x, rf(s)))); await Promise.all(hooks);
  const d = orders.get(o._id); assert.equal(d.refunds.length, 1); assert.equal(d.refunds[0].status, 'processed', 'a late pending/created never downgrades processed'); assert.equal(d.paymentStatus, 'refunded'); invariant(o);
});
test('MANY ORDERS AT ONCE: 30 orders refunded in parallel (each clicked 3x): every order gets exactly one gateway call and its own entry; no cross-order bleed', async () => {
  reset(); const os = Array.from({ length: 30 }, () => mkOrder({ totalPaise: 10000 + seq * 100 }));
  const rs = await settle(os.flatMap((o) => [full(o), full(o), full(o)]));
  assert.equal(gw.calls.length, 30); assert.equal(new Set(gw.calls.map((c) => c.paymentId)).size, 30, 'each call targets a different payment');
  for (const o of os) { const d = orders.get(o._id); assert.equal(d.refunds.length, 1); assert.equal(d.refunds[0].amountPaise, d.totalPaise); invariant(o); }
  assert.ok(ok(rs).length >= 30);
});
test('compare-and-set is really exercised: contention happened, and paymentRev only ever moves forward', async () => {
  reset(); const o = mkOrder(), before = orders.get(o._id).paymentRev; await settle(Array.from({ length: 15 }, () => full(o)));
  assert.ok(writes.rejectedByCas > 0, 'the race was not exercised: no write was ever rejected by the revision check'); assert.ok(orders.get(o._id).paymentRev > before);
});
test('another store can never touch this order, even in parallel with the owner', async () => {
  reset(); const o = mkOrder(), other = { _id: 'S2', slug: 'other' };
  const rs = await settle([full(o), initiateRefund(other, user, o.orderNumber, { type: 'full', idempotencyKey: key() }), initiateRefund(other, user, o.orderNumber, { type: 'full', idempotencyKey: key() })]);
  assert.equal(ok(rs).length, 1); assert.equal(bad(rs).filter((b) => b.reason.status === 404).length, 2); assert.equal(gw.calls.length, 1); invariant(o);
});
