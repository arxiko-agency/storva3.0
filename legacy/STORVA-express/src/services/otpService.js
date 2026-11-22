'use strict';
const Otp = require('../models/Otp');
const { env } = require('../config/env');
const { generateOtp, hashOtp, safeEqualHex } = require('../utils/secure');
const { sendSms, sendEmail } = require('./delivery');

const TTL_MS = 10 * 60 * 1000;      // code lifetime
const COOLDOWN_MS = 30 * 1000;      // min gap between sends to one identifier
const HOURLY_CAP = 5;               // max sends per identifier per hour
const MAX_ATTEMPTS = 5;             // wrong guesses before the code is burned

// Returns { sent: boolean }. sent=false means throttled; callers answer generically so the response
// does not reveal whether an account exists.
async function issue({ identifier, channel, purpose }) {
  if (purpose === 'register') throw new Error('Registration codes must use registrationService');
  // Shared durable budget: alternating login/reset/registration cannot evade the
  // original per-identifier cooldown or five-sends-per-hour limit.
  if (!(await require('./registrationService').reserve(identifier))) return { sent: false };
  const now = Date.now();

  await Otp.updateMany({ identifier, consumedAt: null }, { consumedAt: new Date(now) }); // only the newest code is valid
  const code = generateOtp();
  const doc = await Otp.create({
    identifier, channel, purpose,
    codeHash: hashOtp(env.otpPepper, identifier, purpose, code),
    expiresAt: new Date(now + TTL_MS),
    purgeAt: new Date(now + 3600 * 1000 + TTL_MS),
  });
  try {
    if (channel === 'phone') await sendSms(identifier, code); else await sendEmail(identifier, code, purpose);
  } catch (e) {
    await Otp.deleteOne({ _id: doc._id }); // a code the user never received should not count against them
    throw e;
  }
  return { sent: true, expiresInSec: TTL_MS / 1000 };
}

// Returns true when the code is valid (and consumes it), false otherwise.
async function verify({ identifier, purpose, code }) {
  if (purpose === 'register') return false;
  const now = new Date();
  const active = await Otp.findOne({ identifier, purpose, consumedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 });
  if (!active) return false;
  // Count the attempt atomically BEFORE comparing, so parallel guesses cannot exceed the limit.
  const counted = await Otp.findOneAndUpdate(
    { _id: active._id, consumedAt: null, attempts: { $lt: MAX_ATTEMPTS }, $expr: { $gt: ['$expiresAt', '$$NOW'] } },
    { $inc: { attempts: 1 } }, { new: true });
  if (!counted) return false;
  if (!safeEqualHex(counted.codeHash, hashOtp(env.otpPepper, identifier, purpose, code))) {
    if (counted.attempts >= MAX_ATTEMPTS) await Otp.updateOne({ _id: counted._id }, { consumedAt: now });
    return false;
  }
  // Atomic single-use: only one concurrent request can flip consumedAt from null.
  const consumed = await Otp.findOneAndUpdate({ _id: counted._id, consumedAt: null, $expr: { $gt: ['$expiresAt', '$$NOW'] } }, { $currentDate: { consumedAt: true } });
  return !!consumed;
}

module.exports = { issue, verify, TTL_MS, MAX_ATTEMPTS };
