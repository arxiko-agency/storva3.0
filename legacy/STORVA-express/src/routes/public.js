'use strict';
// PUBLIC storefront API, mounted at /api/public/stores/:slug (no login). The store comes from the slug in the URL,
// every query is scoped to that store (see services/storefront.js), and only active products are ever returned.
const router = require('express').Router({ mergeParams: true });
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { strictLimiter } = require('../middleware/rateLimit');
const svc = require('../services/storefront');
const payments = require('../services/payments');

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const quoteLimiter = strictLimiter(60 * 1000, Number(process.env.QUOTE_RATE_LIMIT) || 60, 'Too many requests. Please slow down.');
const orderLimiter = strictLimiter(10 * 60 * 1000, Number(process.env.CHECKOUT_RATE_LIMIT) || 20, 'Too many orders from this connection. Please try again later.');

// Resolves the store for every route below. Unknown, suspended and renamed-away slugs are all 404 for the API.
router.use(asyncHandler(async (req, res, next) => {
  const { store } = await svc.findPublicStore(req.params.slug);
  if (!store) throw new AppError('Store not found.', 404, 'store_not_found');
  req.store = store;
  next();
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ store: svc.publicStore(req.store), collections: await svc.publicCollections(req.store) });
}));

router.get('/products', asyncHandler(async (req, res) => res.json(await svc.listProducts(req.store, req.query))));

router.get('/products/:productSlug', asyncHandler(async (req, res) => {
  const product = await svc.getProduct(req.store, req.params.productSlug);
  if (!product) throw new AppError('Product not found.', 404, 'not_found');
  res.json({ product });
}));

// Prices a cart (and an optional coupon) from the database. Never trusts prices from the browser.
router.post('/cart/quote', quoteLimiter, asyncHandler(async (req, res) => {
  res.json(await svc.quote(req.store, body(req).items, body(req).couponCode, { address: body(req).address, paymentMethod: body(req).paymentMethod }));
}));

// Module 14: "added to cart" signal from the storefront (navigator.sendBeacon). No personal data; 204 always.
const eventLimiter = strictLimiter(60 * 1000, 120, 'Too many requests.');
router.post('/events', eventLimiter, (req, res) => {
  const b = body(req);
  if (b.type === 'cart_add') require('../services/analytics').trackQuietly(req.store, req, 'cart_add', typeof b.productId === 'string' ? b.productId : null);
  res.status(204).end();
});

// Checks one coupon code against a cart; same engine as checkout.
router.post('/coupons/validate', quoteLimiter, asyncHandler(async (req, res) => {
  const q = await svc.quote(req.store, body(req).items, body(req).code);
  if (!q.coupon) throw new AppError('Enter a coupon code.', 400, 'validation_error', { fields: { code: 'Enter a coupon code.' } });
  res.json({ valid: q.coupon.valid, message: q.coupon.message, code: q.coupon.code, discount: q.discount, subtotal: q.subtotal, total: q.total });
}));

router.post('/orders', orderLimiter, asyncHandler(async (req, res) => {
  const { order, replayed } = await svc.placeOrder(req.store, body(req));
  if (!replayed) { // Modules 11 + 13: customer record, alerts, low-stock check (all asynchronous, never block the buyer)
    require('../services/events').emit('order.created', { storeId: req.store._id, orderId: order._id });
    require('../services/notifications').checkLowStock(req.store._id, order).catch((e) => console.error('[stock] low-stock check failed:', e.message));
  }
  res.status(replayed ? 200 : 201).json({ order: order.toBuyerApi(), token: order.publicToken, url: `/store/${req.store.slug}/order/${order.orderNumber}?t=${order.publicToken}`, replayed });
}));

// Module 6: online payment. The buyer proves ownership of the order with its token; the amount comes from the saved order.
const payLimiter = strictLimiter(10 * 60 * 1000, Number(process.env.PAYMENT_RATE_LIMIT) || 60, 'Too many payment attempts. Please try again in a few minutes.');
router.post('/orders/:orderNumber/payment', payLimiter, asyncHandler(async (req, res) => {
  res.json({ payment: await payments.startPayment(req.store, req.params.orderNumber, body(req).token) });
}));
router.post('/orders/:orderNumber/payment/verify', payLimiter, asyncHandler(async (req, res) => {
  res.json(await payments.verifyPayment(req.store, req.params.orderNumber, body(req)));
}));

router.get('/orders/:orderNumber', asyncHandler(async (req, res) => {
  const order = await svc.getBuyerOrder(req.store, req.params.orderNumber, req.query.t);
  if (!order) throw new AppError('Order not found.', 404, 'not_found');
  res.json({ order: order.toBuyerApi() });
}));

module.exports = router;
