'use strict';
const router = require('express').Router();
const User = require('../models/User');
const Session = require('../models/Session');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { hashPassword, verifyPassword, burnVerify, needsRehash } = require('../utils/password');
const audit = require('../services/audit');
const affiliates = require('../services/affiliates');
const { parseIdentifier, normalizeEmail, normalizePhone, passwordProblem, cleanName, isCode, badRequest } = require('../utils/validate');
const otp = require('../services/otpService');
const registration = require('../services/registrationService');
const { createSession, clearCookie } = require('../services/sessionService');
const { requireAuth } = require('../middleware/auth');
const { strictLimiter } = require('../middleware/rateLimit');
const { tooMany } = require('../utils/identifierThrottle');
const { admitUnknownLogin } = require('../services/loginThrottle');

const MIN15 = 15 * 60 * 1000;
const loginLimiter = strictLimiter(MIN15, 15, 'Too many login attempts. Please try again in a few minutes.');
const otpSendLimiter = strictLimiter(MIN15, 10, 'Too many code requests. Please try again later.');
const otpCheckLimiter = strictLimiter(MIN15, 20, 'Too many attempts. Please try again later.');
const registerLimiter = strictLimiter(MIN15, 10, 'Too many sign-up attempts. Please try again later.');

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
// Account-enumeration defences. Sign-up (registration.reserve) and unknown-account login (admitUnknownLogin) throttles are keyed on what the CALLER typed and stored durably in MongoDB, so they behave identically for existing and unknown accounts and are shared by every instance.
const LOCKED = () => tooMany(15 * 60, 'Too many failed attempts. Try again in 15 minutes, or reset your password.'); // one message for "no such account" and "locked account"
const PURPOSES = ['register', 'login', 'reset'];
const INVALID_CREDS = () => new AppError('Incorrect email/mobile or password.', 401, 'invalid_credentials');
const INVALID_CODE = () => new AppError('That code is incorrect or has expired.', 400, 'invalid_code');
const OK_GENERIC = { ok: true, message: 'If an account exists for this, a code has been sent.' };

const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const findByIdentifier = (id) => User.findOne(id.type === 'email' ? { email: id.value } : { phone: id.value });
const markVerified = (user, id) => { if (id.type === 'email') user.emailVerified = true; else user.phoneVerified = true; };

async function startSession(req, res, user) {
  user.lastLoginAt = new Date();
  user.failedLogins = 0; user.lockUntil = null;
  await user.save();
  // Only verified accounts reach this point (register/verify, password login, code login), so this is where a sign-up becomes a referral. Idempotent; never blocks login.
  if (user.referredByCode) await affiliates.attributeSignup(user).catch((e) => console.error('[affiliate] attribution failed:', e.message));
  await createSession(req, res, user);
  return { user: user.toPublic() };
}

// ---- Register -------------------------------------------------------------------------------
router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const { name, email, phone, password, verifyVia } = body(req); // body.ref (optional) is read by affiliates.codeFromRequest
  const fields = {};
  const n = cleanName(name); if (!n) fields.name = 'Enter your name (2 to 80 characters).';
  const e = normalizeEmail(email); if (!e) fields.email = 'Enter a valid email address.';
  const p = normalizePhone(phone); if (!p) fields.phone = 'Enter a valid 10-digit Indian mobile number.';
  const pwErr = typeof password === 'string' ? passwordProblem(password) : 'Enter a password.'; if (pwErr) fields.password = pwErr;
  const channel = verifyVia === 'phone' ? 'phone' : 'email';
  if (Object.keys(fields).length) throw badRequest(fields);

  const identifier = channel === 'phone' ? p : e;
  const allowed = await Promise.all([e, p].map((value) => registration.reserve(value, 'signup', 0)));
  if (allowed.some((ok) => !ok)) throw tooMany(3600, 'Too many sign-up attempts for this email or mobile number. Please try again later.');
  const reply = () => res.status(201).json({ ok: true, identifier, channel, expiresInSec: otp.TTL_MS / 1000, resendAfterSec: 30 });
  // Pay the same password-hashing cost for pending, existing and new identities.
  const passwordHash = await hashPassword(password);
  const existing = await User.find({ $or: [{ email: e }, { phone: p }] });
  // Never delete or overwrite pending credentials. Even a partial collision with
  // another pending account must not mutate that account or silently merge identities.
  let user = existing.length === 1 && existing[0].email === e && existing[0].phone === p
    && !existing[0].emailVerified && !existing[0].phoneVerified && existing[0].status === 'active' ? existing[0] : null;
  if (!existing.length) {
    const referredByCode = await affiliates.codeFromRequest(req);
    try { user = await User.create({ name: n, email: e, phone: p, passwordHash, referredByCode }); }
    catch (err) {
      if (err.code !== 11000) throw err;
      // Unique email/phone indexes arbitrate racing creations. The losing request
      // gives the same generic response; it never replaces the winning account.
    }
  }
  await registration.issue({ identifier, channel, userId: user ? user._id : null });
  reply();
}));

