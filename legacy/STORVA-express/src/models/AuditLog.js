'use strict';
// Append-only record of who did what: refunds, order changes, password changes, logins, logout-all.
// Platform-level (store is optional because account events have no store) and never edited or deleted by the app.
// Holds ids, an action name and a few small facts: no passwords, tokens, OTPs, card data or request bodies.
const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, immutable: true },
  store: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  actorType: { type: String, enum: ['user', 'system', 'webhook'], default: 'user', immutable: true },
  actor: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  action: { type: String, required: true, maxlength: 60, immutable: true },          // e.g. refund.initiated, order.updated, auth.password_changed
  targetType: { type: String, default: '', maxlength: 30, immutable: true },
  targetId: { type: String, default: '', maxlength: 60, immutable: true },
  requestId: { type: String, default: '', maxlength: 64, immutable: true },
  ip: { type: String, default: '', maxlength: 64, immutable: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true },
}, { versionKey: false });
auditSchema.index({ store: 1, at: -1 });
auditSchema.index({ actor: 1, at: -1 });
auditSchema.index({ action: 1, at: -1 });

// Append-only: refuse updates and deletes made through the model.
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany'].forEach((op) => {
  auditSchema.pre(op, function (next) { next(new Error('AuditLog is append-only')); });
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
