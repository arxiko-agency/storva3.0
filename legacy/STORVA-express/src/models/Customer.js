'use strict';
// Module 11: one record per buyer phone number per store, built automatically from orders (services/customers.js).
// Stats are RECOMPUTED from the orders each time (never incremented), so repeated events, cancellations and refunds can't skew them.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');

const addressSchema = new mongoose.Schema({ line1: String, line2: { type: String, default: '' }, city: String, state: String, pincode: String, lastUsedAt: Date }, { _id: false });
const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, maxlength: 15 },                // digits with country code (the identity)
  name: { type: String, default: '', maxlength: 80 },
  email: { type: String, default: '', maxlength: 254 },
  addresses: { type: [addressSchema], default: [] },                       // most recent first, up to 3 distinct
  orderCount: { type: Number, default: 0 },                                // orders that were not cancelled
  cancelledCount: { type: Number, default: 0 },
  totalSpentPaise: { type: Number, default: 0 },                           // non-cancelled order totals minus refunds
  firstOrderAt: { type: Date, default: null },
  lastOrderAt: { type: Date, default: null },
  lastOrderNumber: { type: Number, default: null },
  tags: { type: [String], default: [] },
  notes: { type: String, default: '', maxlength: 2000 },                   // private to the owner
  codBlocked: { type: Boolean, default: false },                           // owner can stop cash on delivery for a number (fake orders)
  erasedAt: { type: Date, default: null },
}, { timestamps: true });
customerSchema.plugin(tenantScoped);
customerSchema.index({ store: 1, phone: 1 }, { unique: true });
customerSchema.index({ store: 1, lastOrderAt: -1 });
customerSchema.index({ store: 1, totalSpentPaise: -1 });
customerSchema.index({ store: 1, orderCount: -1 });
customerSchema.index({ store: 1, tags: 1 });

const r = (p) => (p == null ? null : p / 100);
customerSchema.methods.segment = function (now = new Date()) {
  if (this.lastOrderAt && now - this.lastOrderAt > 90 * 864e5) return 'inactive';
  if (this.orderCount >= 3 || this.totalSpentPaise >= 500000) return 'vip';
  if (this.orderCount >= 2) return 'repeat';
  return this.orderCount === 1 ? 'new' : 'none';
};
customerSchema.methods.toApi = function () {
  return { id: String(this._id), phone: this.phone, name: this.name, email: this.email, addresses: this.addresses.map((a) => ({ line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode })),
    orderCount: this.orderCount, cancelledCount: this.cancelledCount, totalSpent: r(this.totalSpentPaise), averageOrder: this.orderCount ? r(Math.round(this.totalSpentPaise / this.orderCount)) : 0,
    firstOrderAt: this.firstOrderAt, lastOrderAt: this.lastOrderAt, lastOrderNumber: this.lastOrderNumber, tags: this.tags, notes: this.notes, codBlocked: this.codBlocked, segment: this.segment(), createdAt: this.createdAt };
};
const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
registerCascade(async (storeId) => { await Customer.deleteMany({ store: storeId }); });
module.exports = Customer;