router.post('/register/verify', otpCheckLimiter, asyncHandler(async (req, res) => {
  const id = parseIdentifier(body(req).identifier);
  if (!id || !isCode(body(req).code)) throw INVALID_CODE();
  const user = await registration.verify({ identifier: id.value, channel: id.type, code: body(req).code });
  if (!user) throw INVALID_CODE();
  const session = await startSession(req, res, user);
  await audit.record(req, 'auth.login', { actor: user._id, targetType: 'user', targetId: String(user._id) });
  res.json(session);
}));

// ---- Password login -------------------------------------------------------------------------
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const id = parseIdentifier(body(req).identifier);
  const password = body(req).password;
  if (!id || typeof password !== 'string' || !password || password.length > 128) {
    if (typeof password === 'string') await burnVerify(password);
    throw INVALID_CREDS();
  }
  const user = await findByIdentifier(id).select('+passwordHash');
  if (!user) {
    // Unknown account: lock after the same 5 failures as a real account, with the same 429 message, so lock-out cannot be used to tell them apart.
    if (!(await admitUnknownLogin(id.value))) { await burnVerify(password); throw LOCKED(); }
    await burnVerify(password); throw INVALID_CREDS();
  }
  if (user.lockUntil && user.lockUntil > new Date()) { await burnVerify(password); throw LOCKED(); }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const u = await User.findByIdAndUpdate(user._id, { $inc: { failedLogins: 1 } }, { new: true });
    if (u && u.failedLogins >= MAX_FAILED) await User.updateOne({ _id: user._id }, { failedLogins: 0, lockUntil: new Date(Date.now() + LOCK_MS) });
    throw INVALID_CREDS();
  }
  if (user.status !== 'active') throw new AppError('This account has been suspended. Contact support.', 403, 'suspended');
  if (!user.emailVerified && !user.phoneVerified) {
    throw new AppError('Please verify your email or mobile number to continue.', 403, 'not_verified', { details: { identifier: id.value, channel: id.type } });
  }
  if (needsRehash(user.passwordHash)) user.passwordHash = await hashPassword(password); // upgrade an old hash to the current cost (saved by startSession)
  const out = await startSession(req, res, user);
  await audit.record(req, 'auth.login', { actor: user._id, targetType: 'user', targetId: String(user._id) });
  res.json(out);
}));

// ---- OTP send / login by code ---------------------------------------------------------------
router.post('/otp/send', otpSendLimiter, asyncHandler(async (req, res) => {
  const id = parseIdentifier(body(req).identifier);
  const purpose = body(req).purpose;
  if (!id || !PURPOSES.includes(purpose)) throw badRequest({ identifier: 'Enter a valid email or 10-digit mobile number.' });
  const user = await findByIdentifier(id);
  if (purpose === 'register') {
    await registration.issue({ identifier: id.value, channel: id.type, userId: user ? user._id : null });
    return res.json(OK_GENERIC);
  }
  const verifiedForChannel = user && (id.type === 'email' ? user.emailVerified : user.phoneVerified);
  const eligible = user && user.status === 'active' && (purpose === 'register' ? !verifiedForChannel : true);
  if (eligible) await otp.issue({ identifier: id.value, channel: id.type, purpose });
  res.json(OK_GENERIC); // identical response whether or not the account exists or the send was throttled
}));

