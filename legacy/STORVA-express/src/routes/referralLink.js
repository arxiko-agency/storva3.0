'use strict';
// GET /r/:code  — the public referral link an affiliate shares (https://<app>/r/AB12CD34).
// Counts one click per visitor, remembers the code in a first-party cookie, and sends the visitor to the sign-up screen.
// It never answers "unknown code": every code redirects somewhere useful, so the link cannot be used to find out which codes exist.
const router = require('express').Router();
const { env } = require('../config/env');
const { strictLimiter } = require('../middleware/rateLimit');
const A = require('../utils/affiliate');
const affiliates = require('../services/affiliates');

const limiter = strictLimiter(60 * 1000, 60, 'Too many requests. Please slow down.');
const PREVIEW_BOTS = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|embed|curl|wget|python-requests/i; // link-preview fetchers must not count as visitors

router.get('/:code', limiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const code = A.normalizeCode(req.params.code);
  const isBot = PREVIEW_BOTS.test(req.get('user-agent') || '');
  if (code && !isBot) {
    try {
      const already = req.cookies && A.normalizeCode(req.cookies[affiliates.COOKIE]) === code; // same visitor opening the same link again is not a new click
      if (!already && (await affiliates.trackClick(code))) {
        const days = A.readProgram().cookieDays;
        res.cookie(affiliates.COOKIE, code, { httpOnly: true, sameSite: 'lax', secure: env.isProd, maxAge: days * 864e5, path: '/' });
      }
    } catch (e) { console.error('[affiliate] click tracking failed:', e.message); } // tracking problems must never break the visitor's page
  }
  res.redirect(302, '/#signup');
});

module.exports = router;
