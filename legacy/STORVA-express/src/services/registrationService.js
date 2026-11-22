'use strict';
const User = require('../models/User');
const Otp = require('../models/Otp');
const Budget = require('../models/RegistrationBudget');
const { env } = require('../config/env');
const { generateOtp, hashRegistrationOtp } = require('../utils/secure');
const { keyOf } = require('../utils/identifierThrottle');
const { sendSms, sendEmail } = require('./delivery');

const TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const HOURLY_CAP = 5;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 3600 * 1000;
const pending = { status: 'active', emailVerified: false, phoneVerified: false };

// Atomic rolling-window admission; unique _id serializes concurrent initialization.
// Retain a full hour of history even if a delivery fails, to stop provider-failure floods.
async function reserve(identifier, scope = 'registration-send', cooldownMs = COOLDOWN_MS) {
  const key = keyOf(scope, identifier);
  // Seed the shared send budget from pre-upgrade OTP history exactly once. The
  // unique budget key ensures racing initializers cannot reset accumulated hits.
  const legacy = scope === 'registration-send' ? await Otp.find({ identifier, createdAt: { $gt: new Date(Date.now() - HOUR_MS) } }).select('createdAt').lean() : [];
  try {
    await Budget.updateOne({ _id: key }, { $setOnInsert: { hits: legacy.map((row) => row.createdAt), purgeAt: new Date(Date.now() + 2 * HOUR_MS) } }, { upsert: true });
  } catch (e) { if (e.code !== 11000) throw e; }
  const recent = { $filter: { input: '$hits', as: 'hit', cond: { $gt: ['$$hit', { $subtract: ['$$NOW', HOUR_MS] }] } } };
  const admitted = await Budget.findOneAndUpdate({
    _id: key,
    $expr: { $and: [
      { $lt: [{ $size: recent }, HOURLY_CAP] },
      { $eq: [{ $size: { $filter: { input: '$hits', as: 'hit', cond: { $gt: ['$$hit', { $subtract: ['$$NOW', cooldownMs] }] } } } }, 0] },
    ] },
  }, [{ $set: { hits: { $concatArrays: [recent, ['$$NOW']] }, purgeAt: { $add: ['$$NOW', 2 * HOUR_MS] } } }], { new: true });
  return Boolean(admitted);
}

async function issue({ identifier, channel, userId }) {
  // Always reserve before looking up eligibility: unknown/active accounts follow the same limits.
  if (!(await reserve(identifier))) return { sent: false };
  if (!userId) return { sent: false };
  const code = generateOtp();
  const codeHash = hashRegistrationOtp(env.otpPepper, userId, identifier, channel, code);
  const owner = await User.findOneAndUpdate({ _id: userId, ...pending, [channel]: identifier }, [{ $set: {
    registration: { channel, identifier, codeHash, expiresAt: { $add: ['$$NOW', TTL_MS] }, attempts: 0, consumedAt: null },
  } }], { new: true });
  if (!owner) return { sent: false };
  try {
    if (channel === 'phone') await sendSms(identifier, code); else await sendEmail(identifier, code, 'register');
  } catch {
    // Never surface provider errors only for existing accounts. Invalidate only this
    // challenge: a late failure cannot erase a newer successfully issued challenge.
    await User.updateOne({ _id: userId, 'registration.codeHash': codeHash }, { $set: { 'registration.codeHash': null }, $currentDate: { 'registration.consumedAt': true } });
    return { sent: false };
  }
  return { sent: true, expiresInSec: TTL_MS / 1000 };
}

async function verify({ identifier, channel, code }) {
  const user = await User.findOne({ [channel]: identifier, ...pending }).select('_id');
  if (!user) return null;
  const codeHash = hashRegistrationOtp(env.otpPepper, user._id, identifier, channel, code);
  const eligible = {
    _id: user._id, ...pending,
    'registration.identifier': identifier, 'registration.channel': channel,
    'registration.consumedAt': null, 'registration.attempts': { $lt: MAX_ATTEMPTS },
    $expr: { $gt: ['$registration.expiresAt', '$$NOW'] },
  };
  // One write both consumes the challenge and activates its exact owner. The
  // eligibility/expiry predicates are rechecked by MongoDB under concurrent writes.
  const verified = await User.findOneAndUpdate({ ...eligible, 'registration.codeHash': codeHash }, {
    $set: { [channel === 'email' ? 'emailVerified' : 'phoneVerified']: true, 'registration.codeHash': null },
    $currentDate: { 'registration.consumedAt': true },
  }, { new: true });
  if (verified) return verified;
  await User.updateOne({ ...eligible, 'registration.codeHash': { $ne: codeHash } }, { $inc: { 'registration.attempts': 1 } });
  return null;
}

module.exports = { issue, verify, reserve, TTL_MS, COOLDOWN_MS, HOURLY_CAP, MAX_ATTEMPTS };