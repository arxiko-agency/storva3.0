'use strict';
// Durable, atomic throttle for password logins against identifiers that have NO account.
// Replaces the former per-process in-memory Throttle, so the limit holds across instances and restarts.
// Same behaviour as before: 5 failures per 15 minutes per identifier, and the caller answers a locked
// unknown identifier exactly like a locked real account (no account enumeration).
// Storage: the existing hash-keyed RegistrationBudget collection (_id = scope + SHA-256 prefix of the
// identifier; the raw identifier is never stored). Expiry is enforced inside the write predicate with
// MongoDB's own clock ($$NOW); the TTL index on purgeAt is only cleanup.
const { keyOf } = require('../utils/identifierThrottle');

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;
const SCOPE = 'login-unknown';

// Records one failed attempt and returns true while the identifier is under its limit.
// Returns false (and records nothing) once LIMIT failures exist inside the window.
// Concurrent callers are serialized by MongoDB on the single document, so a burst of N parallel
// requests admits exactly LIMIT of them. Database errors propagate (fail closed): the login route
// has already needed the database for its account lookup, so it cannot proceed without it anyway.
async function admitUnknownLogin(identifier, opts = {}) {
  const Budget = opts.model || require('../models/RegistrationBudget');
  const limit = opts.limit || LIMIT;
  const windowMs = opts.windowMs || WINDOW_MS;
  const key = keyOf(SCOPE, identifier);
  try {
    // Unique _id arbitrates racing first-time initialisation; $setOnInsert never resets existing hits.
    await Budget.updateOne({ _id: key }, { $setOnInsert: { hits: [], purgeAt: new Date(Date.now() + 2 * windowMs) } }, { upsert: true });
  } catch (e) { if (e.code !== 11000) throw e; }
  const recent = { $filter: { input: '$hits', as: 'hit', cond: { $gt: ['$$hit', { $subtract: ['$$NOW', windowMs] }] } } };
  const admitted = await Budget.findOneAndUpdate(
    { _id: key, $expr: { $lt: [{ $size: recent }, limit] } },
    [{ $set: { hits: { $concatArrays: [recent, ['$$NOW']] }, purgeAt: { $add: ['$$NOW', 2 * windowMs] } } }],
    { new: true });
  return Boolean(admitted);
}

module.exports = { admitUnknownLogin, WINDOW_MS, LIMIT, SCOPE };
