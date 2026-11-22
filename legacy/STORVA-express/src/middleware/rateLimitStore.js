'use strict';
// Module 15: shared rate-limit counters in MongoDB, so limits hold across several app instances (the default memory store
// counts per instance). Turn on with RATE_LIMIT_STORE=mongo. Fixed windows; documents expire on their own (TTL index).
// If the database is briefly unavailable the request is allowed (fail-open) rather than taking the whole site down.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({ _id: String, hits: { type: Number, default: 0 }, resetAt: { type: Date, required: true } }, { versionKey: false });
schema.index({ resetAt: 1 }, { expireAfterSeconds: 60 });
const RateLimitHit = mongoose.models.RateLimitHit || mongoose.model('RateLimitHit', schema);

class MongoStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  _id(key) { return `${this.prefix}:${key}`; }
  async get(key) { const d = await RateLimitHit.findById(this._id(key)).lean(); return d && d.resetAt > new Date() ? { totalHits: d.hits, resetTime: d.resetAt } : undefined; }
  async increment(key) {
    const now = new Date(), id = this._id(key);
    try {
      // Start a new window when the old one is over, otherwise add one hit. Two steps, each atomic.
      let d = await RateLimitHit.findOneAndUpdate({ _id: id, resetAt: { $gt: now } }, { $inc: { hits: 1 } }, { new: true }).lean();
      if (!d) {
        try { d = await RateLimitHit.findOneAndUpdate({ _id: id, resetAt: { $lte: now } }, { $set: { hits: 1, resetAt: new Date(now.getTime() + this.windowMs) } }, { new: true, upsert: true }).lean(); }
        catch (e) { if (e && e.code === 11000) d = await RateLimitHit.findOneAndUpdate({ _id: id }, { $inc: { hits: 1 } }, { new: true }).lean(); else throw e; }
      }
      return { totalHits: d.hits, resetTime: d.resetAt };
    } catch (e) { console.error('[rate-limit] store unavailable, allowing request:', e.message); return { totalHits: 0, resetTime: new Date(now.getTime() + this.windowMs) }; }
  }
  async decrement(key) { await RateLimitHit.updateOne({ _id: this._id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } }).catch(() => {}); }
  async resetKey(key) { await RateLimitHit.deleteOne({ _id: this._id(key) }).catch(() => {}); }
}
let n = 0;
const storeFor = (name) => (process.env.RATE_LIMIT_STORE === 'mongo' ? new MongoStore(name || 'rl' + (++n)) : undefined);
module.exports = { MongoStore, storeFor, RateLimitHit };
