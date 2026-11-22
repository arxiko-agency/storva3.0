'use strict';
// /api/affiliate/*  — affiliate registration, the affiliate's own dashboard numbers, and platform-admin payout tools.
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { requireAuth, requireRole } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimit');
const Affiliate = require('../models/Affiliate');
const affiliates = require('../services/affiliates');
const audit = require('../services/audit');
const { env } = require('../config/env');

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const writeLimiter = strictLimiter(60 * 60 * 1000, 30, 'Too many changes. Please try again later.');
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const idParam = (req) => { if (!OBJECT_ID.test(req.params.id)) throw new AppError('Not found.', 404, 'not_found'); return req.params.id; };
const linkFor = (a) => `${env.appUrl}/r/${a.code}`;
const mine = async (req) => { const a = await Affiliate.findOne({ user: req.user._id }); if (!a) throw new AppError('You have not joined the affiliate program yet.', 404, 'not_affiliate'); return a; };

// Public: what the program offers (the affiliate page shows this before sign-in).
router.get('/program', (req, res) => res.json({ program: affiliates.programInfo() }));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const a = await Affiliate.findOne({ user: req.user._id });
  res.json({ program: affiliates.programInfo(), affiliate: a ? { ...a.toApi(), link: linkFor(a) } : null });
}));

router.post('/register', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const { affiliate, created } = await affiliates.joinProgram(req.user, body(req));
  if (created) await audit.record(req, 'affiliate.registered', { targetType: 'affiliate', targetId: String(affiliate._id) });
  res.status(created ? 201 : 200).json({ affiliate: { ...affiliate.toApi(), link: linkFor(affiliate) }, created });
}));

router.patch('/me', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const a = await affiliates.updateProfile(await mine(req), body(req));
  res.json({ affiliate: { ...a.toApi(), link: linkFor(a) } });
}));

router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
  const a = await mine(req);
  res.json({ affiliate: { ...a.toApi(), link: linkFor(a) }, ...(await affiliates.stats(a)) });
}));

// ---- platform admin ------------------------------------------------------------------------------
const admin = [requireAuth, requireRole('admin')];
router.get('/admin/list', ...admin, asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(await affiliates.adminList({ page }));
}));
router.post('/admin/:id/status', ...admin, writeLimiter, asyncHandler(async (req, res) => {
  const a = await affiliates.setStatus(idParam(req), body(req).status);
  await audit.record(req, 'affiliate.status_changed', { targetType: 'affiliate', targetId: String(a._id), meta: { status: a.status } });
  res.json({ affiliate: a.toApi() });
}));
router.post('/admin/:id/payout', ...admin, writeLimiter, asyncHandler(async (req, res) => {
  const r = await affiliates.recordPayout(idParam(req), { reference: body(req).reference });
  await audit.record(req, 'affiliate.payout_recorded', { targetType: 'affiliate', targetId: idParam(req), meta: { paid: r.paid, commissions: r.commissions } });
  res.json(r);
}));
router.post('/admin/commissions/:id/void', ...admin, writeLimiter, asyncHandler(async (req, res) => {
  const c = await affiliates.voidCommission(idParam(req), body(req).reason);
  await audit.record(req, 'affiliate.commission_voided', { targetType: 'commission', targetId: String(c._id) });
  res.json({ commission: c.toApi() });
}));
router.post('/admin/sync', ...admin, writeLimiter, asyncHandler(async (req, res) => res.json(await affiliates.syncMissing({ days: Math.min(90, Math.max(1, parseInt(body(req).days, 10) || 7)) }))));

module.exports = router;
