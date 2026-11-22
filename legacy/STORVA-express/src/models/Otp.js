'use strict';
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true, index: true }, // normalized email or phone
  channel: { type: String, enum: ['email', 'phone'], required: true },
  purpose: { type: String, enum: ['register', 'login', 'reset'], required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
  // Records are kept ~1h after creation so hourly send caps can be enforced, then removed by MongoDB.
  purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: { createdAt: true, updatedAt: false } });

otpSchema.index({ identifier: 1, createdAt: -1 });

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
