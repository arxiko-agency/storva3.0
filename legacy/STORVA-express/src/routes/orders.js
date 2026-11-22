'use strict';
// Owner order management, mounted at /api/stores/:storeId/orders (req.store is the caller's own store).
const express = require('express');
const router = express.Router({ mergeParams: true });
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/productInput');
const { STATUSES } = require('../utils/orderStatus');
const { registerCascade } = require('../middleware/tenant');
const { updateOrder } = require('../services/orderOps');

const sid = (req) => req.store._id;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
registerCascade(async (storeId) => { await Order.deleteMany({ store: storeId }); await Counter.deleteMany({ store: storeId }); });

async function load(req) {
  const n = Number(req.params.orderNumber);
  if (!Number.isInteger(n) || n < 1001) throw new AppError('Order not found.', 404, 'not_found');
  const o = await Order.findOne({ store: sid(req), orderNumber: n });
  if (!o) throw new AppError('Order not found.', 404, 'not_found');
  return o;
}

router.get('/', asyncHandler(async (req, res) => {
  const q = req.query, where = { store: sid(req) };
  if (typeof q.status === 'string' && STATUSES.includes(q.status)) where.status = q.status;
  if (typeof q.q === 'string' && q.q.trim()) {
    const s = q.q.trim().slice(0, 60), re = new RegExp(escapeRegex(s), 'i');
    where.$or = [{ 'customer.name': re }, { 'customer.phone': re }, ...(/^\d{4,9}$/.test(s) ? [{ orderNumber: Number(s) }] : [])];
  }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [total, rows] = await Promise.all([Order.countDocuments(where), Order.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)]);
  res.json({ orders: rows.map((o) => o.toOwnerApi()), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/:orderNumber', asyncHandler(async (req, res) => res.json({ order: (await load(req)).toOwnerApi() })));

// Move an order along its lifecycle, mark a cash-on-delivery order paid, add tracking or a private note (rules in services/orderOps.js).
router.patch('/:orderNumber', asyncHandler(async (req, res) => {
  const o = await load(req);
  const { order } = await updateOrder(sid(req), o, body(req));
  await require('../services/audit').record(req, 'order.updated', { targetType: 'order', targetId: String(o.orderNumber), meta: { status: order.status, fields: Object.keys(body(req)).slice(0, 8).join(',') } });
  res.json({ order: order.toOwnerApi() });
}));

// Module 12: invoices. POST creates the invoice number now (normally it is created when the order ships); GET is the printable page.
router.post('/:orderNumber/invoice', asyncHandler(async (req, res) => {
  const o = await load(req);
  if (o.status === 'pending' || o.status === 'cancelled') throw new AppError(o.status === 'pending' ? 'Confirm the order first, then create its invoice.' : 'A cancelled order cannot get a new invoice.', 400, 'invoice_not_allowed');
  await require('../services/shippingTax').assignInvoice(sid(req), o);
  res.json({ order: (await load(req)).toOwnerApi() });
}));
router.get('/:orderNumber/invoice', asyncHandler(async (req, res) => {
  const o = await load(req);
  if (!o.invoiceNumber || o.invoiceNumber.startsWith('PENDING-')) throw new AppError('This order has no invoice yet. It is created when you mark the order shipped, or with "Create invoice".', 404, 'no_invoice');
  res.set('Cache-Control', 'no-store').type('html').send(require('../utils/invoiceHtml').renderInvoice({ store: req.store, order: o }));
}));

module.exports = router;
