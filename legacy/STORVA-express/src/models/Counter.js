'use strict';
// Per-store atomic counters (order numbers). Tenant-scoped like everything else.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const counterSchema = new mongoose.Schema({ key: { type: String, required: true }, seq: { type: Number, default: 0 } });
counterSchema.plugin(tenantScoped);
counterSchema.index({ store: 1, key: 1 }, { unique: true });
module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
