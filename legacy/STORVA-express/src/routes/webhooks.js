'use strict';
// Server-to-server webhooks (no cookies, no CORS, no CSRF origin guard: authenticity comes from the HMAC signature).
// Mounted in app.js BEFORE express.json(), because the signature is computed over the exact raw bytes.
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { strictLimiter } = require('../middleware/rateLimit');
const webhooks = require('../services/webhooks');

const limiter = strictLimiter(60 * 1000, Number(process.env.WEBHOOK_RATE_LIMIT) || 300, 'Too many requests.');

router.post('/razorpay', limiter, express.raw({ type: () => true, limit: '256kb' }), asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const r = await webhooks.handle({ raw, signature: req.get('x-razorpay-signature'), eventId: req.get('x-razorpay-event-id') });
  res.status(r.status).json(r.body);
}));

// Module 10: WhatsApp Cloud API (platform number, or a store's own number at /whatsapp/<key>).
const waWebhook = require('../services/waWebhook');
router.get(['/whatsapp', '/whatsapp/:key'], limiter, asyncHandler(async (req, res) => {
  const r = await waWebhook.verifySubscription(req.params.key || null, req.query || {});
  res.status(r.status).type('text/plain').send(r.body);
}));
router.post(['/whatsapp', '/whatsapp/:key'], limiter, express.raw({ type: () => true, limit: '1mb' }), asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const r = await waWebhook.handle(req.params.key || null, raw, req.get('x-hub-signature-256'));
  res.status(r.status).json(r.body);
}));

module.exports = router;
