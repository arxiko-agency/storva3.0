'use strict';
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  phone: { type: String, required: true, unique: true }, // digits with country code, e.g. 919876543210
  passwordHash: { type: String, required: true, select: false },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  // Registration challenges live with their immutable owner. Activation and consumption
  // must be a single-document atomic update (also works on standalone MongoDB).
  registration: {
    type: new mongoose.Schema({
      channel: { type: String, enum: ['email', 'phone'] },
      identifier: String,
      codeHash: String,
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
      consumedAt: { type: Date, default: null },
    }, { _id: false }),
    select: false,
  },
  role: { type: String, enum: ['owner', 'admin'], default: 'owner' }, // 'admin' = platform admin (Module: admin dashboard)
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  failedLogins: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  referredByCode: { type: String, default: null },       // affiliate code captured at sign-up; becomes a Referral once the account is verified (services/affiliates.js)
  waActiveStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null }, // Module 10: which store WhatsApp commands act on (owners with several stores)
}, { timestamps: true });

userSchema.virtual('verified').get(function () { return this.emailVerified || this.phoneVerified; });

userSchema.methods.toPublic = function () {
  return {
    id: String(this._id), name: this.name, email: this.email, phone: this.phone,
    emailVerified: this.emailVerified, phoneVerified: this.phoneVerified,
    role: this.role, createdAt: this.createdAt,
  };
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
