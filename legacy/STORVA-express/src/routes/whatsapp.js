'use strict';
// Module 10: WhatsApp settings for a store, mounted at /api/stores/:storeId/whatsapp.
//   GET    /             connection status, plan features, command list, recent conversations
//   PUT    /connection   { phoneNumberId, wabaId?, accessToken, appSecret? }  connect the store's own WhatsApp Business number (Pro+)
//   DELETE /connection   disconnect it (messages fall back to the STORVA number)
//   POST   /share        { productIds: [...] , intro? } ready-to-forward catalogue message + wa.me link
const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { badRequest } = require('../utils/validate');
const wa = require('../services/whatsapp');
const Product = require('../models/Product');
const { WhatsAppInbound } = require('../models/WhatsApp');
const { hasFeature } = require('../config/plans');
const { strictLimiter } = require('../middleware/rateLimit');
const { upgradeError } = require('../middleware/plan');
const { env } = require('../config/env');
const { inr } = require('../utils/messages');

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.get('/', asyncHandler(async (req, res) => {
  const st = await wa.status(req.store);
  const recent = await WhatsAppInbound.find({ store: req.store._id }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({
    ...st,
    features: { commands: hasFeature(req.store, 'whatsappCommands'), productUpload: hasFeature(req.store, 'whatsappProductUpload'), notifications: hasFeature(req.store, 'whatsappNotifications'), ownNumber: hasFeature(req.store, 'whatsappNotifications') },
    storeLink: `${env.appUrl}/store/${req.store.slug}`, qrUrl: `/store/${req.store.slug}/qr.svg`,
    commandNumber: st.platform.displayPhone,
    recent: recent.map((m) => ({ id: String(m._id), from: m.role === 'owner' ? 'You' : '+' + String(m.from).replace(/^(\d{2})\d+(\d{3})$/, '$1•••••$2'), role: m.role, type: m.type, text: m.text, command: m.command, reply: m.result, at: m.createdAt })),
  });
}));

const connectLimiter = strictLimiter(60 * 60 * 1000, 10, 'Too many connection attempts. Try again in an hour.');
router.put('/connection', connectLimiter, asyncHandler(async (req, res) => {
  if (!hasFeature(req.store, 'whatsappNotifications')) throw upgradeError(req.store, 'whatsappNotifications');
  res.json(await wa.connect(req.store, body(req)));
}));
router.delete('/connection', asyncHandler(async (req, res) => res.json(await wa.disconnect(req.store))));

router.post('/share', asyncHandler(async (req, res) => {
  const b = body(req);
  if (!Array.isArray(b.productIds) || !b.productIds.length || b.productIds.length > 10 || !b.productIds.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id))) throw badRequest({ productIds: 'Choose 1 to 10 products.' });
  const intro = typeof b.intro === 'string' ? b.intro.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const rows = await Product.find({ store: req.store._id, _id: { $in: b.productIds }, status: 'active' });
  if (!rows.length) throw badRequest({ productIds: 'Only published (active) products can be shared.' });
  const ordered = b.productIds.map((id) => rows.find((p) => String(p._id) === id)).filter(Boolean);
  const base = `${env.appUrl}/store/${req.store.slug}`;
  const text = [intro || `✨ New at *${req.store.name}*`, '', ...ordered.map((p) => `• *${p.title}* – ${inr(p.pricePaise)}\n  ${base}/product/${p.slug}?ref=wa`), '', `🛍️ Shop all: ${base}?ref=wa`].join('\n');
  res.json({ text, shareUrl: `https://wa.me/?text=${encodeURIComponent(text)}`, count: ordered.length });
}));

module.exports = router;
