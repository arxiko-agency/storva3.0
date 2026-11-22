'use strict';
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 20 },
  description: { type: String, default: '', maxlength: 200 },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { type: Number, required: true, min: 1 },            // percent (1-100) or paise
  minOrderPaise: { type: Number, default: 0, min: 0 },
  maxDiscountPaise: { type: Number, default: null, min: 0 },   // cap for percent coupons
  startsAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  usageLimit: { type: Number, default: null, min: 1 },         // null = unlimited
  usedCount: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });
couponSchema.plugin(tenantScoped);
couponSchema.index({ store: 1, code: 1 }, { unique: true });   // the same code may exist in different stores

const rupees = (p) => (p == null ? null : p / 100);
couponSchema.methods.toApi = function () {
  return {
    id: String(this._id), code: this.code, description: this.description, type: this.type,
    value: this.type === 'fixed' ? rupees(this.value) : this.value,
    minOrder: rupees(this.minOrderPaise), maxDiscount: rupees(this.maxDiscountPaise),
    startsAt: this.startsAt, expiresAt: this.expiresAt, usageLimit: this.usageLimit, usedCount: this.usedCount, active: this.active,
    createdAt: this.createdAt,
  };
};
module.exports = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
