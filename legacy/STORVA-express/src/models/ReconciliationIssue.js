'use strict';
// A discrepancy between our records and Razorpay that reconciliation refused to "fix" on its own and that a human must look at.
// One row per (order, code, reference): seeing the same problem again only updates lastSeenAt/occurrences, so runs never pile up duplicates.
// Tenant-scoped (store owners see only their own). Holds NO customer data: fixed text, ids and amounts only.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { Schema } = mongoose;

const schema = new Schema({
  orderId: { type: Schema.Types.ObjectId, required: true },
  orderNumber: { type: Number, required: true },
  key: { type: String, required: true },                           // `${orderId}:${code}:${reference}`
  code: { type: String, required: true },
  message: { type: String, default: '' },
  detail: { type: String, default: '', maxlength: 300 },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  occurrences: { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null },                       // closed automatically: the problem was not seen again
  dismissedAt: { type: Date, default: null },                      // closed by the owner
  dismissedBy: { type: Schema.Types.ObjectId, default: null },
  expireAt: { type: Date, default: null },                         // set when closed: the row is removed 90 days later
}, { timestamps: true });
schema.plugin(tenantScoped);
schema.index({ store: 1, key: 1 }, { unique: true });
schema.index({ store: 1, status: 1, lastSeenAt: -1 });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

schema.methods.toOwnerApi = function () {
  return { id: String(this._id), orderNumber: this.orderNumber, code: this.code, message: this.message, detail: this.detail, occurrences: this.occurrences, firstSeenAt: this.firstSeenAt, lastSeenAt: this.lastSeenAt };
};
module.exports = mongoose.models.ReconciliationIssue || mongoose.model('ReconciliationIssue', schema);
