'use strict';
// Pure rules for the automatic refund of cancelled, paid online orders (no database, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/utils/refundMath');

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0), MIN = 60 * 1000;
const oid = '65f1a2b3c4d5e6f708192a3b';
const order = (extra = {}) => ({ _id: oid, status: 'cancelled', paymentMethod: 'razorpay', paymentStatus: 'paid', razorpayPaymentId: 'pay_Test000001', totalPaise: 50000, refunds: [], ...extra });
const entry = (extra = {}) => ({ refundId: null, amountPaise: 50000, status: 'pending', source: 'auto', idempotencyKey: R.autoKeyFor({ _id: oid }, 1), createdAt: new Date(NOW - 10 * MIN), updatedAt: new Date(NOW - 10 * MIN), ...extra });

test('the request key is deterministic per order and attempt, and always a valid refund key', () => {
  for (const n of [1, 2, 3, 10]) { const k = R.autoKeyFor({ _id: oid }, n); assert.match(k, /^[A-Za-z0-9_-]{16,64}$/); assert.equal(k, R.autoKeyFor({ _id: oid }, n)); }
  assert.notEqual(R.autoKeyFor({ _id: oid }, 1), R.autoKeyFor({ _id: oid }, 2));
  assert.notEqual(R.autoKeyFor({ _id: oid }, 1), R.autoKeyFor({ _id: '65f1a2b3c4d5e6f708192a3c' }, 1));
});

test('eligible only when cancelled + paid online with a captured payment', () => {
  assert.equal(R.autoRefundEligibility(order()).ok, true);
  const no = (extra, reason) => { const e = R.autoRefundEligibility(order(extra)); assert.equal(e.ok, false); assert.equal(e.reason, reason); };
  no({ status: 'confirmed' }, 'not_cancelled'); no({ status: 'pending' }, 'not_cancelled');
  no({ paymentMethod: 'cod' }, 'not_online_order'); no({ paymentStatus: 'pending' }, 'not_paid'); no({ paymentStatus: 'failed' }, 'not_paid');
  no({ razorpayPaymentId: null }, 'not_paid'); no({ paymentStatus: 'refunded' }, 'already_refunded');
  no({ refunds: [{ status: 'processed', amountPaise: 50000 }] }, 'nothing_to_refund');
});

test('first plan: start attempt 1 for the full remaining amount', () => {
  assert.deepEqual(R.planAutoRefund(order(), NOW), { action: 'start', key: R.autoKeyFor({ _id: oid }, 1), attempt: 1 });
});

test('an in-flight refund is never duplicated: wait, retry the unconfirmed one, or verify', () => {
  assert.equal(R.planAutoRefund(order({ refunds: [entry({ createdAt: new Date(NOW - 5000), updatedAt: new Date(NOW - 5000) })] }), NOW).action, 'wait'); // request still running
  const r = R.planAutoRefund(order({ refunds: [entry()] }), NOW); assert.equal(r.action, 'retry'); assert.equal(r.key, R.autoKeyFor({ _id: oid }, 1)); // never confirmed: same key
  const created = entry({ status: 'created', refundId: 'rfnd_Abc123456' });
  assert.equal(R.planAutoRefund(order({ refunds: [{ ...created, updatedAt: new Date(NOW - MIN) }] }), NOW).action, 'wait');
  assert.equal(R.planAutoRefund(order({ refunds: [created] }), NOW).action, 'verify');
  for (const refunds of [[entry()], [created]]) assert.notEqual(R.planAutoRefund(order({ refunds }), NOW).action, 'start');
});

test('after a failed attempt: back-off, then a NEW key; after the last allowed attempt: exhausted', () => {
  const f = (n, ageMin) => entry({ status: 'failed', refundId: 'rfnd_F' + n + 'x234567', idempotencyKey: R.autoKeyFor({ _id: oid }, n), updatedAt: new Date(NOW - ageMin * MIN) });
  assert.deepEqual(R.planAutoRefund(order({ refunds: [f(1, 2)] }), NOW), { action: 'wait', reason: 'backoff' });
  assert.deepEqual(R.planAutoRefund(order({ refunds: [f(1, 20)] }), NOW), { action: 'start', key: R.autoKeyFor({ _id: oid }, 2), attempt: 2 });
  assert.equal(R.planAutoRefund(order({ refunds: [f(1, 90), f(2, 20)] }), NOW).action, 'wait'); // back-off grows with every failure
  assert.equal(R.planAutoRefund(order({ refunds: [f(1, 300), f(2, 200)] }), NOW).attempt, 3);
  assert.deepEqual(R.planAutoRefund(order({ refunds: [f(1, 300), f(2, 200), f(3, 100)] }), NOW), { action: 'exhausted', attempts: 3 });
  assert.deepEqual(R.planAutoRefund(order({ autoRefundExhausted: true, refunds: [f(1, 300), f(2, 200), f(3, 100)] }), NOW), { action: 'none', reason: 'exhausted' });
  assert.equal(R.planAutoRefund(order({ refunds: [f(1, 300), f(2, 200)] }), NOW, { maxAttempts: 2 }).action, 'exhausted');
});

test('manual refunds do not use up automatic attempts; a partial manual refund shrinks the automatic amount base', () => {
  const manualFailed = { refundId: 'rfnd_Man1234567', amountPaise: 1000, status: 'failed', source: 'dashboard', updatedAt: new Date(NOW - 500 * MIN) };
  assert.equal(R.planAutoRefund(order({ refunds: [manualFailed] }), NOW).attempt, 1);
  const done = { refundId: 'rfnd_Done123456', amountPaise: 20000, status: 'processed', source: 'dashboard' };
  assert.equal(R.refundable(order({ refunds: [done] })).refundablePaise, 30000);
  assert.equal(R.planAutoRefund(order({ refunds: [done] }), NOW).action, 'start');
});

test('buyer sees only a safe refund state', () => {
  assert.equal(R.buyerRefundState(order({ paymentMethod: 'cod' })), 'none');
  assert.equal(R.buyerRefundState(order()), 'in_progress'); // cancelled + paid, refund not recorded yet
  assert.equal(R.buyerRefundState(order({ refunds: [entry({ status: 'created', refundId: 'rfnd_Abc123456' })] })), 'in_progress');
  assert.equal(R.buyerRefundState(order({ paymentStatus: 'refunded', refunds: [{ status: 'processed', amountPaise: 50000 }] })), 'processed');
  assert.equal(R.buyerRefundState(order({ autoRefundExhausted: true })), 'attention');
  assert.equal(R.buyerRefundState(order({ refunds: [entry({ status: 'failed' })] })), 'in_progress'); // automatic attempt failed but will be retried
  assert.equal(R.buyerRefundState(order({ refunds: [entry({ status: 'failed' })], autoRefundExhausted: true })), 'attention'); // no automatic attempt left
  assert.equal(R.buyerRefundState(order({ refunds: [entry({ status: 'failed', source: 'dashboard' })] })), 'attention'); // a hand-started refund failed: nothing retries it
  assert.equal(R.buyerRefundState(order({ status: 'confirmed' })), 'none');
});
