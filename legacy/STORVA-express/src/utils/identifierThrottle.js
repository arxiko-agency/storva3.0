'use strict';
// Per-identifier (email / mobile) throttling that behaves IDENTICALLY whether or not an account exists, so it cannot be used to enumerate accounts.
// NOTE: the in-memory Throttle class below is no longer used by any route. Sign-up and unknown-account login throttling are now durable and
// atomic in MongoDB (registrationService.reserve, loginThrottle.admitUnknownLogin). keyOf() and tooMany() are still shared. Keys are hashed so
// raw emails / numbers are never stored.
const crypto = require('crypto');
const AppError = require('./AppError');

const keyOf = (scope, identifier) => scope + ':' + crypto.createHash('sha256').update(String(identifier)).digest('hex').slice(0, 24);

class Throttle {
  // opts: { windowMs, limit, cooldownMs = 0, now = Date.now, maxKeys = 20000 }
  constructor(opts) { this.o = { cooldownMs: 0, now: Date.now, maxKeys: 20000, ...opts }; this.m = new Map(); }
  _prune(t) { if (this.m.size < this.o.maxKeys) return; for (const [k, v] of this.m) if (v.hits.every((h) => t - h >= this.o.windowMs)) this.m.delete(k); if (this.m.size >= this.o.maxKeys) this.m.clear(); }
  _entry(key, t) { const e = this.m.get(key) || { hits: [] }; e.hits = e.hits.filter((h) => t - h < this.o.windowMs); this.m.set(key, e); return e; }
  // Does NOT record. -> { ok, retryAfterSec }
  peek(key) {
    const t = this.o.now(), e = this._entry(key, t);
    if (e.hits.length >= this.o.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((e.hits[0] + this.o.windowMs - t) / 1000)) };
    const last = e.hits[e.hits.length - 1];
    if (this.o.cooldownMs && last !== undefined && t - last < this.o.cooldownMs) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((last + this.o.cooldownMs - t) / 1000)) };
    return { ok: true, retryAfterSec: 0 };
  }
  record(key) { const t = this.o.now(); this._prune(t); this._entry(key, t).hits.push(t); }
  // peek + record in one step. -> { ok, retryAfterSec }
  hit(key) { const r = this.peek(key); if (r.ok) this.record(key); return r; }
  reset(key) { this.m.delete(key); }
}

const tooMany = (retryAfterSec, message) => new AppError(message, 429, 'too_many_attempts', { details: { retryAfterSec } });

module.exports = { Throttle, keyOf, tooMany };
