'use strict';
// Module 6 step 4 part 2: pure reconciliation rules (src/utils/reconcile.js). No database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../src/utils/reconcile');
const W = require('../src/utils/razorpayWebhook');

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0), MIN = 60000, DAY = 86400000;
const ago = (ms) => new Date(NOW - ms);
const order = (o = {}) => ({ _id: 'o1', store: 'S1', orderNumber: 1001, paymentMethod: 'razorpay', paymentStatus: 'pending', status: 'confirmed', totalPaise: 50000, razorpayOrderId: 'order_Test000001', razorpayPaymentId: null, refunds: [], refundedPaise: 0, paymentRev: 0, createdAt: ago(2 * 60 * MIN), reconcileCheckedAt: null, ...o });
const rawPay = (o = {}) => ({ id: 'pay_Test000001', order_id: 'order_Test000001', amount: 50000, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0, created_at: 1763294400, ...o });
const rawRef = (o = {}) => ({ id: 'rfnd_Test000001', payment_id: 'pay_Test000001', amount: 50000, status: 'processed', created_at: 1763294500, ...o });
const pay = (o) => X.parseGatewayPayment(rawPay(o)), ref = (o) => X.parseGatewayRefund(rawRef(o));

test('stuck payment: only unsettled online orders with a Razorpay order, old enough, not too old, not checked recently', () => {
  assert.equal(X.isStuckPayment(order(), NOW), true);
  assert.equal(X.isStuckPayment(order({ paymentStatus: 'failed' }), NOW), true);
  for (const bad of [{ paymentStatus: 'paid' }, { paymentStatus: 'refunded' }, { paymentStatus: 'unpaid' }, { paymentMethod: 'cod' }, { razorpayOrderId: null }, { razorpayOrderId: '' },
    { createdAt: ago(5 * MIN) }, { createdAt: ago(31 * DAY) }, { reconcileCheckedAt: ago(5 * MIN) }]) assert.equal(X.isStuckPayment(order(bad), NOW), false, JSON.stringify(bad));
  assert.equal(X.isStuckPayment(order({ reconcileCheckedAt: ago(31 * MIN) }), NOW), true, 'checked long ago: due again');
  assert.equal(X.isStuckPayment(order({ createdAt: ago(5 * MIN) }), NOW, { minAgeMs: 0 }), true, 'threshold override');
});

test('stuck refund: paid online order with an in-flight refund that is old enough', () => {
  const rf = (o) => ({ refundId: 'rfnd_X00000001', amountPaise: 1000, status: 'created', createdAt: ago(20 * MIN), updatedAt: ago(20 * MIN), ...o });
  const paid = (o) => order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001', refunds: [rf()], ...o });
  assert.equal(X.isStuckRefund(paid(), NOW), true);
  assert.equal(X.isStuckRefund(paid({ refunds: [rf({ status: 'pending', refundId: null })] }), NOW), true);
  for (const bad of [{ refunds: [rf({ status: 'processed' })] }, { refunds: [rf({ status: 'failed' })] }, { refunds: [] }, { refunds: [rf({ updatedAt: ago(2 * MIN) })] }, { paymentStatus: 'refunded' }, { paymentStatus: 'pending' }, { paymentMethod: 'cod' }, { razorpayPaymentId: null }, { reconcileCheckedAt: ago(MIN) }]) assert.equal(X.isStuckRefund(paid(bad), NOW), false, JSON.stringify(bad));
});

// A tiny MongoDB matcher: enough to prove the real query filters select exactly the orders the JS predicates select.
function get(d, path) { return path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), d); }
function cmp(val, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$in') return v.includes(val);
      if (op === '$type') return v === 'string' && typeof val === 'string';
      if (op === '$lte') return val != null && +val <= +v;
      if (op === '$gte') return val != null && +val >= +v;
      if (op === '$elemMatch') return Array.isArray(val) && val.some((e) => matches(e, v));
      throw new Error('unsupported ' + op);
    });
  }
  return cond === null ? val == null : val === cond;
}
function matches(d, f) { return Object.entries(f).every(([k, c]) => (k === '$or' ? c.some((x) => matches(d, x)) : cmp(get(d, k), c))); }

