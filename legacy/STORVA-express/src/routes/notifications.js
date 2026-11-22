'use strict';
// Module 13: owner notifications, mounted at /api/stores/:storeId/notifications.
//   GET    /               ?unread=1&limit=30&before=<iso>  in-app notifications (newest first) + unread count
//   POST   /read           { ids?: [...] }  mark some (or, without ids, all) as read
//   GET    /settings       alert preferences + where alerts are sent
//   PUT    /settings       update preferences (partial)
//   GET    /messages       delivery log of emails / WhatsApp messages (?channel=&status=)
//   POST   /test           { channel: 'email'|'whatsapp' } send a test alert to the owner
const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const OutboundMessage = require('../models/OutboundMessage');
const Store = require('../models/Store');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { badRequest } = require('../utils/validate');
const notifications = require('../services/notifications');
const outbox = require('../services/outbox');
const wa = require('../services/whatsapp');
const { hasFeature } = require('../config/plans');
const { strictLimiter } = require('../middleware/rateLimit');
const { upgradeError } = require('../middleware/plan');

const sid = (req) => req.store._id;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.get('/', asyncHandler(async (req, res) => {
  const where = { store: sid(req) };
  if (req.query.unread === '1') where.readAt = null;
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { $lt: before };
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const [rows, unread] = await Promise.all([Notification.find(where).sort({ createdAt: -1 }).limit(limit), Notification.countDocuments({ store: sid(req), readAt: null })]);
  res.json({ notifications: rows.map((n) => n.toApi()), unread });
}));

router.post('/read', asyncHandler(async (req, res) => {
  const b = body(req), where = { store: sid(req), readAt: null };
  if (b.ids !== undefined) {
    if (!Array.isArray(b.ids) || b.ids.length > 200 || !b.ids.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id))) throw badRequest({ ids: 'Send a list of notification ids.' });
    where._id = { $in: b.ids };
  }
  const r = await Notification.updateMany(where, { $set: { readAt: new Date() } });
  res.json({ updated: r.modifiedCount, unread: await Notification.countDocuments({ store: sid(req), readAt: null }) });
}));

async function settingsView(store) {
  const u = await User.findById(store.owner).select('email phone');
  const p = notifications.prefs(store);
  return {
    settings: p,
    sendTo: { email: store.contactEmail || (u && u.email) || '', whatsapp: store.whatsappNumber || (u && u.phone) || '' },
    whatsappAlertsAvailable: hasFeature(store, 'whatsappNotifications'),
    channels: { email: require('../services/delivery').mailConfigured(), whatsapp: (await wa.status(store)).sendingFrom !== 'none' },
  };
}
router.get('/settings', asyncHandler(async (req, res) => res.json(await settingsView(req.store))));

router.put('/settings', asyncHandler(async (req, res) => {
  const b = body(req), set = {}, fields = {};
  const bool = (group, key, v) => { if (typeof v !== 'boolean') fields[`${group}.${key}`] = 'Must be true or false.'; else set[`notifications.${group}.${key}`] = v; };
  for (const group of ['ownerEmail', 'ownerWhatsapp']) {
    if (b[group] === undefined) continue;
    if (!b[group] || typeof b[group] !== 'object' || Array.isArray(b[group])) { fields[group] = 'Invalid settings.'; continue; }
    for (const [k, v] of Object.entries(b[group])) { if (!(k in notifications.PREF_DEFAULTS[group])) fields[`${group}.${k}`] = 'Unknown setting.'; else bool(group, k, v); }
  }
  for (const k of ['buyerEmail', 'buyerWhatsapp']) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fields[k] = 'Must be true or false.'; else set[`notifications.${k}`] = b[k]; }
  if (b.lowStockThreshold !== undefined) { const n = b.lowStockThreshold; if (!Number.isInteger(n) || n < 0 || n > 1000) fields.lowStockThreshold = 'A whole number from 0 to 1000.'; else set['notifications.lowStockThreshold'] = n; }
  if (Object.keys(fields).length) throw badRequest(fields);
  if (Object.keys(set).length) await Store.updateOne({ _id: sid(req) }, { $set: set });
  res.json(await settingsView(await Store.findById(sid(req))));
}));

router.get('/messages', asyncHandler(async (req, res) => {
  const where = { store: sid(req) };
  if (['email', 'whatsapp'].includes(req.query.channel)) where.channel = req.query.channel;
  if (['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'].includes(req.query.status)) where.status = req.query.status;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const rows = await OutboundMessage.find(where).sort({ createdAt: -1 }).limit(limit);
  const since = new Date(Date.now() - 30 * 864e5);
  const stats = await OutboundMessage.aggregate([{ $match: { store: sid(req), createdAt: { $gte: since } } }, { $group: { _id: { c: '$channel', s: '$status' }, n: { $sum: 1 } } }]);
  res.json({ messages: rows.map((m) => m.toOwnerApi()), last30Days: stats.map((s) => ({ channel: s._id.c, status: s._id.s, count: s.n })) });
}));

const testLimiter = strictLimiter(60 * 60 * 1000, 10, 'You can send up to 10 test messages an hour.');
router.post('/test', testLimiter, asyncHandler(async (req, res) => {
  const channel = body(req).channel;
  if (!['email', 'whatsapp'].includes(channel)) throw badRequest({ channel: 'Choose email or whatsapp.' });
  const v = await settingsView(req.store), to = channel === 'email' ? v.sendTo.email : v.sendTo.whatsapp;
  if (!to) throw new AppError(channel === 'email' ? 'Add a contact email in Store settings first.' : 'Add a WhatsApp number in Store settings first.', 400, 'no_recipient');
  if (channel === 'whatsapp' && !v.whatsappAlertsAvailable) throw upgradeError(req.store, 'whatsappNotifications');
  const text = `✅ Test alert from STORVA for ${req.store.name}. Alerts will arrive like this.`;
  const payload = channel === 'email'
    ? { subject: `Test alert · ${req.store.name}`, text, html: `<p style="font-family:system-ui,sans-serif">${text.replace(/[<>&]/g, '')}</p>` }
    : { type: 'template', name: require('../utils/messages').TPL.lowStock(), language: process.env.WA_TEMPLATE_LANG || 'en', params: ['Test product', '3', req.store.name], text };
  const row = await outbox.enqueue({ store: sid(req), channel, audience: 'owner', kind: 'test', to, payload, dedupeKey: `test:${sid(req)}:${channel}:${Date.now()}` });
  if (row && process.env.OUTBOX_ENABLED !== 'false') await outbox.flush(5);
  const fresh = row ? await OutboundMessage.findById(row._id) : null;
  res.status(202).json({ message: fresh ? fresh.toOwnerApi() : null });
}));

module.exports = router;
