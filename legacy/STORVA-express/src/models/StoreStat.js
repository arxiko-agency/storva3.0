'use strict';
// Module 14: one row per store per India day with visitor counters (no cookies, no personal data). Sales figures are NOT stored
// here; they are always calculated from the orders, so refunds and cancellations are reflected immediately.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');

const SOURCES = ['direct', 'whatsapp', 'instagram', 'facebook', 'google', 'youtube', 'x', 'qr', 'other'];
const statSchema = new mongoose.Schema({
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  pageViews: { type: Number, default: 0 },
  visitors: { type: Number, default: 0 },         // distinct visitors that day (daily-salted hash, see services/analytics.js)
  productViews: { type: Number, default: 0 },
  productVisitors: { type: Number, default: 0 },   // visitors who opened at least one product (funnel step)
  cartAdds: { type: Number, default: 0 },
  cartVisitors: { type: Number, default: 0 },
  checkoutVisitors: { type: Number, default: 0 },
  sources: { type: Map, of: Number, default: {} },
  products: { type: Map, of: Number, default: {} }, // product id -> views
}, { timestamps: false, minimize: false });
statSchema.plugin(tenantScoped);
statSchema.index({ store: 1, day: 1 }, { unique: true });

// Marks "this visitor already did X today" so distinct counts stay distinct. Expires after 2 days.
const markSchema = new mongoose.Schema({ day: String, h: String, step: String, createdAt: { type: Date, default: Date.now, expires: 2 * 86400 } });
markSchema.plugin(tenantScoped);
markSchema.index({ store: 1, day: 1, h: 1, step: 1 }, { unique: true });

const StoreStat = mongoose.models.StoreStat || mongoose.model('StoreStat', statSchema);
const VisitMark = mongoose.models.VisitMark || mongoose.model('VisitMark', markSchema);
registerCascade(async (storeId) => { await StoreStat.deleteMany({ store: storeId }); await VisitMark.deleteMany({ store: storeId }); });
module.exports = { StoreStat, VisitMark, SOURCES };
