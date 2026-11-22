'use strict';
// Module 6 step 4 part 2: the REAL services/reconciliation.js + services/webhooks.js run against IN-MEMORY FAKES of Order / ReconciliationIssue / WebhookEvent
// and a FAKE Razorpay read API. Proves the logic (no downgrade, idempotency, races, logging) WITHOUT MongoDB. Not a substitute for a real-database run:
// the fake ignores date filters in find() (those are covered by the filter-vs-predicate test in the unit file).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc12345'; process.env.RAZORPAY_KEY_SECRET = 'k_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_service_test';
const AppError = require('../src/utils/AppError');
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
const MIN = 60000;
const ago = (ms) => new Date(Date.now() - ms);

// ----- fake Order -----
const orders = new Map(); let seq = 0;
function matches(d, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => matches(d, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) { if ('$exists' in v) return (d[k] !== undefined) === v.$exists; if ('$in' in v) return v.$in.includes(d[k]); }
    return v === null ? d[k] == null : d[k] === v;
  });
}
const FakeOrder = {
  find(f) { // the cross-store platform scan: only paymentMethod / paymentStatus are honoured here
    let rows = [...orders.values()].filter((d) => d.paymentMethod === f.paymentMethod && (f.paymentStatus && f.paymentStatus.$in ? f.paymentStatus.$in.includes(d.paymentStatus) : d.paymentStatus === f.paymentStatus));
    const q = { setOptions(o) { if (!o || !o.skipTenant) throw new Error('platform scan must opt out of the tenant guard explicitly'); return q; }, sort() { return q; }, limit(n) { rows = rows.slice(0, n); return q; }, then(res, rej) { return Promise.resolve(rows.map(clone)).then(res, rej); } };
    return q;
  },
  findOne(f) { return (async () => { await tick(); if (!f.store) throw new Error('Tenant guard: findOne without store'); const d = [...orders.values()].find((x) => matches(x, f)); const snap = d ? clone(d) : null; if (d && FakeOrder.afterRead) { const h = FakeOrder.afterRead; FakeOrder.afterRead = null; h(d); } return snap; })(); },
  async updateOne(f, u) {
    await tick(); if (!f.store) throw new Error('Tenant guard: updateOne without store'); const d = [...orders.values()].find((x) => matches(x, f)); if (!d) return { matchedCount: 0 };
    if (u.$set) Object.assign(d, clone(u.$set)); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n; d.writes = (d.writes || 0) + 1; return { matchedCount: 1 };
  },
};
// ----- fake ReconciliationIssue -----
const issues = []; let iseq = 0;
const imatch = (d, f) => Object.entries(f).every(([k, v]) => { if (v && typeof v === 'object') { if ('$in' in v) return v.$in.includes(d[k]); if ('$nin' in v) return !v.$nin.includes(d[k]); } return d[k] === v; });
const FakeIssue = {
  async updateOne(f, u, o = {}) {
    await tick(); if (!f.store) throw new Error('Tenant guard: issue updateOne without store');
    let d = issues.find((x) => imatch(x, f)), created = false;
    if (!d) { if (!o.upsert) return { matchedCount: 0, upsertedCount: 0 }; d = { _id: (++iseq).toString(16).padStart(24, '0'), store: f.store, key: f.key, occurrences: 0, ...clone(u.$setOnInsert || {}) }; issues.push(d); created = true; }
    if (u.$set) Object.assign(d, clone(u.$set)); for (const [k, n] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + n;
    return { matchedCount: created ? 0 : 1, upsertedCount: created ? 1 : 0 };
  },
  async updateMany(f, u) { await tick(); if (!f.store) throw new Error('Tenant guard: issue updateMany without store'); const hit = issues.filter((x) => imatch(x, f)); hit.forEach((d) => Object.assign(d, clone(u.$set))); return { matchedCount: hit.length }; },
  async findOneAndUpdate(f, u) { await tick(); if (!f.store) throw new Error('Tenant guard'); const d = issues.find((x) => imatch(x, f)); if (!d) return null; Object.assign(d, clone(u.$set)); return d; },
  find(f) { const rows = issues.filter((x) => imatch(x, f)).map((d) => ({ ...d, toOwnerApi: () => ({ id: d._id, orderNumber: d.orderNumber, code: d.code, message: d.message, detail: d.detail, occurrences: d.occurrences }) })); const q = { sort() { return q; }, limit() { return q; }, then(res, rej) { return Promise.resolve(rows).then(res, rej); } }; return q; },
};
const FakeEvent = { async create() {}, async findOneAndUpdate() { return null; }, async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };

// ----- fake Razorpay read API (answers are RAW gateway-shaped JSON, so the real parsing code is exercised) -----
const gw = { payments: {}, refunds: {}, calls: [], fail: null, onFetch: null };
const gwErr = (kind) => { const e = new AppError('gateway ' + kind, kind === 'transient' ? 503 : 502, 'gateway_' + kind); e.kind = kind; return e; };
const fakeGateway = {
  async createOrder() { throw new Error('reconciliation must never create orders'); },
  async createRefund() { throw new Error('reconciliation must never create refunds'); },
  async fetchOrderPayments(id) { gw.calls.push(['payments', id]); await tick(); if (gw.onFetch) await gw.onFetch(id); if (gw.fail) throw gwErr(gw.fail); return clone(gw.payments[id] || []); },
  async fetchPaymentRefunds(id) { gw.calls.push(['refunds', id]); await tick(); if (gw.onFetch) await gw.onFetch(id); if (gw.fail) throw gwErr(gw.fail); return clone(gw.refunds[id] || []); },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req.endsWith('/models/Order')) return FakeOrder;
  if (req.endsWith('/models/ReconciliationIssue')) return FakeIssue;
  if (req.endsWith('/models/WebhookEvent')) return FakeEvent;
  if (req.endsWith('/services/razorpayApi') || req === './razorpayApi') return fakeGateway;
  if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } }
  return origLoad.call(this, req, ...a);
};
const R = require('../src/services/reconciliation');
const { applyToOrder } = require('../src/services/webhooks');
const W = require('../src/utils/razorpayWebhook');
Module._load = origLoad;

