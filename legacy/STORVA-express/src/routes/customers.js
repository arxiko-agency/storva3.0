'use strict';
// Module 11: customers, mounted at /api/stores/:storeId/customers.
//   GET    /                ?q=&segment=new|repeat|vip|inactive&tag=&sort=recent|spent|orders|name&page=&limit=
//   GET    /export.csv      same filters, CSV (Pro: exports)
//   POST   /rebuild         rebuild every customer from the orders
//   GET    /:id             customer + their orders
//   PATCH  /:id             { notes?, tags?, codBlocked? }
//   DELETE /:id             erase the customer's personal data (orders are kept, anonymised); refused while orders are open
const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { badRequest } = require('../utils/validate');
const { escapeRegex } = require('../utils/productInput');
const { requireFeature } = require('../middleware/plan');
const { strictLimiter } = require('../middleware/rateLimit');
const { sendCsv } = require('../utils/csv');
const svc = require('../services/customers');

const sid = (req) => req.store._id;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const SORTS = { recent: { lastOrderAt: -1 }, spent: { totalSpentPaise: -1, lastOrderAt: -1 }, orders: { orderCount: -1, lastOrderAt: -1 }, name: { name: 1 } };

function where(req) {
  const q = req.query, w = { store: sid(req) }, now = Date.now();
  if (typeof q.q === 'string' && q.q.trim()) {
    const s = q.q.trim().slice(0, 60), re = new RegExp(escapeRegex(s), 'i'), digits = s.replace(/\D/g, '');
    w.$or = [{ name: re }, { email: re }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRegex(digits)) }] : [])];
  }
  const inactive = new Date(now - 90 * 864e5);
  if (q.segment === 'inactive') w.lastOrderAt = { $lt: inactive };
  else if (q.segment === 'new') Object.assign(w, { orderCount: 1, lastOrderAt: { $gte: inactive } });
  else if (q.segment === 'repeat') Object.assign(w, { orderCount: 2, totalSpentPaise: { $lt: 500000 }, lastOrderAt: { $gte: inactive } });
  else if (q.segment === 'vip') Object.assign(w, { lastOrderAt: { $gte: inactive }, $and: [{ $or: [{ orderCount: { $gte: 3 } }, { totalSpentPaise: { $gte: 500000 } }] }] });
  else if (q.segment === 'blocked') w.codBlocked = true;
  if (typeof q.tag === 'string' && q.tag.trim()) w.tags = q.tag.trim().toLowerCase().slice(0, 30);
  return w;
}

async function ensureBuilt(storeId) { // first visit after upgrading: build customers from existing orders once
  if (await Customer.exists({ store: storeId })) return;
  if (await Order.exists({ store: storeId })) await svc.rebuildStore(storeId);
}

router.get('/', asyncHandler(async (req, res) => {
  await ensureBuilt(sid(req));
  const w = where(req), limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100), page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const [total, rows, tags, summary] = await Promise.all([
    Customer.countDocuments(w), Customer.find(w).sort(SORTS[req.query.sort] || SORTS.recent).skip((page - 1) * limit).limit(limit),
    Customer.distinct('tags', { store: sid(req) }),
    Customer.aggregate([{ $match: { store: sid(req) } }, { $group: { _id: null, customers: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gte: ['$orderCount', 2] }, 1, 0] } }, spent: { $sum: '$totalSpentPaise' } } }]),
  ]);
  const s = summary[0] || { customers: 0, repeat: 0, spent: 0 };
  res.json({ customers: rows.map((c) => c.toApi()), total, page, pages: Math.max(1, Math.ceil(total / limit)), tags: tags.sort().slice(0, 100),
    summary: { customers: s.customers, repeatRate: s.customers ? Math.round((s.repeat / s.customers) * 100) : 0, averageLifetimeValue: s.customers ? Math.round(s.spent / s.customers) / 100 : 0 } });
}));

router.get('/export.csv', requireFeature('exports'), asyncHandler(async (req, res) => {
  const rows = await Customer.find(where(req)).sort(SORTS[req.query.sort] || SORTS.recent).limit(50000);
  sendCsv(res, `customers-${req.store.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Name', 'Phone', 'Email', 'Orders', 'Cancelled', 'Total spent (INR)', 'Average order (INR)', 'First order', 'Last order', 'Last order #', 'Segment', 'Tags', 'City', 'State', 'Pincode', 'COD blocked', 'Notes'],
    rows.map((c) => { const a = c.addresses[0] || {}; const x = c.toApi(); return [c.name, '+' + c.phone, c.email, c.orderCount, c.cancelledCount, x.totalSpent, x.averageOrder, c.firstOrderAt, c.lastOrderAt, c.lastOrderNumber, x.segment, c.tags.join('; '), a.city, a.state, a.pincode, c.codBlocked ? 'yes' : 'no', c.notes]; }));
}));

const rebuildLimiter = strictLimiter(60 * 60 * 1000, 6, 'You can rebuild customers a few times an hour.');
router.post('/rebuild', rebuildLimiter, asyncHandler(async (req, res) => res.json({ customers: await svc.rebuildStore(sid(req)) })));

async function load(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Customer not found.', 404, 'not_found');
  const c = await Customer.findOne({ store: sid(req), _id: req.params.id });
  if (!c) throw new AppError('Customer not found.', 404, 'not_found');
  return c;
}
router.get('/:id', asyncHandler(async (req, res) => {
  const c = await load(req);
  const orders = await Order.find({ store: sid(req), 'customer.phone': c.phone }).sort({ createdAt: -1 }).limit(50);
  res.json({ customer: c.toApi(), orders: orders.map((o) => ({ orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, total: o.totalPaise / 100, items: o.items.reduce((n, i) => n + i.qty, 0), createdAt: o.createdAt })) });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const c = await load(req), b = body(req), set = {}, fields = {};
  if (b.notes !== undefined) { if (typeof b.notes !== 'string' || b.notes.length > 2000) fields.notes = 'Notes are text up to 2000 characters.'; else set.notes = b.notes.trim(); }
  if (b.tags !== undefined) {
    const list = Array.isArray(b.tags) ? b.tags : typeof b.tags === 'string' ? b.tags.split(',') : null;
    if (!list || list.length > 10 || !list.every((t) => typeof t === 'string')) fields.tags = 'Up to 10 tags.';
    else { const clean = [...new Set(list.map((t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 30)).filter(Boolean))]; set.tags = clean; }
  }
  if (b.codBlocked !== undefined) { if (typeof b.codBlocked !== 'boolean') fields.codBlocked = 'Must be true or false.'; else set.codBlocked = b.codBlocked; }
  if (Object.keys(fields).length) throw badRequest(fields);
  const fresh = Object.keys(set).length ? await Customer.findOneAndUpdate({ store: sid(req), _id: c._id }, { $set: set }, { new: true }) : c;
  res.json({ customer: fresh.toApi() });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const c = await load(req);
  if (body(req).confirmPhone !== c.phone.slice(-10)) throw badRequest({ confirmPhone: 'Type the customer\'s 10-digit number to confirm.' });
  const r = await svc.erase(sid(req), c);
  if (!r.ok) throw new AppError(`This customer has ${r.open} open order${r.open === 1 ? '' : 's'}. Finish or cancel ${r.open === 1 ? 'it' : 'them'} first.`, 409, 'open_orders');
  res.json({ erased: true });
}));

module.exports = router;
