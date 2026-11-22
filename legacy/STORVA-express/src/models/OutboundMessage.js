'use strict';
// Modules 10 + 13: the outbox. Every email and WhatsApp message is first written here, then sent by the outbox worker with retries.
// dedupeKey makes each logical message (e.g. "order 1042 shipped, WhatsApp to buyer") exist at most once, so re-emitted events
// and retried jobs can never spam anyone. Not tenant-scoped on purpose: some messages are platform-level (store = null); store-owned
// rows always carry `store` and every owner-facing query filters on it.
const mongoose = require('mongoose');

const outboundSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  channel: { type: String, enum: ['email', 'whatsapp'], required: true },
  audience: { type: String, enum: ['owner', 'buyer', 'platform'], default: 'owner' },
  kind: { type: String, required: true, maxlength: 60 },             // e.g. order_confirmation, new_order_alert, wa_reply
  to: { type: String, required: true, maxlength: 254 },              // email address or digits with country code
  payload: { type: mongoose.Schema.Types.Mixed, required: true },     // email: {subject,text,html}; whatsapp: {type:'template'|'text'|'image', ...}
  status: { type: String, enum: ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: () => new Date() },
  lockedAt: { type: Date, default: null },
  providerId: { type: String, default: null },                        // WhatsApp message id (wamid...) or SMTP message id
  lastError: { type: String, default: '', maxlength: 300 },
  dedupeKey: { type: String, default: null },
  sentAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  expireAt: { type: Date, default: () => new Date(Date.now() + 120 * 864e5) }, // the log is kept for 120 days
}, { timestamps: true });
outboundSchema.index({ status: 1, nextAttemptAt: 1 });
outboundSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
outboundSchema.index({ providerId: 1 }, { partialFilterExpression: { providerId: { $type: 'string' } } });
outboundSchema.index({ store: 1, createdAt: -1 });
outboundSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const mask = (to, channel) => (channel === 'email' ? to.replace(/^(.).*?(.?)@/, '$1•••$2@') : to.replace(/^(\d{2})\d+(\d{3})$/, '+$1•••••$2'));
outboundSchema.methods.toOwnerApi = function () {
  return { id: String(this._id), channel: this.channel, audience: this.audience, kind: this.kind, to: mask(this.to, this.channel), status: this.status, attempts: this.attempts, lastError: this.lastError, createdAt: this.createdAt, sentAt: this.sentAt, deliveredAt: this.deliveredAt, readAt: this.readAt };
};
module.exports = mongoose.models.OutboundMessage || mongoose.model('OutboundMessage', outboundSchema);
