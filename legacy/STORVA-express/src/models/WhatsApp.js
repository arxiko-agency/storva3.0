'use strict';
// Module 10: WhatsApp Cloud API data. A store may connect its OWN WhatsApp Business number (token stored encrypted);
// otherwise messages go from the platform number configured in the environment.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');

const connectionSchema = new mongoose.Schema({
  phoneNumberId: { type: String, required: true, maxlength: 40 },
  wabaId: { type: String, default: '', maxlength: 40 },
  displayPhone: { type: String, default: '', maxlength: 40 },
  verifiedName: { type: String, default: '', maxlength: 120 },
  tokenEnc: { type: String, required: true, select: false },        // AES-256-GCM, see utils/secretBox.js
  appSecretEnc: { type: String, default: '', select: false },        // the owner's Meta app secret: needed to verify their webhook calls
  webhookKey: { type: String, required: true },                      // public part of this store's webhook URL: /webhooks/whatsapp/<key>
  verifyToken: { type: String, required: true },                     // the owner pastes this into Meta when adding the webhook
  status: { type: String, enum: ['connected', 'error'], default: 'connected' },
  lastError: { type: String, default: '', maxlength: 200 },
  connectedAt: { type: Date, default: () => new Date() },
}, { timestamps: true });
connectionSchema.plugin(tenantScoped, { uniqueStore: true });
connectionSchema.index({ phoneNumberId: 1 }, { unique: true });
connectionSchema.index({ webhookKey: 1 }, { unique: true });

// Inbound messages (log for the dashboard + command history). Kept 60 days. store is null when the sender could not be matched.
const inboundSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  waMessageId: { type: String, required: true },
  from: { type: String, required: true, maxlength: 20 },
  role: { type: String, enum: ['owner', 'shopper', 'unknown'], default: 'unknown' },
  type: { type: String, default: 'text', maxlength: 20 },
  text: { type: String, default: '', maxlength: 500 },
  command: { type: String, default: '', maxlength: 40 },
  result: { type: String, default: '', maxlength: 300 },
  expireAt: { type: Date, default: () => new Date(Date.now() + 60 * 864e5) },
}, { timestamps: true });
inboundSchema.index({ waMessageId: 1 }, { unique: true });   // WhatsApp retries webhooks: each message is handled once
inboundSchema.index({ store: 1, createdAt: -1 });
inboundSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// People who replied STOP. store = null means "from the platform number" (all stores using it).
const optOutSchema = new mongoose.Schema({
  phone: { type: String, required: true, maxlength: 20 },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
}, { timestamps: true });
optOutSchema.index({ phone: 1, store: 1 }, { unique: true });

const WhatsAppConnection = mongoose.models.WhatsAppConnection || mongoose.model('WhatsAppConnection', connectionSchema);
const WhatsAppInbound = mongoose.models.WhatsAppInbound || mongoose.model('WhatsAppInbound', inboundSchema);
const WhatsAppOptOut = mongoose.models.WhatsAppOptOut || mongoose.model('WhatsAppOptOut', optOutSchema);
registerCascade(async (storeId) => {
  await WhatsAppConnection.deleteMany({ store: storeId });
  await WhatsAppInbound.deleteMany({ store: storeId });
  await WhatsAppOptOut.deleteMany({ store: storeId });
});
module.exports = { WhatsAppConnection, WhatsAppInbound, WhatsAppOptOut };
