'use strict';
// One row per Razorpay webhook event id: the idempotency ledger and an audit trail. Platform-level (not tenant-scoped) because a
// webhook arrives before we know which store it belongs to. Holds NO payload (no customer data), only ids and the outcome.
const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  eventKey: { type: String, required: true },                      // X-Razorpay-Event-Id (or a hash of the body)
  event: { type: String, default: '' },
  status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing' },
  outcome: { type: String, default: '' },                         // applied:paid, noop:already_paid, ignored:amount_mismatch, ...
  attempts: { type: Number, default: 1 },
  lockedAt: { type: Date, default: null },
  error: { type: String, default: '' },
  storeId: { type: Schema.Types.ObjectId, default: null },
  orderNumber: { type: Number, default: null },
}, { timestamps: true });
schema.index({ eventKey: 1 }, { unique: true });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 }); // Razorpay retries for about a day; 60 days of history is plenty
module.exports = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', schema);
