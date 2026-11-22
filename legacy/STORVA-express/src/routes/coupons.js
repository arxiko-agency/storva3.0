'use strict';
// Owner coupon management, mounted at /api/stores/:storeId/coupons.
const router = require('express').Router({ mergeParams: true });
const Coupon = require('../models/Coupon');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/validate');
const { readCoupon } = require('../utils/couponInput');
const { registerCascade } = require('../middleware/tenant');
const { requireFeature } = require('../middleware/plan');

const sid = (req) => req.store._id;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const MAX_COUPONS = 200;
registerCascade(async (storeId) => { await Coupon.deleteMany({ store: storeId }); });

async function load(req) {
  const id = req.params.couponId;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new AppError('Coupon not found.', 404, 'not_found');
  const c = await Coupon.findOne({ _id: id, store: sid(req) });
  if (!c) throw new AppError('Coupon not found.', 404, 'not_found');
  return c;
}

router.get('/', asyncHandler(async (req, res) => {
  const rows = await Coupon.find({ store: sid(req) }).sort({ createdAt: -1 });
  res.json({ coupons: rows.map((c) => c.toApi()) });
}));

router.post('/', requireFeature('coupons'), asyncHandler(async (req, res) => {
  const { data, fields } = readCoupon(body(req), { partial: false });
  if (Object.keys(fields).length) throw badRequest(fields);
  if (await Coupon.countDocuments({ store: sid(req) }) >= MAX_COUPONS) throw new AppError('Coupon limit reached.', 403, 'coupon_limit');
  try { res.status(201).json({ coupon: (await Coupon.create({ ...data, store: sid(req) })).toApi() }); }
  catch (e) { if (e && e.code === 11000) throw new AppError('You already have a coupon with this code.', 409, 'duplicate', { fields: { code: 'You already have a coupon with this code.' } }); throw e; }
}));

router.get('/:couponId', asyncHandler(async (req, res) => res.json({ coupon: (await load(req)).toApi() })));

router.patch('/:couponId', requireFeature('coupons'), asyncHandler(async (req, res) => {
  const c = await load(req);
  const { data, fields } = readCoupon(body(req), { partial: true, existing: c.toObject() });
  if (Object.keys(fields).length) throw badRequest(fields);
  c.set(data); await c.save();
  res.json({ coupon: c.toApi() });
}));

router.delete('/:couponId', asyncHandler(async (req, res) => {
  const c = await load(req);
  await Coupon.deleteOne({ _id: c._id, store: sid(req) }); // past orders keep the code as a snapshot
  res.json({ ok: true });
}));

module.exports = router;
