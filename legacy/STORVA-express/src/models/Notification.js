'use strict';
// Module 13: in-app notifications for store owners (the bell in the dashboard). Kept 90 days.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');
const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true, maxlength: 40 },
  severity: { type: String, enum: ['info', 'success', 'warning', 'danger'], default: 'info' },
  title: { type: String, required: true, maxlength: 140 },
  body: { type: String, default: '', maxlength: 400 },
  link: { type: String, default: '', maxlength: 200 },              // dashboard hash route, e.g. #orders/1042
  dedupeKey: { type: String, default: null },
  readAt: { type: Date, default: null },
  expireAt: { type: Date, default: () => new Date(Date.now() + 90 * 864e5) },
}, { timestamps: true });
notificationSchema.plugin(tenantScoped);
notificationSchema.index({ store: 1, createdAt: -1 });
notificationSchema.index({ store: 1, readAt: 1 });
notificationSchema.index({ store: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.methods.toApi = function () { return { id: String(this._id), type: this.type, severity: this.severity, title: this.title, body: this.body, link: this.link, read: Boolean(this.readAt), createdAt: this.createdAt }; };
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
registerCascade(async (storeId) => { await Notification.deleteMany({ store: storeId }); await require('./OutboundMessage').deleteMany({ store: storeId }); });
module.exports = Notification;
