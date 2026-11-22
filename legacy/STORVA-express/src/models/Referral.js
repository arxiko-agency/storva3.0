'use strict';
const mongoose = require('mongoose');

// One row per referred user. `referredUser` is unique: a person can only ever be attributed to ONE affiliate (the first confirmed attribution wins).
const referralSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate', required: true, index: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  code: { type: String, required: true },                      // the code that was used (kept even if the affiliate later changes anything)
  status: { type: String, enum: ['signed_up', 'converted'], default: 'signed_up' }, // converted = made at least one paid plan payment
  convertedAt: { type: Date, default: null },
  paidPayments: { type: Number, default: 0, min: 0 },          // commission-earning payments counted so far (capped by AFFILIATE_MAX_PAYMENTS)
}, { timestamps: true });
referralSchema.index({ affiliate: 1, createdAt: -1 });
module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);
