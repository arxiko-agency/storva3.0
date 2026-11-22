'use strict';
// Modules 10 + 13: delivery queue for email and WhatsApp. enqueue() writes the message (deduplicated), then the worker sends it,
// retrying temporary failures with back-off (1 min, 5 min, 30 min, 2 h, 6 h) and giving up after 6 attempts. Safe on several
// instances: a message is claimed with a compare-and-set before sending, and stale claims (crashed worker) are released after 5 min.
const OutboundMessage = require('../models/OutboundMessage');
const { env } = require('../config/env');

const BACKOFF_MIN = [1, 5, 30, 120, 360];
const MAX_ATTEMPTS = 6;
const LOCK_MS = 5 * 60 * 1000;
const enabled = () => process.env.OUTBOX_ENABLED !== 'false';

async function enqueue(msg) {
  if (!msg || !msg.to) return null;
  try {
    const row = await OutboundMessage.create({ ...msg, status: 'queued', nextAttemptAt: msg.sendAt || new Date() });
    if (enabled()) setImmediate(() => flush(5).catch((e) => console.error('[outbox] flush failed:', e.message)));
    return row;
  } catch (e) {
    if (e && e.code === 11000) return null; // same dedupeKey: this message was already queued once
    throw e;
  }
}

async function claimNext(now = new Date()) {
  return OutboundMessage.findOneAndUpdate(
    { $or: [{ status: 'queued', nextAttemptAt: { $lte: now } }, { status: 'sending', lockedAt: { $lt: new Date(now - LOCK_MS) } }] },
    { $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } });
}

async function deliverEmail(m) {
  const delivery = require('./delivery');
  if (!delivery.mailConfigured()) {
    if (!env.isProd) console.log(`[outbox:dev] EMAIL to ${m.to} · ${m.payload.subject}\n${String(m.payload.text || '').slice(0, 600)}`);
    return { skipped: 'Email (SMTP) is not configured' + (env.isProd ? '' : '; the message was printed to the server log') };
  }
  const info = await delivery.getTransporter().sendMail({ from: env.smtp.from, to: m.to, subject: m.payload.subject, text: m.payload.text, html: m.payload.html, ...(m.payload.replyTo ? { replyTo: m.payload.replyTo } : {}) });
  return { id: info && info.messageId ? String(info.messageId).slice(0, 120) : null };
}

async function deliverWhatsApp(m) {
  const wa = require('./whatsapp');
  if (await wa.isOptedOut(m.to, m.store)) return { skipped: 'The recipient replied STOP' };
  // Replies go back from the number the person wrote to (payload.via); everything else from the store's own number if connected.
  const sender = await wa.senderFor(m.payload.via === 'platform' ? null : m.store);
  if (!sender) {
    if (!env.isProd) console.log(`[outbox:dev] WHATSAPP to +${m.to} · ${m.payload.type === 'template' ? 'template ' + m.payload.name : m.payload.type}\n${String(m.payload.text || m.payload.caption || '').slice(0, 600)}`);
    return { skipped: 'WhatsApp is not configured' + (env.isProd ? '' : '; the message was printed to the server log') };
  }
  // Inside the 24-hour customer-service window a template is not needed; owners talking to the bot are always inside it.
  const payload = m.payload.type === 'template' && m.payload.preferText ? { type: 'text', text: m.payload.text } : m.payload;
  const r = await require('./whatsappApi').sendMessage({ phoneNumberId: sender.phoneNumberId, token: sender.token, to: m.to, payload });
  return { id: r.id };
}

async function deliver(m) {
  try {
    const r = m.channel === 'email' ? await deliverEmail(m) : await deliverWhatsApp(m);
    const set = r.skipped ? { status: 'skipped', lastError: r.skipped.slice(0, 300), lockedAt: null } : { status: 'sent', sentAt: new Date(), providerId: r.id || null, lastError: '', lockedAt: null };
    await OutboundMessage.updateOne({ _id: m._id, status: 'sending' }, { $set: set });
    return set.status;
  } catch (e) {
    const definite = e && e.definite === true;
    const giveUp = definite || m.attempts >= MAX_ATTEMPTS;
    const delayMin = BACKOFF_MIN[Math.min(m.attempts - 1, BACKOFF_MIN.length - 1)];
    await OutboundMessage.updateOne({ _id: m._id, status: 'sending' }, { $set: giveUp ? { status: 'failed', lastError: String(e.message || e).slice(0, 300), lockedAt: null } : { status: 'queued', lastError: String(e.message || e).slice(0, 300), nextAttemptAt: new Date(Date.now() + delayMin * 60000), lockedAt: null } });
    if (giveUp) console.warn(`[outbox] ${m.channel} ${m.kind} to ${m.to} failed for good: ${e.message}`);
    return giveUp ? 'failed' : 'retry';
  }
}

let flushing = null;
async function flush(limit = 50) {
  if (flushing) return flushing; // one flush at a time per process
  flushing = (async () => {
    const out = { sent: 0, skipped: 0, failed: 0, retry: 0 };
    for (let i = 0; i < limit; i++) {
      const m = await claimNext();
      if (!m) break;
      const r = await deliver(m);
      out[r === 'sent' ? 'sent' : r] = (out[r === 'sent' ? 'sent' : r] || 0) + 1;
    }
    return out;
  })().finally(() => { flushing = null; });
  return flushing;
}

// Status callbacks from WhatsApp: sent -> delivered -> read, or failed. Never moves backwards.
const RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, skipped: 5 };
async function markProviderStatus(providerId, status, at, error) {
  if (!providerId || !['sent', 'delivered', 'read', 'failed'].includes(status)) return false;
  const m = await OutboundMessage.findOne({ providerId });
  if (!m || (RANK[status] <= RANK[m.status] && status !== 'failed') || m.status === 'failed') return false;
  const set = { status };
  if (status === 'delivered') set.deliveredAt = at || new Date();
  if (status === 'read') { set.readAt = at || new Date(); if (!m.deliveredAt) set.deliveredAt = set.readAt; }
  if (status === 'failed') set.lastError = String(error || 'Delivery failed').slice(0, 300);
  await OutboundMessage.updateOne({ _id: m._id, status: m.status }, { $set: set });
  return true;
}

function startOutboxJob() {
  return require('./jobs').startJob('outbox', () => flush(100), { intervalMs: Math.max(5, Number(process.env.OUTBOX_INTERVAL_SECONDS) || 20) * 1000, firstDelayMs: 5000, enabled: enabled() });
}
async function backlog() { return OutboundMessage.countDocuments({ status: { $in: ['queued', 'sending'] } }); }

module.exports = { enqueue, flush, deliver, claimNext, markProviderStatus, startOutboxJob, backlog, BACKOFF_MIN, MAX_ATTEMPTS };
