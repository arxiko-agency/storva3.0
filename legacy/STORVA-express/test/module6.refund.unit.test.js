'use strict';
// Module 6 step 4: pure refund rules + payment status labels. No database, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/utils/refundMath');
const { displayStatus, paymentApi } = require('../src/utils/paymentView');
const W = require('../src/utils/razorpayWebhook');

const KEY = 'a'.repeat(20);
const order = (o = {}) => ({ paymentMethod: 'razorpay', paymentStatus: 'paid', status: 'confirmed', totalPaise: 49950, razorpayPaymentId: 'pay_Test000001', refunds: [], refundedPaise: 0, orderNumber: 1001, customer: { name: 'A', phone: '919876543210' }, createdAt: new Date(), ...o });

test('parseRupeesToPaise: exact, no floating point, strict format', () => {
  assert.equal(R.parseRupeesToPaise('499.50'), 49950); assert.equal(R.parseRupeesToPaise(499.5), 49950); assert.equal(R.parseRupeesToPaise('0.29'), 29); assert.equal(R.parseRupeesToPaise('1.1'), 110);
  assert.equal(R.parseRupeesToPaise(1.15), 115, 'no 114.99999 from float maths');
  for (const bad of ['', '0', '0.00', '-5', '1e3', '1.234', 'abc', '0x10', NaN, Infinity, null, undefined, {}, [], '1,000', ' ', '1.', '.5', '9999999999']) assert.equal(R.parseRupeesToPaise(bad), null, String(bad));
});
test('refundable: processed and in-flight refunds are subtracted, failed ones are not', () => {
  const o = order({ refunds: [{ status: 'processed', amountPaise: 10000 }, { status: 'failed', amountPaise: 20000 }, { status: 'created', amountPaise: 5000 }] });
  const r = R.refundable(o); assert.equal(r.processedPaise, 10000); assert.equal(r.inFlightPaise, 5000); assert.equal(r.refundablePaise, 34950); assert.equal(r.hasInFlight, true);
  assert.equal(R.refundable(order({ refunds: [{ status: 'pending', amountPaise: 49950 }] })).refundablePaise, 0);
  assert.equal(R.refundable(order({ refunds: [{ status: 'processed', amountPaise: 99999 }] })).refundablePaise, 0, 'never negative');
});
test('eligibility: only paid online orders with a payment id', () => {
  assert.equal(R.refundEligibility(order()).ok, true);
  assert.equal(R.refundEligibility(order({ paymentMethod: 'cod' })).code, 'not_online_order');
  assert.equal(R.refundEligibility(order({ razorpayPaymentId: null })).code, 'not_paid');
  assert.equal(R.refundEligibility(order({ paymentStatus: 'refunded' })).code, 'already_refunded');
  for (const s of ['pending', 'failed', 'unpaid']) assert.equal(R.refundEligibility(order({ paymentStatus: s })).code, 'not_paid');
});
test('readRefundInput: validates amount against the server-side refundable amount', () => {
  const ok = R.readRefundInput({ type: 'partial', amount: '100.25', reason: ' Item  returned ', idempotencyKey: KEY }, 49950);
  assert.equal(ok.value.amountPaise, 10025); assert.equal(ok.value.reason, 'Item returned'); assert.equal(ok.value.full, false);
  assert.equal(R.readRefundInput({ type: 'full', idempotencyKey: KEY }, 30000).value.amountPaise, 30000, 'full = everything still refundable, decided by the server');
  assert.ok(R.readRefundInput({ type: 'full', amount: '5', idempotencyKey: KEY }, 30000).fields.amount, 'a full refund takes no client amount');
  assert.ok(R.readRefundInput({ type: 'partial', amount: '499.51', idempotencyKey: KEY }, 49950).fields.amount, 'one paisa too much');
  assert.equal(R.readRefundInput({ type: 'partial', amount: '499.50', idempotencyKey: KEY }, 49950).value.amountPaise, 49950, 'exactly the limit is fine');
  for (const amount of ['0', '-1', 'abc', '', undefined, '1e2', '1.999']) assert.ok(R.readRefundInput({ type: 'partial', amount, idempotencyKey: KEY }, 49950).fields.amount, String(amount));
  assert.ok(R.readRefundInput({ type: 'partial', amount: '1', idempotencyKey: KEY }, 0).fields.amount, 'nothing left');
  assert.ok(R.readRefundInput({ type: 'other', idempotencyKey: KEY }, 100).fields.type);
  assert.ok(R.readRefundInput({ type: 'full' }, 100).fields.idempotencyKey); assert.ok(R.readRefundInput({ type: 'full', idempotencyKey: 'short' }, 100).fields.idempotencyKey); assert.ok(R.readRefundInput({ type: 'full', idempotencyKey: { $ne: 1 } }, 100).fields.idempotencyKey);
  assert.ok(R.readRefundInput({ type: 'full', idempotencyKey: KEY, reason: 'x'.repeat(201) }, 100).fields.reason); assert.ok(R.readRefundInput({ type: 'full', idempotencyKey: KEY, reason: { a: 1 } }, 100).fields.reason);
  assert.ok(R.readRefundInput(null, 100).fields.type); assert.ok(R.readRefundInput([], 100).fields.type);
});
test('gatewayKeyFor: stable per request, different across stores, orders and keys; ledgerStatusOf maps Razorpay states', () => {
  const k = R.gatewayKeyFor('s1', 'o1', KEY); assert.equal(k, R.gatewayKeyFor('s1', 'o1', KEY)); assert.match(k, /^rf_[a-f0-9]{40}$/);
  assert.notEqual(k, R.gatewayKeyFor('s2', 'o1', KEY)); assert.notEqual(k, R.gatewayKeyFor('s1', 'o2', KEY)); assert.notEqual(k, R.gatewayKeyFor('s1', 'o1', 'b'.repeat(20)));
  assert.deepEqual(['pending', 'processed', 'failed', 'zzz'].map(R.ledgerStatusOf), ['created', 'processed', 'failed', 'created']);
});
test('displayStatus covers every state', () => {
  assert.equal(displayStatus(order()), 'paid'); assert.equal(displayStatus(order({ paymentStatus: 'pending' })), 'pending'); assert.equal(displayStatus(order({ paymentStatus: 'unpaid' })), 'pending');
  assert.equal(displayStatus(order({ paymentStatus: 'failed' })), 'failed'); assert.equal(displayStatus(order({ paymentStatus: 'refunded' })), 'refunded');
  assert.equal(displayStatus(order({ refundedPaise: 100, refunds: [{ status: 'processed', amountPaise: 100 }] })), 'partially_refunded');
  assert.equal(displayStatus(order({ refunds: [{ status: 'pending', amountPaise: 100 }] })), 'refund_pending');
  assert.equal(displayStatus(order({ paymentMethod: 'cod', paymentStatus: 'paid' })), 'cod_paid'); assert.equal(displayStatus(order({ paymentMethod: 'cod', paymentStatus: 'unpaid' })), 'cod_unpaid');
});
test('paymentApi: rupees, refundable, canRefund and reasons; never leaks internals', () => {
  const d = paymentApi(order({ refundedPaise: 10000, refunds: [{ refundId: 'rfnd_x', status: 'processed', amountPaise: 10000, requestedBy: 'secretUserId', idempotencyKey: KEY }] }), { detail: true });
  assert.equal(d.amount, 499.5); assert.equal(d.refundedAmount, 100); assert.equal(d.refundableAmount, 399.5); assert.equal(d.canRefund, true);
  assert.equal(JSON.stringify(d).includes('secretUserId'), false, 'requestedBy is not exposed');
  assert.equal(paymentApi(order({ refunds: [{ status: 'created', amountPaise: 100 }] }), { detail: true }).canRefund, false);
  assert.match(paymentApi(order({ paymentMethod: 'cod' }), { detail: true }).refundBlockedReason, /Cash on delivery/);
  assert.equal(paymentApi(order({ paymentStatus: 'refunded' }), { detail: true }).refundableAmount, 0);
  assert.equal(paymentApi(order()).refunds, undefined, 'list rows carry no ledger');
});
test('webhook decision keeps dashboard fields and adopts a pending dashboard entry instead of duplicating it', () => {
  const pending = { refundId: null, amountPaise: 10000, status: 'pending', idempotencyKey: KEY, reason: 'Returned', source: 'dashboard' };
  const rf = { id: 'rfnd_Adopt00001', paymentId: 'pay_Test000001', amount: 10000, status: 'created' };
  const d = W.decideRefund(order({ refunds: [pending] }), rf);
  assert.equal(d.action, 'apply'); assert.equal(d.set.refunds.length, 1, 'no duplicate entry'); assert.equal(d.set.refunds[0].refundId, 'rfnd_Adopt00001'); assert.equal(d.set.refunds[0].status, 'created'); assert.equal(d.set.refunds[0].reason, 'Returned'); assert.equal(d.set.refunds[0].idempotencyKey, KEY);
  const p = W.decideRefund(order({ refunds: d.set.refunds }), { ...rf, status: 'processed' }); assert.equal(p.set.refundedPaise, 10000); assert.equal(p.set.refunds[0].reason, 'Returned'); assert.equal(p.set.paymentStatus, undefined);
  const other = W.decideRefund(order({ refunds: [pending] }), { ...rf, amount: 5000 }); assert.equal(other.set.refunds.length, 2, 'a different amount is a different refund (made in the Razorpay dashboard)');
});
