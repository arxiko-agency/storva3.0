'use strict';
// Module 10: WhatsApp configuration, senders and connections. Platform number = env (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID);
// a store on Pro/Advanced may connect its own WhatsApp Business number instead (token encrypted with utils/secretBox.js).
const { WhatsAppConnection, WhatsAppOptOut } = require('../models/WhatsApp');
const { seal, open } = require('../utils/secretBox');
const AppError = require('../utils/AppError');
const api = require('./whatsappApi');

const platform = () => ({ token: process.env.WHATSAPP_TOKEN || '', phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '', verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '', appSecret: process.env.WHATSAPP_APP_SECRET || '', displayPhone: (process.env.WHATSAPP_DISPLAY_NUMBER || '').replace(/\D/g, '') });
const platformConfigured = () => Boolean(platform().token && platform().phoneNumberId);

async function connectionFor(storeId) {
  if (!storeId) return null;
  return WhatsAppConnection.findOne({ store: storeId, status: 'connected' }).select('+tokenEnc');
}
// Which number sends for this store: its own (if connected and the token can be decrypted) or the platform number.
async function senderFor(storeId) {
  const c = await connectionFor(storeId);
  if (c) { const token = open(c.tokenEnc); if (token) return { phoneNumberId: c.phoneNumberId, token, own: true, connection: c }; }
  if (platformConfigured()) return { phoneNumberId: platform().phoneNumberId, token: platform().token, own: false };
  return null;
}
async function isOptedOut(phone, storeId) {
  const or = [{ phone, store: null }]; if (storeId) or.push({ phone, store: storeId });
  return Boolean(await WhatsAppOptOut.exists({ $or: or }));
}
async function setOptOut(phone, storeId, out) {
  if (out) await WhatsAppOptOut.updateOne({ phone, store: storeId || null }, { $setOnInsert: { phone, store: storeId || null } }, { upsert: true }).catch((e) => { if (e.code !== 11000) throw e; });
  else await WhatsAppOptOut.deleteOne({ phone, store: storeId || null });
}

async function connect(store, input) {
  const b = input && typeof input === 'object' ? input : {};
  const phoneNumberId = typeof b.phoneNumberId === 'string' ? b.phoneNumberId.trim() : '';
  const wabaId = typeof b.wabaId === 'string' ? b.wabaId.trim() : '';
  const token = typeof b.accessToken === 'string' ? b.accessToken.trim() : '';
  const appSecret = typeof b.appSecret === 'string' ? b.appSecret.trim() : '';
  const fields = {};
  if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret)) fields.appSecret = 'The App secret is 32 letters and digits (Meta → App settings → Basic).';
  if (!/^\d{6,30}$/.test(phoneNumberId)) fields.phoneNumberId = 'Enter the Phone number ID from Meta (digits only).';
  if (wabaId && !/^\d{6,30}$/.test(wabaId)) fields.wabaId = 'The WhatsApp Business Account ID is digits only.';
  if (token.length < 50 || token.length > 600 || /\s/.test(token)) fields.accessToken = 'Paste the permanent access token (system user token) from Meta.';
  if (Object.keys(fields).length) throw new AppError('Please check the connection details.', 400, 'validation_error', { fields });
  let info;
  try { info = await api.getPhoneInfo(phoneNumberId, token); } catch (e) { throw new AppError(`WhatsApp did not accept these details: ${e.message}`, 400, 'whatsapp_rejected', { fields: { accessToken: 'Check the token and the phone number ID.' } }); }
  const taken = await WhatsAppConnection.findOne({ phoneNumberId }).setOptions({ skipTenant: true }).select('store').lean();
  if (taken && String(taken.store) !== String(store._id)) throw new AppError('This WhatsApp number is already connected to another store.', 409, 'whatsapp_taken');
  const crypto = require('crypto');
  await WhatsAppConnection.updateOne({ store: store._id },
    { $set: { store: store._id, phoneNumberId, wabaId, displayPhone: info.displayPhone, verifiedName: info.verifiedName, tokenEnc: seal(token), ...(appSecret ? { appSecretEnc: seal(appSecret) } : {}), status: 'connected', lastError: '', connectedAt: new Date() },
      $setOnInsert: { webhookKey: crypto.randomBytes(12).toString('hex'), verifyToken: crypto.randomBytes(16).toString('base64url') } }, { upsert: true });
  return status(store);
}
async function disconnect(store) { await WhatsAppConnection.deleteOne({ store: store._id }); return status(store); }

async function status(store) {
  const c = await WhatsAppConnection.findOne({ store: store._id }).select('+appSecretEnc').lean();
  const { env } = require('../config/env');
  return {
    platform: { configured: platformConfigured(), displayPhone: platform().displayPhone || null, webhookReady: Boolean(platform().verifyToken && platform().appSecret) },
    own: c ? { connected: c.status === 'connected', phoneNumberId: c.phoneNumberId, displayPhone: c.displayPhone, verifiedName: c.verifiedName, status: c.status, lastError: c.lastError, connectedAt: c.connectedAt,
      webhook: { url: `${env.appUrl}/webhooks/whatsapp/${c.webhookKey}`, verifyToken: c.verifyToken, appSecretSaved: Boolean(c.appSecretEnc) } } : null,
    sendingFrom: c && c.status === 'connected' ? 'own' : platformConfigured() ? 'platform' : 'none',
  };
}

module.exports = { platform, platformConfigured, senderFor, connectionFor, isOptedOut, setOptOut, connect, disconnect, status };
