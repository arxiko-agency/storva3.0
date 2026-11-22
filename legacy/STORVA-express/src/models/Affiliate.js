'use strict';
const mongoose = require('mongoose');

// One row per user who joined the affiliate program. Platform-level (not tenant-scoped): affiliates promote STORVA itself.
const affiliateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },   // the referral code in /r/CODE
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },          // suspended by a platform admin: link stops tracking, nothing new is earned
  upiId: { type: String, default: '', maxlength: 100 },                                // where payouts are sent (optional until the first payout)
  commissionBps: { type: Number, default: null, min: 0, max: 9000 },                   // per-affiliate override of the default rate; null = program default
  clicks: { type: Number, default: 0, min: 0 },
  termsAcceptedAt: { type: Date, default: null },
}, { timestamps: true });

affiliateSchema.methods.toApi = function () {
  return { id: String(this._id), code: this.code, status: this.status, upiId: this.upiId, commissionPercent: this.commissionBps == null ? null : this.commissionBps / 100, clicks: this.clicks, createdAt: this.createdAt };
};
module.exports = mongoose.models.Affiliate || mongoose.model('Affiliate', affiliateSchema);