const store = { _id: 'S1', slug: 'shop' }, user = { _id: 'U1' };
let n = 0;
function mkOrder(extra = {}) {
  const i = ++n, id = 'o' + i, o = { _id: id, store: 'S1', orderNumber: 1000 + i, paymentMethod: 'razorpay', paymentStatus: 'pending', status: 'confirmed', totalPaise: 50000, paymentRev: 0, razorpayOrderId: 'order_Rcn' + String(i).padStart(6, '0'), razorpayPaymentId: null, refunds: [], refundedPaise: 0, paidAt: null, paymentError: '', createdAt: ago(120 * MIN), reconcileCheckedAt: null, customer: { name: 'A', phone: '1' }, ...extra };
  orders.set(id, o); return o;
}
const rawPay = (o, over = {}) => ({ id: 'pay_Rcn' + String(o.orderNumber).padStart(6, '0'), order_id: o.razorpayOrderId, amount: o.totalPaise, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0, created_at: Math.floor(Date.now() / 1000) - 3600, ...over });
const rawRef = (o, over = {}) => ({ id: 'rfnd_Rcn' + String(o.orderNumber).padStart(6, '0'), payment_id: o.razorpayPaymentId, amount: o.totalPaise, status: 'processed', created_at: Math.floor(Date.now() / 1000) - 600, ...over });
const reset = () => { orders.clear(); issues.length = 0; gw.payments = {}; gw.refunds = {}; gw.calls = []; gw.fail = null; gw.onFetch = null; FakeOrder.afterRead = null; };
const gwPay = (o, ...list) => { gw.payments[o.razorpayOrderId] = list; };
const D = (o) => orders.get(o._id);
const stateOf = (o) => ({ s: D(o).paymentStatus, p: D(o).razorpayPaymentId, rev: D(o).paymentRev });
const codes = () => issues.map((i) => i.code);
let warnings; const realWarn = console.warn, realInfo = console.info, realErr = console.error;
test.beforeEach(() => { warnings = []; console.warn = (...a) => warnings.push(a.join(' ')); console.info = () => {}; console.error = () => {}; });
test.afterEach(() => { console.warn = realWarn; console.info = realInfo; console.error = realErr; });