test('the MongoDB filters select exactly the same orders as the JS predicates', () => {
  const rf = (o) => ({ refundId: 'rfnd_X00000001', amountPaise: 1000, status: 'created', createdAt: ago(20 * MIN), updatedAt: ago(20 * MIN), ...o });
  const variants = [];
  for (const paymentStatus of ['pending', 'failed', 'paid', 'refunded', 'unpaid']) for (const paymentMethod of ['razorpay', 'cod']) for (const razorpayOrderId of ['order_Test000001', null])
    for (const createdAt of [ago(MIN), ago(2 * 60 * MIN), ago(40 * DAY)]) for (const reconcileCheckedAt of [null, undefined, ago(MIN), ago(2 * 60 * MIN)])
      for (const refunds of [[], [rf()], [rf({ updatedAt: ago(MIN) })], [rf({ status: 'processed' })]]) for (const razorpayPaymentId of [null, 'pay_Test000001'])
        variants.push(order({ paymentStatus, paymentMethod, razorpayOrderId, createdAt, reconcileCheckedAt, refunds, razorpayPaymentId }));
  const pf = X.stuckPaymentFilter(NOW), rfF = X.stuckRefundFilter(NOW);
  let a = 0, b = 0;
  for (const o of variants) {
    assert.equal(matches(o, pf), X.isStuckPayment(o, NOW), 'payment filter vs predicate: ' + JSON.stringify(o)); if (X.isStuckPayment(o, NOW)) a++;
    assert.equal(matches(o, rfF), X.isStuckRefund(o, NOW), 'refund filter vs predicate: ' + JSON.stringify(o)); if (X.isStuckRefund(o, NOW)) b++;
  }
  assert.ok(a > 0 && b > 0, 'the matrix really contains stuck orders');
});

test('gateway payments are validated: bad ids, amounts, statuses and shapes are rejected', () => {
  assert.ok(pay());
  for (const bad of [null, 'x', [], { ...rawPay(), id: 'xyz' }, { ...rawPay(), id: 'pay_' }, { ...rawPay(), order_id: 'nope' }, { ...rawPay(), amount: '500' }, { ...rawPay(), amount: 1.5 }, { ...rawPay(), amount: NaN }, { ...rawPay(), currency: 5 }, { ...rawPay(), status: undefined }]) assert.equal(X.parseGatewayPayment(bad), null, JSON.stringify(bad));
  assert.equal(pay({ status: 'refunded', captured: true, amount_refunded: 50000 }).status, 'captured', 'a refunded payment WAS captured');
  assert.equal(pay({ status: 'refunded', captured: false }).status, 'refunded', 'but a "refunded" one that was never captured is not');
  assert.equal(pay({ amount_refunded: -5 }).amountRefunded, 0); assert.equal(pay({ error_description: 'a\nb' }).error, 'a b');
});
test('gateway refunds are validated', () => {
  assert.ok(ref());
  for (const bad of [null, { ...rawRef(), id: 'x' }, { ...rawRef(), payment_id: 'x' }, { ...rawRef(), amount: 0 }, { ...rawRef(), amount: -1 }, { ...rawRef(), status: 'weird' }, { ...rawRef(), amount: '10' }]) assert.equal(X.parseGatewayRefund(bad), null, JSON.stringify(bad));
});

