'use strict';
// OTP and session-token primitives. No dependencies; secrets are passed in so this is unit-testable.
const crypto = require('crypto');

const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// The code is bound to identifier + purpose, so a login code cannot be replayed as a reset code.
const hashOtp = (pepper, identifier, purpose, code) => hmac(pepper, `otp|${identifier}|${purpose}|${code}`);
// A code issued to a deleted pending account must never activate its replacement.
const hashRegistrationOtp = (pepper, userId, identifier, channel, code) =>
  hmac(pepper, JSON.stringify(['registration-v2', String(userId), identifier, channel, code]));

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

const newSessionToken = () => crypto.randomBytes(32).toString('base64url');
const hashSessionToken = (secret, token) => hmac(secret, `sess|${token}`);

module.exports = { generateOtp, hashOtp, hashRegistrationOtp, safeEqualHex, newSessionToken, hashSessionToken };
