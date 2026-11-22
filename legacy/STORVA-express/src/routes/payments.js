'use strict';
// Owner payment dashboard + refunds, mounted at /api/stores/:storeId/payments.
// Every route sits behind requireAuth + loadOwnedStore (see routes/stores.js): req.store is ALWAYS the caller's own store, and every query below
// filters on store: req.store._id (the Order model's tenant guard throws if a query forgets it). Razorpay credentials never appear in any response.
const express = require('express');
const router = express.Router({ mergeParams: true });
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const { strictLimiter } = require('../middleware/rateLimit');
const { escapeRegex } = require('../utils/productInput');
const { paymentApi } = require('../utils/paymentView');
const refunds = require('../services/refunds');
const reconciliation = require('../services/reconciliation');
const Issue = require('../models/ReconciliationIssue');
const { registerCascade } = require('../middleware/tenant');

registerCascade(async (storeId) => { await Issue.deleteMany({ store: storeId }); });

const sid = (req) => req.store._id;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const refundLimiter = strictLimiter(60 * 1000, Number(process.env.REFUND_RATE_LIMIT) || 20, 'Too many refund requests. Please wait a minute.');
const reconcileLimiter = strictLimiter(60 * 1000, Number(process.env.RECONCILE_RATE_LIMIT) || 20, 'Too many checks. Please wait a minute.');
const r = (p) => (p || 0) / 100;

// Counts and money for the dashboard cards. Online = Razorpay orders; COD is shown separately because the gateway never sees it.
router.get('/summary', asyncHandler(async (req, res) => {
  const store = sid(req);
  const [online, inflight, cod] = await Promise.all([
    Order.aggregate([{ $match: { store, paymentMethod: 'razorpay' } }, { $group: { _id: '$paymentStatus', count: { $sum: 1 }, totalPaise: { $sum: '$totalPaise' }, refundedPaise: { $sum: '$refundedPaise' } } }]),
    Order.aggregate([{ $match: { store, paymentMethod: 'razorpay', paymentStatus: 'paid' } }, { $unwind: '$refunds' }, { $match: { 'refunds.status': { $in: ['pending', 'created'] } } }, { $group: { _id: null, count: { $sum: 1 }, paise: { $sum: '$refunds.amountPaise' } } }]),
    Order.aggregate([{ $match: { store, paymentMethod: 'cod', status: { $ne: 'cancelled' } } }, { $group: { _id: '$paymentStatus', count: { $sum: 1 }, totalPaise: { $sum: '$totalPaise' } } }]),
  ]);
  const by = (rows, k) => rows.find((x) => x._id === k) || { count: 0, totalPaise: 0, refundedPaise: 0 };
  const paid = by(online, 'paid'), refunded = by(online, 'refunded'), pending = by(online, 'pending'), unpaid = by(online, 'unpaid'), failed = by(online, 'failed');
  const refundedPaise = online.reduce((s, x) => s + (x.refundedPaise || 0), 0);
  const grossPaise = paid.totalPaise + refunded.totalPaise;
  const fl = inflight[0] || { count: 0, paise: 0 };
  res.json({
    summary: {
      successful: { count: paid.count + refunded.count, amount: r(grossPaise) },
      pending: { count: pending.count + unpaid.count, amount: r(pending.totalPaise + unpaid.totalPaise) },
      failed: { count: failed.count, amount: r(failed.totalPaise) },
      refunded: { amount: r(refundedPaise), fullyRefundedOrders: refunded.count },
      refundsInProgress: { count: fl.count, amount: r(fl.paise) },
      netCollected: r(grossPaise - refundedPaise),
      cod: { paid: { count: by(cod, 'paid').count, amount: r(by(cod, 'paid').totalPaise) }, unpaid: { count: by(cod, 'unpaid').count, amount: r(by(cod, 'unpaid').totalPaise) } },
    },
  });
}));

const FILTERS = {
  paid: { paymentStatus: 'paid' }, pending: { paymentStatus: { $in: ['pending', 'unpaid'] } }, failed: { paymentStatus: 'failed' }, refunded: { paymentStatus: 'refunded' },
  partially_refunded: { paymentStatus: 'paid', refundedPaise: { $gt: 0 } }, refund_pending: { paymentStatus: 'paid', refunds: { $elemMatch: { status: { $in: ['pending', 'created'] } } } },
};
router.get('/transactions', asyncHandler(async (req, res) => {
  const q = req.query, where = { store: sid(req) };
  where.paymentMethod = q.method === 'cod' ? 'cod' : 'razorpay'; // whitelist: never pass query text into a filter
  if (typeof q.status === 'string' && Object.prototype.hasOwnProperty.call(FILTERS, q.status)) Object.assign(where, FILTERS[q.status]);
  if (typeof q.q === 'string' && q.q.trim()) {
    const s = q.q.trim().slice(0, 60), re = new RegExp(escapeRegex(s), 'i');
    where.$or = [{ 'customer.name': re }, { 'customer.phone': re }, ...(/^\d{4,9}$/.test(s) ? [{ orderNumber: Number(s) }] : []), ...(/^pay_[A-Za-z0-9]{6,40}$/.test(s) ? [{ razorpayPaymentId: s }] : [])];
  }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [total, rows] = await Promise.all([Order.countDocuments(where), Order.find(where).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)]);
  res.json({ transactions: rows.map((o) => paymentApi(o)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// Discrepancies between our records and Razorpay that reconciliation would not fix by itself (see services/reconciliation.js). Registered BEFORE '/:orderNumber'.
router.get('/issues', asyncHandler(async (req, res) => res.json({ issues: await reconciliation.listIssues(req.store) })));
router.post('/issues/:issueId/dismiss', asyncHandler(async (req, res) => res.json(await reconciliation.dismissIssue(req.store, req.user, req.params.issueId))));

router.get('/:orderNumber', asyncHandler(async (req, res) => res.json({ payment: paymentApi(await refunds.loadOrder(req.store, req.params.orderNumber), { detail: true }) })));

router.post('/:orderNumber/refunds', refundLimiter, asyncHandler(async (req, res) => {
  const out = await refunds.initiateRefund(req.store, req.user, req.params.orderNumber, body(req));
  await require('../services/audit').record(req, 'refund.initiated', { targetType: 'order', targetId: String(req.params.orderNumber), meta: { replayed: Boolean(out.replayed), amountPaise: Number(body(req).amountPaise) || undefined } });
  res.status(out.replayed ? 200 : 201).json(out);
}));

// "Check with Razorpay": reads from Razorpay and moves the order FORWARD only (never downgrades paid/refunded). Safe to press repeatedly.
router.post('/:orderNumber/reconcile', reconcileLimiter, asyncHandler(async (req, res) => {
  const out = await reconciliation.reconcileOne(req.store, req.params.orderNumber);
  res.json({ changed: out.changed, issues: out.issues, nothingToCheck: out.nothingToCheck, payment: paymentApi(out.order, { detail: true }) });
}));

router.post('/:orderNumber/refunds/:key/retry', refundLimiter, asyncHandler(async (req, res) => res.json(await refunds.retryRefund(req.store, req.params.orderNumber, req.params.key))));

module.exports = router;
