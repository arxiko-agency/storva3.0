'use strict';
const rateLimit = require('express-rate-limit');
const { storeFor } = require('./rateLimitStore'); // Module 15: RATE_LIMIT_STORE=mongo shares limits across instances
const crypto = require('crypto');

const json429 = (message) => (req, res) =>
  res.status(429).json({ error: { code: 'rate_limited', message } });

// General limiter for every /api route.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json429('Too many requests. Please slow down.'),
  store: storeFor('api'),
});

// Factory for stricter limiters (OTP, login, checkout...).
// Each limiter gets its own counter namespace (settings hash + creation order, identical on every instance) so two limiters never share hits.
let seq = 0;
const strictLimiter = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429(message), store: storeFor('s' + crypto.createHash('sha1').update(`${windowMs}|${limit}|${message}`).digest('hex').slice(0, 8) + '-' + (++seq)) });

module.exports = { apiLimiter, strictLimiter };
