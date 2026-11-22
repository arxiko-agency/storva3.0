'use strict';
// Module 10: WhatsApp Cloud API webhooks.
//   GET  /webhooks/whatsapp[/<key>]  – Meta's subscription check (hub.verify_token must match; we echo hub.challenge)
//   POST /webhooks/whatsapp[/<key>]  – messages + delivery statuses, signed with X-Hub-Signature-256 = HMAC-SHA256(app secret, raw body)
// No <key> = the platform number (env secrets). With <key> = a store's own connected number (its own app secret, stored encrypted).
// We answer 200 quickly and handle messages in the background (Meta retries slow webhooks); every message is handled once.
const crypto = require('crypto');
const { WhatsAppConnection } = require('../models/WhatsApp');
const { open } = require('../utils/secretBox');
const { env } = require('../config/env');
const wa = require('./whatsapp');
const outbox = require('./outbox');

const pending = new Set();
const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); };

function safeEqual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function validSignature(raw, header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  return safeEqual(header.slice(7), crypto.createHmac('sha256', secret).update(raw).digest('hex'));
}

async function resolveContext(key) {
  if (!key) { const p = wa.platform(); return { secret: p.appSecret, verifyToken: p.verifyToken, connection: null }; }
  if (!/^[a-f0-9]{24}$/.test(key)) return null;
  const c = await WhatsAppConnection.findOne({ webhookKey: key }).setOptions({ skipTenant: true }).select('+appSecretEnc');
  if (!c) return null;
  return { secret: c.appSecretEnc ? open(c.appSecretEnc) : '', verifyToken: c.verifyToken, connection: c };
}

async function verifySubscription(key, q) {
  const ctx = await resolveContext(key);
  if (!ctx || !ctx.verifyToken) return { status: 404, body: 'Not found' };
  if (q['hub.mode'] === 'subscribe' && typeof q['hub.verify_token'] === 'string' && safeEqual(q['hub.verify_token'], ctx.verifyToken) && typeof q['hub.challenge'] === 'string') return { status: 200, body: q['hub.challenge'].slice(0, 200) };
  return { status: 403, body: 'Forbidden' };
}

async function handle(key, raw, signature) {
  const ctx = await resolveContext(key);
  if (!ctx) return { status: 404, body: { ok: false } };
  const unsignedOk = !env.isProd && process.env.WHATSAPP_ALLOW_UNSIGNED === 'true';
  if (!ctx.secret && !unsignedOk) return { status: 503, body: { ok: false, error: 'webhook secret not configured' } };
  if (ctx.secret && !validSignature(raw, signature, ctx.secret)) return { status: 401, body: { ok: false, error: 'bad signature' } };
  let json; try { json = JSON.parse(raw.toString('utf8')); } catch { return { status: 400, body: { ok: false } }; }
  if (!json || json.object !== 'whatsapp_business_account' || !Array.isArray(json.entry)) return { status: 200, body: { ok: true, ignored: true } };
  let messages = 0, statuses = 0;
  for (const entry of json.entry.slice(0, 20)) {
    for (const change of (Array.isArray(entry && entry.changes) ? entry.changes : []).slice(0, 20)) {
      const v = change && change.value; if (!v || change.field !== 'messages') continue;
      const pnid = v.metadata && String(v.metadata.phone_number_id || '');
      // A store webhook only accepts its own number; the platform webhook only the platform number (or any, if it is unset in dev).
      if (ctx.connection ? pnid !== ctx.connection.phoneNumberId : (wa.platform().phoneNumberId && pnid !== wa.platform().phoneNumberId)) continue;
      for (const st of (Array.isArray(v.statuses) ? v.statuses : []).slice(0, 100)) {
        statuses++;
        const err = Array.isArray(st.errors) && st.errors[0] ? `${st.errors[0].code || ''} ${st.errors[0].title || st.errors[0].message || ''}`.trim() : '';
        track(outbox.markProviderStatus(String(st.id || ''), st.status, st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date(), err).catch((e) => console.error('[wa] status update failed:', e.message)));
      }
      for (const m of (Array.isArray(v.messages) ? v.messages : []).slice(0, 50)) {
        messages++;
        track(require('./waCommands').handleMessage(m, { connection: ctx.connection }).catch((e) => console.error('[wa] message handling failed:', e.message)));
      }
    }
  }
  return { status: 200, body: { ok: true, messages, statuses } };
}

module.exports = { handle, verifySubscription, validSignature, drain };
