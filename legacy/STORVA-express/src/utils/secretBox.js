'use strict';
// Module 10: encrypts third-party credentials at rest (a store's own WhatsApp access token). AES-256-GCM with a key from
// SECRETS_KEY (64 hex chars) or, if unset, derived from JWT_SECRET with HKDF. Rotating the key makes stored tokens unreadable
// (owners simply reconnect). Format: v1.<iv>.<tag>.<ciphertext> (base64url).
const crypto = require('crypto');
const { env } = require('../config/env');

function key() {
  const hex = process.env.SECRETS_KEY || '';
  if (/^[a-f0-9]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  if (!env.sessionSecret) throw new Error('No encryption key available (set SECRETS_KEY or JWT_SECRET).');
  return Buffer.from(crypto.hkdfSync('sha256', env.sessionSecret, 'storva-secretbox', 'v1', 32));
}
function seal(plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
function open(sealed) {
  const [v, iv, tag, ct] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
module.exports = { seal, open };
