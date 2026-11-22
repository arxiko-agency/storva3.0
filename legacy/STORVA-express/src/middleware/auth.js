'use strict';
const Session = require('../models/Session');
const User = require('../models/User');
const { env } = require('../config/env');
const { hashSessionToken } = require('../utils/secure');
const { COOKIE } = require('../services/sessionService');
const AppError = require('../utils/AppError');

// Loads req.user / req.session if a valid session cookie is present. Never throws for "not logged in".
async function loadSession(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();
    const session = await Session.findOne({ tokenHash: hashSessionToken(env.sessionSecret, token), expiresAt: { $gt: new Date() } });
    if (!session) return next();
    const user = await User.findById(session.user);
    if (!user || user.status !== 'active') return next();
    req.user = user; req.session = session;
    if (Date.now() - session.lastSeenAt.getTime() > 10 * 60 * 1000) Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch(() => {});
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new AppError('Please log in to continue.', 401, 'unauthorized'));
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user && req.user.role) ? next() : next(new AppError('You do not have access to this.', 403, 'forbidden'));

// CSRF defence in depth (cookies are already SameSite=Lax): browsers always send Origin on cross-site
// POST/PUT/PATCH/DELETE, so reject any state-changing request whose Origin is not this app.
function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) { // some browsers omit Origin: Fetch Metadata still says when a browser request is cross-site
    if (req.get('sec-fetch-site') === 'cross-site') return next(new AppError('Cross-site request blocked.', 403, 'bad_origin'));
    return next();
  } // non-browser clients (curl, webhooks) cannot be CSRF'd; they carry no ambient cookie
  let ok = false;
  try { const o = new URL(origin); ok = o.origin === new URL(env.appUrl).origin || (!env.isProd && o.host === req.get('host')); } catch { ok = false; }
  if (!ok) return next(new AppError('Cross-site request blocked.', 403, 'bad_origin'));
  next();
}

module.exports = { loadSession, requireAuth, requireRole, originGuard };
