'use strict';
// Module 6 online payments for storefront orders (buyer side). The amount ALWAYS comes from the saved order, never from the browser.
// The order becomes "paid" only after the HMAC signature from Razorpay Checkout is verified here with the server-side secret.
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');
const { MIN_ONLINE_PAISE, verifySignature, readProof, receiptFor } = require('../utils/razorpay');
const gateway = require('./razorpayApi');
const { getBuyerOrder } = require('./storefront');

const notFound = () => new AppError('Order not found.', 404, 'not_found');
const unavailable = () => new AppError('Online payment is not available right now. Please choose cash on delivery.', 503, 'payments_unavailable');

async function loadOnlineOrder(store, orderNumber, token) {
  const order = await getBuyerOrder(store, orderNumber, token);
  if (!order) throw notFound();
  if (order.paymentMethod !== 'razorpay') throw new AppError('This order is cash on delivery, so there is nothing to pay online.', 400, 'not_online_order');
  return order;
}

// -> the object Razorpay Checkout needs. Only the PUBLIC key id is returned.
async function startPayment(store, orderNumber, token) {
  const order = await loadOnlineOrder(store, orderNumber, token);
  if (order.paymentStatus === 'paid') throw new AppError('This order is already paid.', 409, 'already_paid');
  if (order.paymentStatus === 'refunded') throw new AppError('This payment was refunded, so the order cannot be paid again.', 409, 'not_payable');
  if (order.status === 'cancelled') throw new AppError('This order was cancelled, so it can no longer be paid.', 409, 'order_cancelled');
  if (!env.razorpay.enabled) throw unavailable();
  if (order.totalPaise < MIN_ONLINE_PAISE) throw new AppError('Orders below 1 rupee cannot be paid online.', 400, 'amount_too_low');

  let rzpOrderId = order.razorpayOrderId;
  if (!rzpOrderId) { // first attempt: create the Razorpay order once; retries after a failed or closed payment reuse it
    const created = await gateway.createOrder({
      amountPaise: order.totalPaise, receipt: receiptFor(store.slug, order.orderNumber),
      notes: { store: store.slug, orderNumber: String(order.orderNumber) },
    });
    if (created.amount !== order.totalPaise || created.currency !== 'INR') throw new AppError('The payment provider returned an unexpected amount.', 502, 'gateway_error');
    const claimed = await Order.updateOne({ _id: order._id, store: store._id, razorpayOrderId: null }, { $set: { razorpayOrderId: created.id } });
    if (claimed.matchedCount) rzpOrderId = created.id;
    else { const again = await Order.findOne({ _id: order._id, store: store._id }); rzpOrderId = again && again.razorpayOrderId; } // a parallel request won: use its order
    if (!rzpOrderId) throw new AppError('Could not start the payment. Please try again.', 503, 'busy');
  }
  return {
    keyId: env.razorpay.keyId, razorpayOrderId: rzpOrderId, amount: order.totalPaise, currency: 'INR', orderNumber: order.orderNumber,
    name: store.name, description: `Order #${order.orderNumber}`,
    prefill: { name: order.customer.name, contact: '+' + order.customer.phone, ...(order.customer.email ? { email: order.customer.email } : {}) },
  };
}

// input = { token, razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { verified, alreadyVerified, order }
async function verifyPayment(store, orderNumber, input) {
  const order = await loadOnlineOrder(store, orderNumber, input && input.token);
  const { proof, problem } = readProof(input);
  if (problem) throw new AppError(problem, 400, 'invalid_payment');
  if (!env.razorpay.keySecret) throw unavailable();
  // The Razorpay order in the proof must be the one created for THIS order, and the signature must be genuine.
  if (!order.razorpayOrderId || proof.orderId !== order.razorpayOrderId || !verifySignature(proof, env.razorpay.keySecret)) {
    throw new AppError('We could not verify this payment. If money was deducted, contact the store with your order number.', 400, 'invalid_signature');
  }
  if (order.paymentStatus === 'paid') return { verified: true, alreadyVerified: true, order: order.toBuyerApi() };
  // Compare-and-set: two verify calls at once mark the order paid exactly once.
  const upd = await Order.updateOne(
    { _id: order._id, store: store._id, paymentStatus: { $in: ['pending', 'failed', 'unpaid'] } },
    { $set: { paymentStatus: 'paid', paidAt: new Date(), razorpayPaymentId: proof.paymentId, paymentError: '' }, $inc: { paymentRev: 1 } });
  const fresh = await Order.findOne({ _id: order._id, store: store._id });
  if (upd.matchedCount) require('./events').emit('order.paid', { storeId: store._id, orderId: order._id }); // Module 13 (deduplicated with the webhook's own order.paid)
  return { verified: true, alreadyVerified: !upd.matchedCount, order: fresh.toBuyerApi() };
}

module.exports = { startPayment, verifyPayment };