// ===================== payments =====================
test('pending order that Razorpay shows as captured becomes paid (payment id, paidAt, error cleared); the scan marks it checked', async () => {
  reset(); const o = mkOrder({ paymentError: 'old failure' }); gwPay(o, rawPay(o));
  const s = await R.reconcileBatch();
  assert.equal(s.scanned, 1); assert.equal(s.applied, 1); assert.deepEqual(s.orders[0].changes, ['applied:paid']);
  const d = D(o); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.razorpayPaymentId, rawPay(o).id); assert.ok(d.paidAt instanceof Date); assert.equal(d.paymentError, ''); assert.equal(d.paymentRev, 1); assert.ok(d.reconcileCheckedAt);
  assert.equal(d.status, 'confirmed', 'order lifecycle status untouched'); assert.equal(issues.length, 0);
});
test('IDEMPOTENT: running again changes nothing and does not touch paymentRev; ten parallel runs apply it exactly once', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o)); await R.reconcileBatch();
  const after = stateOf(o); D(o).reconcileCheckedAt = null; // make it due again
  const s2 = await R.reconcileOrder(clone(D(o)), { now: new Date(), dryRun: false, t: {} }); assert.deepEqual(s2.changes, []); assert.deepEqual(stateOf(o), after);

  reset(); const p = mkOrder(); gwPay(p, rawPay(p));
  const runs = await Promise.all(Array.from({ length: 10 }, () => R.reconcileBatch()));
  assert.equal(runs.reduce((t, r) => t + r.applied, 0), 1, 'exactly one run applied it'); assert.equal(D(p).paymentRev, 1); assert.equal(D(p).paymentStatus, 'paid');
});
test('failed attempt only: order becomes failed with the gateway reason; a later success on the same order moves it forward to paid', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { status: 'failed', captured: false, error_description: 'Card declined' }));
  await R.reconcileBatch(); assert.equal(D(o).paymentStatus, 'failed'); assert.equal(D(o).paymentError, 'Card declined');
  D(o).reconcileCheckedAt = null; gwPay(o, rawPay(o, { status: 'failed', captured: false }), rawPay(o, { id: 'pay_Retry000001' }));
  await R.reconcileBatch(); assert.equal(D(o).paymentStatus, 'paid'); assert.equal(D(o).razorpayPaymentId, 'pay_Retry000001'); assert.equal(D(o).paymentError, '');
});
test('a payment still in progress (created) or merely authorized is not marked failed; authorized is reported for review', async () => {
  reset(); const a = mkOrder(), b = mkOrder();
  gwPay(a, rawPay(a, { status: 'failed', captured: false }), rawPay(a, { id: 'pay_Open000001', status: 'created', captured: false })); gwPay(b, rawPay(b, { status: 'authorized', captured: false }));
  await R.reconcileBatch(); assert.equal(D(a).paymentStatus, 'pending'); assert.equal(D(b).paymentStatus, 'pending'); assert.deepEqual(codes(), ['payment_authorized_not_captured']);
});
test('no payment attempt at Razorpay: stays pending, no issue, but it is marked checked so it is not asked again for a while', async () => {
  reset(); const o = mkOrder(); const s = await R.reconcileBatch();
  assert.equal(D(o).paymentStatus, 'pending'); assert.equal(issues.length, 0); assert.ok(D(o).reconcileCheckedAt); assert.equal(s.applied, 0);
  const calls = gw.calls.length; await R.reconcileBatch(); assert.equal(gw.calls.length, calls, 'checked a moment ago: not asked again');
});

