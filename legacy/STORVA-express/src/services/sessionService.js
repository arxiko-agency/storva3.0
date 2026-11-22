'use strict';
const Session = require('../models/Session');
const { env } = require('../config/env');
const { newSessionToken, hashSessionToken } = require('../utils/secure');

const COOKIE = 'storva_sid';

const cookieOptions = () => ({
  httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/',
  maxAge: env.sessionDays * 24 * 3600 * 1000,
});

async function createSession(req, res, user) {
  const token = newSessionToken();
  await Session.create({
    user: user._id,
    tokenHash: hashSessionToken(env.sessionSecret, token),
    expiresAt: new Date(Date.now() + env.sessionDays * 24 * 3600 * 1000),
    ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300),
  });
  res.cookie(COOKIE, token, cookieOptions());
}

const clearCookie = (res) => res.clearCookie(COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: '/' });

module.exports = { COOKIE, createSession, clearCookie };