test('planPayment: captured -> mark paid; the earliest of several captured payments first and the rest reported', () => {
  let p = X.planPayment(order(), [pay()]); assert.deepEqual(p.actions.map((a) => a.kind), ['captured']); assert.equal(p.issues.length, 0);
  p = X.planPayment(order(), [pay({ id: 'pay_Later00001', created_at: 1763299999 }), pay({ id: 'pay_Early00001', created_at: 1763290000 })]);
  assert.deepEqual(p.actions.map((a) => a.pay.id), ['pay_Early00001', 'pay_Later00001']); assert.ok(p.issues.some((i) => i.code === 'multiple_captured_payments'));
});
test('planPayment: failed only -> mark failed (latest attempt); an attempt still in progress or an authorized payment blocks it', () => {
  let p = X.planPayment(order(), [pay({ id: 'pay_Fail00001', status: 'failed', created_at: 1, error_description: 'old' }), pay({ id: 'pay_Fail00002', status: 'failed', created_at: 2, error_description: 'new' })]);
  assert.equal(p.actions.length, 1); assert.equal(p.actions[0].pay.error, 'new');
  p = X.planPayment(order(), [pay({ status: 'failed' }), pay({ id: 'pay_Open00001', status: 'created' })]); assert.equal(p.actions.length, 0, 'buyer is mid-payment');
  p = X.planPayment(order(), [pay({ status: 'authorized' })]); assert.equal(p.actions.length, 0); assert.equal(p.issues[0].code, 'payment_authorized_not_captured');
  p = X.planPayment(order({ paymentStatus: 'failed' }), [pay({ status: 'failed' })]); assert.equal(p.actions.length, 0, 'already failed: nothing to do');
  p = X.planPayment(order(), []); assert.deepEqual(p, { actions: [], issues: [] });
});
test('planPayment: a payment that belongs to another Razorpay order is reported, never applied', () => {
  const p = X.planPayment(order(), [pay({ order_id: 'order_Other00001' })]); assert.equal(p.actions.length, 0); assert.equal(p.issues[0].code, 'foreign_payment');
});

test('planRefunds: every gateway refund becomes an action; unknown local entries are reported, never invented or deleted', () => {
  const o = order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001', refunds: [{ refundId: 'rfnd_Gone00001', amountPaise: 1000, status: 'created', createdAt: ago(20 * MIN), updatedAt: ago(20 * MIN) }] });
  let p = X.planRefunds(o, [ref({ status: 'processed' })], NOW);
  assert.equal(p.actions.length, 1); assert.deepEqual(p.actions[0].rf, { id: 'rfnd_Test000001', paymentId: 'pay_Test000001', amount: 50000, status: 'processed' });
  assert.deepEqual(p.issues.map((i) => i.code), ['refund_missing_at_gateway']);
  p = X.planRefunds(o, [ref({ payment_id: 'pay_Other00001' })], NOW); assert.equal(p.actions.length, 0); assert.ok(p.issues.some((i) => i.code === 'refund_payment_mismatch'));
});
test('planRefunds: a dashboard refund with no gateway id is matched by amount (webhook adoption) or reported after an hour', () => {
  const entry = (o) => ({ refundId: null, amountPaise: 20000, status: 'pending', idempotencyKey: 'k'.repeat(20), createdAt: ago(90 * MIN), updatedAt: ago(90 * MIN), ...o });
  const o = (e) => order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001', refunds: [e] });
  assert.equal(X.planRefunds(o(entry()), [ref({ amount: 20000 })], NOW).issues.length, 0, 'Razorpay knows it');
  assert.deepEqual(X.planRefunds(o(entry()), [], NOW).issues.map((i) => i.code), ['refund_unconfirmed_at_gateway']);
  assert.equal(X.planRefunds(o(entry({ updatedAt: ago(10 * MIN), createdAt: ago(10 * MIN) })), [], NOW).issues.length, 0, 'still young: not reported yet');
  assert.deepEqual(X.planRefunds(o(entry()), [ref({ amount: 999 })], NOW).issues.map((i) => i.code), ['refund_unconfirmed_at_gateway'], 'a different amount does not adopt it');
});

