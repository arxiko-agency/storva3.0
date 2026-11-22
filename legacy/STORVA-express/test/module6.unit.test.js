'use strict';
// Module 6 step 2: pure logic of the payment backend (no database, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { computeSignature, verifySignature, readProof, receiptFor, MIN_ONLINE_PAISE } = require('../src/utils/razorpay');
const { readCheckout } = require('../src/utils/checkoutInput');

const SECRET = 'test_secret_value_123', ORDER = 'order_Mock1234ABCD', PAY = 'pay_Mock1234ABCD';
const sig = computeSignature(ORDER, PAY, SECRET);
const form = { name: 'Priya', phone: '9876543210', address: { line1: '12 MG Road', city: 'Pune', state: 'MH', pincode: '411001' } };

test('signature: matches the documented HMAC_SHA256(order_id|payment_id) construction', () => {
  assert.equal(sig, crypto.createHmac('sha256', SECRET).update(`${ORDER}|${PAY}`).digest('hex'));
  assert.equal(verifySignature({ orderId: ORDER, paymentId: PAY, signature: sig }, SECRET), true);
});
test('signature: tampering with order, payment, signature or secret is rejected', () => {
  assert.equal(verifySignature({ orderId: 'order_Other123456', paymentId: PAY, signature: sig }, SECRET), false);
  assert.equal(verifySignature({ orderId: ORDER, paymentId: 'pay_Other123456', signature: sig }, SECRET), false);
  assert.equal(verifySignature({ orderId: ORDER, paymentId: PAY, signature: sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a') }, SECRET), false);
  assert.equal(verifySignature({ orderId: ORDER, paymentId: PAY, signature: sig }, 'wrong_secret'), false);
  assert.equal(verifySignature({ orderId: ORDER, paymentId: PAY, signature: sig }, ''), false);
  assert.equal(verifySignature({ orderId: ORDER, paymentId: PAY, signature: 'short' }, SECRET), false);
  assert.equal(verifySignature({ orderId: { $ne: 1 }, paymentId: PAY, signature: sig }, SECRET), false);
});
test('readProof: only exact Razorpay formats are accepted; objects and arrays are refused', () => {
  assert.deepEqual(readProof({ razorpay_order_id: ORDER, razorpay_payment_id: PAY, razorpay_signature: sig.toUpperCase() }).proof, { orderId: ORDER, paymentId: PAY, signature: sig });
  for (const bad of [null, [], 'x', {}, { razorpay_order_id: ORDER }, { razorpay_order_id: { $gt: '' }, razorpay_payment_id: PAY, razorpay_signature: sig }, { razorpay_order_id: ORDER, razorpay_payment_id: 'nope', razorpay_signature: sig }, { razorpay_order_id: ORDER, razorpay_payment_id: PAY, razorpay_signature: 'z'.repeat(64) }]) {
    assert.ok(readProof(bad).problem, JSON.stringify(bad));
  }
});
test('receipt: at most 40 characters and only safe characters', () => {
  const r = receiptFor('my-store!!' + 'x'.repeat(60), 1001); assert.ok(r.length <= 40); assert.match(r, /^[A-Za-z0-9-]+$/); assert.equal(MIN_ONLINE_PAISE, 100);
});
test('readCheckout: payment method defaults to cod, accepts cod and razorpay, rejects anything else', () => {
  assert.equal(readCheckout(form).data.paymentMethod, 'cod');
  assert.equal(readCheckout({ ...form, paymentMethod: '' }).data.paymentMethod, 'cod');
  assert.equal(readCheckout({ ...form, paymentMethod: 'cod' }).data.paymentMethod, 'cod');
  assert.equal(readCheckout({ ...form, paymentMethod: 'razorpay' }).data.paymentMethod, 'razorpay');
  for (const bad of ['upi', 'RAZORPAY', 1, { $ne: 'cod' }, ['cod']]) assert.ok(readCheckout({ ...form, paymentMethod: bad }).fields.paymentMethod, JSON.stringify(bad));
});