// ===================== never downgrade =====================
test('NEVER DOWNGRADES: the buyer verify call pays the order while we are talking to Razorpay; our stale "failed" snapshot changes nothing', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { status: 'failed', captured: false }));
  gw.onFetch = async () => { Object.assign(D(o), { paymentStatus: 'paid', razorpayPaymentId: 'pay_Verified0001', paidAt: new Date() }); D(o).paymentRev += 1; };
  await R.reconcileBatch(); assert.deepEqual(stateOf(o), { s: 'paid', p: 'pay_Verified0001', rev: 1 });
});
test('NEVER DOWNGRADES: a webhook refunds the order meanwhile; a stale "captured" from Razorpay does not turn it back into paid', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o));
  gw.onFetch = async () => { Object.assign(D(o), { paymentStatus: 'refunded', razorpayPaymentId: rawPay(o).id, refundedPaise: 50000, refunds: [{ refundId: 'rfnd_Web000001', amountPaise: 50000, status: 'processed' }] }); D(o).paymentRev += 1; };
  await R.reconcileBatch(); assert.equal(D(o).paymentStatus, 'refunded'); assert.equal(D(o).refundedPaise, 50000);
});
test('NEVER DOWNGRADES: even a buggy decision cannot get through (safe net, with a deliberately unsafe decision injected)', async () => {
  reset(); const o = mkOrder({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Safe0000001', paymentRev: 3 });
  const X = require('../src/utils/reconcile'), evil = X.safeDecide(() => ({ action: 'apply', reason: 'evil', set: { paymentStatus: 'pending', razorpayPaymentId: null } }));
  const r = await applyToOrder(() => FakeOrder.findOne({ _id: o._id, store: 'S1' }), evil);
  assert.equal(r.outcome, 'ignored:would_downgrade'); assert.deepEqual(stateOf(o), { s: 'paid', p: 'pay_Safe0000001', rev: 3 });
});
test('paid and refunded orders are not even asked about payments; the gateway is not called for a fully refunded order', async () => {
  reset(); const paid = mkOrder({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Paid0000001' }), refunded = mkOrder({ paymentStatus: 'refunded', razorpayPaymentId: 'pay_Refd0000001', refundedPaise: 50000 });
  const s = await R.reconcileBatch(); assert.equal(s.scanned, 0); assert.equal(gw.calls.length, 0);
  const rep = await R.reconcileOrder(clone(refunded), { now: new Date(), dryRun: false, t: {} }); assert.equal(rep.skipped, 'nothing_to_check'); assert.equal(gw.calls.length, 0); assert.equal(D(paid).paymentStatus, 'paid');
});
test('selection: COD, unpaid cash, no Razorpay order, too young, recently checked and abandoned (30+ days) orders are left alone', async () => {
  reset(); const R1 = mkOrder({ paymentMethod: 'cod', paymentStatus: 'unpaid', razorpayOrderId: null }), none = mkOrder({ razorpayOrderId: null }), young = mkOrder({ createdAt: ago(3 * MIN) }), fresh = mkOrder({ reconcileCheckedAt: ago(5 * MIN) }), old = mkOrder({ createdAt: ago(40 * 24 * 60 * MIN) });
  const ok = mkOrder(); [R1, none, young, fresh, old].forEach((o) => { if (o.razorpayOrderId) gwPay(o, rawPay(o)); }); gwPay(ok, rawPay(ok));
  const s = await R.reconcileBatch(); assert.equal(s.scanned, 1); assert.equal(D(ok).paymentStatus, 'paid'); [R1, none, young, fresh, old].forEach((o) => assert.notEqual(D(o).paymentStatus, 'paid', 'order ' + o.orderNumber));
});

// ===================== anomalies are logged, not "fixed" =====================
test('amount mismatch: nothing changes, one issue row with fixed text and no customer data, one log line; a repeat run only counts occurrences', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { amount: 100 }));
  await R.reconcileBatch(); assert.equal(D(o).paymentStatus, 'pending'); assert.equal(issues.length, 1); assert.equal(issues[0].code, 'amount_mismatch'); assert.equal(issues[0].status, 'open'); assert.equal(issues[0].orderNumber, o.orderNumber);
  assert.ok(!JSON.stringify(issues).includes('"name":"A"') && !/phone/i.test(JSON.stringify(issues)), 'no customer data'); assert.equal(warnings.filter((w) => w.includes('DISCREPANCY')).length, 1);
  D(o).reconcileCheckedAt = null; await R.reconcileBatch(); assert.equal(issues.length, 1, 'no duplicate rows'); assert.equal(issues[0].occurrences, 2); assert.equal(warnings.filter((w) => w.includes('DISCREPANCY')).length, 1, 'logged once, not on every run');
});
test('two captured payments: the first is applied, the second is reported (money moved twice), the order is never re-pointed', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { id: 'pay_First000001', created_at: 1000 }), rawPay(o, { id: 'pay_Second00001', created_at: 2000 }));
  await R.reconcileBatch(); assert.deepEqual(stateOf(o), { s: 'paid', p: 'pay_First000001', rev: 1 }); assert.deepEqual(codes().sort(), ['multiple_captured_payments', 'second_payment_for_paid_order']);
});
test('a foreign payment, an unreadable record and a Razorpay "404" are reported without changing anything or blocking the good data', async () => {
  reset(); const o = mkOrder(), p = mkOrder(), q = mkOrder();
  gwPay(o, rawPay(o, { order_id: 'order_Foreign0001' })); gwPay(p, { id: 'garbage' }, rawPay(p)); gw.payments[q.razorpayOrderId] = null;
  const real = fakeGateway.fetchOrderPayments; fakeGateway.fetchOrderPayments = async (id) => { if (id === q.razorpayOrderId) throw gwErr('not_found'); return real(id); };
  try { await R.reconcileBatch(); } finally { fakeGateway.fetchOrderPayments = real; }
  assert.equal(D(o).paymentStatus, 'pending'); assert.equal(D(p).paymentStatus, 'paid', 'the readable captured payment is still applied'); assert.equal(D(q).paymentStatus, 'pending');
  assert.deepEqual(codes().sort(), ['foreign_payment', 'gateway_bad_response', 'gateway_order_not_found']); assert.ok(D(q).reconcileCheckedAt, '404 is an answer: checked');
});
test('issues close themselves when the problem goes away; a dismissed issue stays dismissed; the owner sees only their own store', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { status: 'authorized', captured: false }));
  await R.reconcileBatch(); assert.equal(issues[0].status, 'open'); assert.equal((await R.listIssues(store)).length, 1); assert.equal((await R.listIssues({ _id: 'S2' })).length, 0);
  gwPay(o, rawPay(o)); D(o).reconcileCheckedAt = null; await R.reconcileBatch();
  assert.equal(D(o).paymentStatus, 'paid'); assert.equal(issues[0].status, 'resolved'); assert.ok(issues[0].expireAt);

  reset(); const p = mkOrder(); gwPay(p, rawPay(p, { status: 'authorized', captured: false })); await R.reconcileBatch();
  await assert.rejects(R.dismissIssue({ _id: 'S2' }, user, issues[0]._id), (e) => e.status === 404); await assert.rejects(R.dismissIssue(store, user, 'zzz'), (e) => e.status === 404);
  await R.dismissIssue(store, user, issues[0]._id); assert.equal(issues[0].status, 'dismissed'); D(p).reconcileCheckedAt = null; await R.reconcileBatch(); assert.equal(issues[0].status, 'dismissed', 'not reopened'); assert.equal((await R.listIssues(store)).length, 0);
});
test('a resolved issue that comes back is reopened', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o, { status: 'authorized', captured: false })); await R.reconcileBatch();
  issues[0].status = 'resolved'; D(o).reconcileCheckedAt = null; await R.reconcileBatch(); assert.equal(issues.length, 1); assert.equal(issues[0].status, 'open');
});

