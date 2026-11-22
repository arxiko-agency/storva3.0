'use strict';
// Module 9: AI credit usage per store per calendar month (Asia/Kolkata). One row per (store, month).
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');
const aiUsageSchema = new mongoose.Schema({
  month: { type: String, required: true },                 // "2026-11"
  credits: { type: Number, default: 0, min: 0 },
  requests: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  byTool: { type: Map, of: Number, default: {} },
  lastUsedAt: { type: Date, default: null },
}, { timestamps: true });
aiUsageSchema.plugin(tenantScoped);
aiUsageSchema.index({ store: 1, month: 1 }, { unique: true });
const AiUsage = mongoose.models.AiUsage || mongoose.model('AiUsage', aiUsageSchema);
registerCascade(async (storeId) => { await AiUsage.deleteMany({ store: storeId }); });
module.exports = AiUsage;