router.post('/otp/login', otpCheckLimiter, asyncHandler(async (req, res) => {
  const id = parseIdentifier(body(req).identifier);
  if (!id || !isCode(body(req).code)) throw INVALID_CODE();
  if (!(await otp.verify({ identifier: id.value, purpose: 'login', code: body(req).code }))) throw INVALID_CODE();
  const user = await findByIdentifier(id);
  if (!user) throw INVALID_CODE();
  if (user.status !== 'active') throw new AppError('This account has been suspended. Contact support.', 403, 'suspended');
  markVerified(user, id); // receiving the code proves ownership of that channel
  res.json(await startSession(req, res, user));
}));

// ---- Forgot / reset / change password -------------------------------------------------------
router.post('/password/forgot', otpSendLimiter, asyncHandler(async (req, res) => {
  const id = parseIdentifier(body(req).identifier);
  if (!id) throw badRequest({ identifier: 'Enter a valid email or 10-digit mobile number.' });
  const user = await findByIdentifier(id);
  if (user && user.status === 'active') await otp.issue({ identifier: id.value, channel: id.type, purpose: 'reset' });
  res.json(OK_GENERIC);
}));

router.post('/password/reset', otpCheckLimiter, asyncHandler(async (req, res) => {
  const { identifier, code, password } = body(req);
  const id = parseIdentifier(identifier);
  const pwErr = typeof password === 'string' ? passwordProblem(password) : 'Enter a new password.';
  if (pwErr) throw badRequest({ password: pwErr }); // checked first so a weak password does not burn the code
  if (!id || !isCode(code)) throw INVALID_CODE();
  if (!(await otp.verify({ identifier: id.value, purpose: 'reset', code }))) throw INVALID_CODE();
  const user = await findByIdentifier(id);
  if (!user) throw INVALID_CODE();
  markVerified(user, id);
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date(); user.failedLogins = 0; user.lockUntil = null;
  await user.save();
  await Session.deleteMany({ user: user._id }); // log out everywhere
  res.json({ ok: true });
}));

router.post('/password/change', requireAuth, otpCheckLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = body(req);
  const pwErr = typeof newPassword === 'string' ? passwordProblem(newPassword) : 'Enter a new password.';
  if (pwErr) throw badRequest({ newPassword: pwErr });
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw badRequest({ currentPassword: 'Current password is incorrect.' });
  }
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await Session.deleteMany({ user: user._id, _id: { $ne: req.session._id } }); // keep this device signed in
  await audit.record(req, 'auth.password_changed', { targetType: 'user', targetId: String(user._id) });
  res.json({ ok: true });
}));

// ---- Session / account ----------------------------------------------------------------------
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: { code: 'unauthorized', message: 'Not logged in.' } });
  res.json({ user: req.user.toPublic() });
});

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const n = cleanName(body(req).name);
  if (!n) throw badRequest({ name: 'Enter your name (2 to 80 characters).' });
  req.user.name = n; await req.user.save();
  res.json({ user: req.user.toPublic() });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  if (req.session) await Session.deleteOne({ _id: req.session._id });
  clearCookie(res);
  res.json({ ok: true });
}));

router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  await Session.deleteMany({ user: req.user._id });
  await audit.record(req, 'auth.logout_all', { targetType: 'user', targetId: String(req.user._id) });
  clearCookie(res);
  res.json({ ok: true });
}));

router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const list = await Session.find({ user: req.user._id, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean();
  res.json({ sessions: list.map((s) => ({ id: String(s._id), current: String(s._id) === String(req.session._id), ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })) });
}));

router.delete('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  const r = await Session.deleteOne({ _id: req.params.id, user: req.user._id }); // user filter = can only revoke own sessions
  if (!r.deletedCount) throw new AppError('Session not found.', 404, 'not_found');
  res.json({ ok: true });
}));

module.exports = router;