// ===================== gateway trouble =====================
test('gateway timeout / 5xx: nothing changes, the order is NOT marked checked (retried next run); three in a row stop the run', async () => {
  reset(); const list = [mkOrder(), mkOrder(), mkOrder(), mkOrder(), mkOrder()]; list.forEach((o) => gwPay(o, rawPay(o))); gw.fail = 'transient';
  const s = await R.reconcileBatch(); assert.equal(s.aborted, 'gateway_unavailable'); assert.equal(s.scanned, 3); assert.equal(s.errors, 3);
  list.forEach((o) => { assert.equal(D(o).paymentStatus, 'pending'); assert.equal(D(o).reconcileCheckedAt, null); });
  gw.fail = null; const s2 = await R.reconcileBatch(); assert.equal(s2.applied, 5); assert.equal(s2.aborted, null);
});
test('Razorpay rejects our credentials: the whole run stops at once and nothing is written', async () => {
  reset(); const a = mkOrder(), b = mkOrder(); gwPay(a, rawPay(a)); gwPay(b, rawPay(b)); gw.fail = 'auth';
  const s = await R.reconcileBatch(); assert.equal(s.aborted, 'gateway_auth'); assert.equal(s.scanned, 1); assert.equal(D(a).paymentStatus, 'pending'); assert.equal(D(b).paymentStatus, 'pending'); assert.equal(issues.length, 0);
});
test('a failure on one order does not stop the others', async () => {
  reset(); const a = mkOrder(), b = mkOrder(); gwPay(a, rawPay(a)); gwPay(b, rawPay(b));
  const real = fakeGateway.fetchOrderPayments; fakeGateway.fetchOrderPayments = async (id) => { if (id === a.razorpayOrderId) throw new Error('boom'); return real(id); };
  let s; try { s = await R.reconcileBatch(); } finally { fakeGateway.fetchOrderPayments = real; }
  assert.equal(s.errors, 1); assert.equal(D(a).paymentStatus, 'pending'); assert.equal(D(b).paymentStatus, 'paid');
});
test('payments not configured: the batch does nothing', async () => {
  reset(); const { env } = require('../src/config/env'), keep = env.razorpay.keyId; env.razorpay.keyId = '';
  try { const s = await R.reconcileBatch(); assert.equal(s.aborted, 'payments_not_configured'); assert.equal(gw.calls.length, 0); } finally { env.razorpay.keyId = keep; }
});
test('dry run: reports what WOULD change but writes nothing (no order change, no checked mark, no issue row)', async () => {
  reset(); const a = mkOrder(), b = mkOrder(); gwPay(a, rawPay(a)); gwPay(b, rawPay(b, { amount: 1 }));
  const s = await R.reconcileBatch({ dryRun: true }); assert.deepEqual(s.orders.find((x) => x.orderNumber === a.orderNumber).changes, ['would_apply:paid']); assert.equal(s.dryRun, true);
  assert.deepEqual(stateOf(a), { s: 'pending', p: null, rev: 0 }); assert.equal(D(a).reconcileCheckedAt, null); assert.equal(D(a).writes, undefined); assert.equal(issues.length, 0); assert.ok(warnings.some((w) => w.includes('dry run') && w.includes('amount_mismatch')));
});
test('reconciliation only READS from Razorpay: the fake throws if it ever tries to create an order or a refund', async () => {
  reset(); const o = mkOrder(); gwPay(o, rawPay(o)); await R.reconcileBatch(); assert.ok(gw.calls.every((c) => ['payments', 'refunds'].includes(c[0])));
});

