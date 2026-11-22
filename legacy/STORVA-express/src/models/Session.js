'use strict';
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true }, // the raw token only ever lives in the browser cookie
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  lastSeenAt: { type: Date, default: Date.now },
  ip: String,
  userAgent: { type: String, maxlength: 300 },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
