'use strict';
// Pure Razorpay helpers (no database, no network) so they can be unit-tested.
// Standard Checkout proof: signature = HMAC_SHA256(razorpay_order_id + '|' + razorpay_payment_id, KEY_SECRET), hex.
const crypto = require('crypto');

const MIN_ONLINE_PAISE = 100; // Razorpay cannot take less than 1 rupee
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const SIGNATURE = /^[a-f0-9]{64}$/i;

const computeSignature = (orderId, paymentId, secret) => crypto.createHmac('sha256', String(secret)).update(`${orderId}|${paymentId}`).digest('hex');

// Constant-time comparison. Any malformed input is simply "not valid".
function verifySignature({ orderId, paymentId, signature }, secret) {
  if (!secret || !ORDER_ID.test(String(orderId)) || !PAYMENT_ID.test(String(paymentId)) || !SIGNATURE.test(String(signature))) return false;
  const a = Buffer.from(computeSignature(orderId, paymentId, secret), 'hex'), b = Buffer.from(String(signature), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Body of POST .../payment/verify -> { proof } or { problem }. Only strings in the exact Razorpay formats are accepted.
function readProof(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const orderId = b.razorpay_order_id, paymentId = b.razorpay_payment_id, signature = b.razorpay_signature;
  if (typeof orderId !== 'string' || !ORDER_ID.test(orderId) || typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId) || typeof signature !== 'string' || !SIGNATURE.test(signature)) {
    return { problem: 'The payment details are incomplete or invalid.' };
  }
  return { proof: { orderId, paymentId, signature: signature.toLowerCase() } };
}

// Razorpay allows receipts up to 40 characters.
const receiptFor = (slug, orderNumber) => `${String(slug).replace(/[^a-z0-9-]/gi, '').slice(0, 28)}-${orderNumber}`.slice(0, 40);

module.exports = { MIN_ONLINE_PAISE, computeSignature, verifySignature, readProof, receiptFor };