test('downgrade guard: paid or refunded orders can never move backwards, whatever a decision says', () => {
  const paid = order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001' }), refunded = order({ paymentStatus: 'refunded', razorpayPaymentId: 'pay_Test000001', refundedPaise: 50000 });
  for (const s of ['pending', 'failed', 'unpaid']) assert.equal(X.downgradeProblem(paid, { paymentStatus: s }), 'would_downgrade', 'paid -> ' + s);
  for (const s of ['paid', 'pending', 'failed', 'unpaid']) assert.equal(X.downgradeProblem(refunded, { paymentStatus: s }), 'would_downgrade', 'refunded -> ' + s);
  assert.equal(X.downgradeProblem(paid, { paymentStatus: 'refunded' }), null, 'paid -> refunded is forward');
  assert.equal(X.downgradeProblem(order(), { paymentStatus: 'paid' }), null); assert.equal(X.downgradeProblem(order(), { paymentStatus: 'failed' }), null); assert.equal(X.downgradeProblem(order({ paymentStatus: 'failed' }), { paymentStatus: 'paid' }), null);
  assert.equal(X.downgradeProblem(order(), { paymentStatus: 'bogus' }), 'unknown_payment_status');
  assert.equal(X.downgradeProblem(paid, { razorpayPaymentId: 'pay_Another0001' }), 'would_replace_payment');
  assert.equal(X.downgradeProblem(order({ refundedPaise: 1000 }), { refundedPaise: 500 }), 'would_downgrade');
  const led = [{ refundId: 'rfnd_Done00001', amountPaise: 1000, status: 'processed' }];
  assert.equal(X.downgradeProblem(order({ refunds: led }), { refunds: [{ ...led[0], status: 'created' }] }), 'would_downgrade', 'processed -> created');
  assert.equal(X.downgradeProblem(order({ refunds: led }), { refunds: [] }), 'would_downgrade', 'a settled refund may not vanish');
  assert.equal(X.downgradeProblem(order({ refunds: led }), { refunds: [{ ...led[0], amountPaise: 5 }] }), 'would_downgrade', 'nor change amount');
  assert.equal(X.downgradeProblem(order({ refunds: led }), { refunds: [...led, { refundId: 'rfnd_New000001', amountPaise: 5, status: 'created' }] }), null);
});
test('safeDecide turns an unsafe "apply" into an "ignore" and leaves safe decisions alone', () => {
  const paid = order({ paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001' });
  const evil = X.safeDecide(() => ({ action: 'apply', reason: 'evil', set: { paymentStatus: 'failed' } }));
  assert.deepEqual(evil(paid), { action: 'ignore', reason: 'would_downgrade' });
  assert.equal(X.safeDecide(() => ({ action: 'noop', reason: 'x' }))(paid).action, 'noop');
  assert.equal(X.safeDecide((o) => W.decideCaptured(o, pay()))(order()).action, 'apply');
});

test('the webhook decisions reconciliation reuses: no downgrade, idempotent, amount checked', () => {
  const p = pay(), paid = order({ paymentStatus: 'paid', razorpayPaymentId: p.id });
  assert.equal(W.decideCaptured(order(), p).action, 'apply'); assert.equal(W.decideCaptured(paid, p).reason, 'already_paid');
  assert.equal(W.decideCaptured(order({ paymentStatus: 'refunded' }), p).action, 'noop');
  assert.equal(W.decideCaptured(order(), { ...p, amount: 1 }).reason, 'amount_mismatch');
  assert.equal(W.decideFailed(paid, { ...p, status: 'failed' }).action, 'noop'); assert.equal(W.decideFailed(order({ paymentStatus: 'refunded' }), { ...p, status: 'failed' }).action, 'noop');
});

test('every issue code reconciliation can raise has a fixed, customer-data-free text', () => {
  const codes = ['amount_mismatch', 'second_payment_for_paid_order', 'multiple_captured_payments', 'payment_authorized_not_captured', 'order_mismatch', 'foreign_payment', 'payment_mismatch', 'refund_payment_mismatch', 'refund_exceeds_total', 'refunds_exceed_total', 'refund_amount_changed', 'refund_missing_at_gateway', 'refund_unconfirmed_at_gateway', 'gateway_order_not_found', 'gateway_bad_response', 'would_downgrade', 'would_replace_payment', 'unknown_payment_status'];
  codes.forEach((c) => assert.ok(X.ISSUE_TEXT[c] && X.ISSUE_TEXT[c].length > 20, c));
  Object.values(X.AUTO_RESOLVE).flat().forEach((c) => assert.ok(X.ISSUE_TEXT[c], 'auto-resolve code has text: ' + c));
  assert.ok(!X.AUTO_RESOLVE.payment.includes('amount_mismatch') && !X.AUTO_RESOLVE.payment.includes('second_payment_for_paid_order'), 'money anomalies need a human to dismiss them');
});