// ===================== a capture that was already refunded =====================
test('captured and then fully refunded at Razorpay while we missed both events: ends refunded (capture first, then the refund)', async () => {
  reset(); const o = mkOrder(), pid = rawPay(o).id;
  gwPay(o, rawPay(o, { status: 'refunded', captured: true, amount_refunded: 50000 })); gw.refunds[pid] = [rawRef({ ...o, razorpayPaymentId: pid })];
  const s = await R.reconcileBatch(); const d = D(o);
  assert.equal(d.paymentStatus, 'refunded'); assert.equal(d.refundedPaise, 50000); assert.equal(d.refunds.length, 1); assert.deepEqual(s.orders[0].changes, ['applied:paid', 'applied:fully_refunded']);
});

// ===================== refunds =====================
const rfEntry = (o, over = {}) => ({ refundId: 'rfnd_Rcn' + String(o.orderNumber).padStart(6, '0'), amountPaise: 20000, status: 'created', createdAt: ago(40 * MIN), updatedAt: ago(40 * MIN), source: 'dashboard', reason: 'Damaged', idempotencyKey: 'key' + 'x'.repeat(20), requestedBy: 'U1', error: '', ...over });
const paidWithRefund = (over = {}, entry = {}) => { const o = mkOrder({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Paid' + String(n + 1).padStart(6, '0'), paymentRev: 2, ...over }); o.refunds = [rfEntry(o, entry)]; return o; };
const gwRefund = (o, over = {}) => { gw.refunds[o.razorpayPaymentId] = [...(gw.refunds[o.razorpayPaymentId] || []), rawRef(o, { amount: 20000, ...over })]; };

test('refund stuck "created": Razorpay says processed -> processed; partial refund keeps the order paid, owner fields kept', async () => {
  reset(); const o = paidWithRefund(); gwRefund(o);
  const s = await R.reconcileBatch(); const d = D(o); assert.equal(s.scanned, 1); assert.equal(d.refunds[0].status, 'processed'); assert.equal(d.refundedPaise, 20000); assert.equal(d.paymentStatus, 'paid'); assert.equal(d.refunds[0].reason, 'Damaged'); assert.equal(d.refunds.length, 1);
});
test('refund processed for the full amount: order becomes refunded', async () => {
  reset(); const o = paidWithRefund({}, { amountPaise: 50000 }); gwRefund(o, { amount: 50000 }); await R.reconcileBatch(); assert.equal(D(o).paymentStatus, 'refunded'); assert.equal(D(o).refundedPaise, 50000);
});
test('NEVER DOWNGRADES refunds: a stale "pending" from Razorpay cannot undo processed, and a failed refund cannot become processed later', async () => {
  reset(); const o = paidWithRefund(); D(o).refunds[0].status = 'processed'; D(o).refundedPaise = 20000; D(o).refunds[0].updatedAt = ago(40 * MIN);
  const x = paidWithRefund(); gwRefund(o, { status: 'pending' }); gwRefund(x, { status: 'failed' });
  D(x).refunds[0].status = 'processed'; D(x).refundedPaise = 20000; // local already processed, gateway claims failed: terminal states are final
  // processed local entries are not "stuck", so drive the pass directly to prove the rule
  for (const ord of [o, x]) { const rep = await R.reconcileOrder(clone(D(ord)), { now: new Date(), dryRun: false, t: require('../src/utils/reconcile').DEFAULTS }); assert.deepEqual(rep.changes, []); }
  assert.equal(D(o).refunds[0].status, 'processed'); assert.equal(D(o).refundedPaise, 20000); assert.equal(D(x).refunds[0].status, 'processed'); assert.equal(D(x).refundedPaise, 20000);
});
test('Razorpay says a refund FAILED: the local entry becomes failed and the money is released for a new refund', async () => {
  reset(); const o = paidWithRefund(); gwRefund(o, { status: 'failed' }); await R.reconcileBatch(); assert.equal(D(o).refunds[0].status, 'failed'); assert.equal(D(o).refundedPaise, 0); assert.equal(D(o).paymentStatus, 'paid');
});
test('a dashboard refund whose answer was lost (pending, no gateway id) is adopted by amount; with an unrelated refund list it is reported after an hour', async () => {
  reset(); const o = paidWithRefund({}, { refundId: null, status: 'pending' }); gwRefund(o, { status: 'processed' });
  await R.reconcileBatch(); assert.equal(D(o).refunds.length, 1, 'adopted, not duplicated'); assert.equal(D(o).refunds[0].status, 'processed'); assert.match(D(o).refunds[0].refundId, /^rfnd_/); assert.equal(D(o).refunds[0].idempotencyKey.slice(0, 3), 'key');

  reset(); const p = paidWithRefund({}, { refundId: null, status: 'pending', createdAt: ago(90 * MIN), updatedAt: ago(90 * MIN) });
  await R.reconcileBatch(); assert.equal(D(p).refunds[0].status, 'pending', 'never guessed'); assert.deepEqual(codes(), ['refund_unconfirmed_at_gateway']);
});
test('a refund made in the Razorpay dashboard that we never heard about is added to the ledger; a refund missing at Razorpay is reported', async () => {
  reset(); const o = paidWithRefund(); gwRefund(o, { status: 'pending' }); gw.refunds[o.razorpayPaymentId].push(rawRef(o, { id: 'rfnd_FromDash0001', amount: 10000 }));
  await R.reconcileBatch(); assert.equal(D(o).refunds.length, 2, 'the known one is matched by id, the unknown one is added'); assert.equal(D(o).refundedPaise, 10000, 'only processed refunds count'); assert.equal(D(o).refunds.find((r) => r.refundId === 'rfnd_FromDash0001').status, 'processed'); assert.equal(codes().length, 0);
  reset(); const p = paidWithRefund(); await R.reconcileBatch(); assert.deepEqual(codes(), ['refund_missing_at_gateway']); assert.equal(D(p).refunds[0].status, 'created', 'ledger untouched');
});
test('refunds that would exceed the order total are refused and reported', async () => {
  reset(); const o = paidWithRefund(); gwRefund(o, { amount: 50001 }); await R.reconcileBatch(); assert.equal(D(o).refundedPaise, 0); assert.ok(codes().includes('refund_exceeds_total'));
});
test('refund pass is idempotent and a stuck refund is not asked about before it is old enough', async () => {
  reset(); const o = paidWithRefund(); gwRefund(o); await R.reconcileBatch(); const rev = D(o).paymentRev; D(o).reconcileCheckedAt = null;
  await R.reconcileBatch(); assert.equal(D(o).paymentRev, rev);
  reset(); const y = paidWithRefund({}, { updatedAt: ago(2 * MIN), createdAt: ago(2 * MIN) }); gwRefund(y); const s = await R.reconcileBatch(); assert.equal(s.scanned, 0); assert.equal(D(y).refunds[0].status, 'created');
});

// ===================== owner "Check with Razorpay" =====================
test('reconcileOne: pays a pending order, is a no-op on repeat, and is store-scoped', async () => {
  reset(); const o = mkOrder({ createdAt: ago(MIN) }); gwPay(o, rawPay(o)); // even a very young order may be checked on request
  const r = await R.reconcileOne(store, o.orderNumber); assert.equal(r.changed, true); assert.equal(r.order.paymentStatus, 'paid');
  const again = await R.reconcileOne(store, o.orderNumber); assert.equal(again.changed, false); assert.equal(D(o).paymentRev, 1);
  const other = mkOrder({ store: 'OTHER' }); gwPay(other, rawPay(other)); await assert.rejects(R.reconcileOne(store, other.orderNumber), (e) => e.status === 404); assert.equal(D(other).paymentStatus, 'pending');
  await assert.rejects(R.reconcileOne(store, 'abc'), (e) => e.status === 404); await assert.rejects(R.reconcileOne(store, 5), (e) => e.status === 404);
});
test('reconcileOne: COD and never-started online orders are refused; gateway trouble is a clear 503 that changes nothing', async () => {
  reset(); const cod = mkOrder({ paymentMethod: 'cod', paymentStatus: 'unpaid', razorpayOrderId: null }), none = mkOrder({ razorpayOrderId: null }), o = mkOrder();
  await assert.rejects(R.reconcileOne(store, cod.orderNumber), (e) => e.code === 'not_online_order'); await assert.rejects(R.reconcileOne(store, none.orderNumber), (e) => e.code === 'nothing_to_reconcile');
  gw.fail = 'transient'; await assert.rejects(R.reconcileOne(store, o.orderNumber), (e) => e.status === 503 && e.code === 'gateway_unreachable'); assert.equal(D(o).paymentStatus, 'pending'); assert.equal(D(o).reconcileCheckedAt, null);
  gw.fail = 'auth'; await assert.rejects(R.reconcileOne(store, o.orderNumber), (e) => e.code === 'gateway_auth');
});
test('reconcileOne on a paid order with a stuck refund brings the refund up to date at once, and a settled order says "nothing to check"', async () => {
  reset(); const o = paidWithRefund({}, { updatedAt: ago(MIN), createdAt: ago(MIN) }); gwRefund(o);
  const r = await R.reconcileOne(store, o.orderNumber); assert.equal(r.changed, true); assert.equal(D(o).refunds[0].status, 'processed');
  const plain = mkOrder({ paymentStatus: 'refunded', razorpayPaymentId: 'pay_Done0000001', refundedPaise: 50000 }); const r2 = await R.reconcileOne(store, plain.orderNumber); assert.equal(r2.nothingToCheck, true); assert.equal(r2.changed, false);
});
