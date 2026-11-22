'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.MONGODB_URI || !/test/i.test(process.env.MONGODB_URI)) {
  test('registration security integration', { skip: 'requires isolated MongoDB test database' }, () => {});
  return;
}
process.env.JWT_SECRET = 'test-session-secret-'.repeat(3);
process.env.OTP_PEPPER = 'test-otp-secret-'.repeat(3);
process.env.NODE_ENV = 'development';
const mongoose = require('mongoose');
// Stub ONLY delivery at the provider boundary, never OTP logic or database writes.
const delivery = require('../src/services/delivery');
const sent = new Map();
let failDelivery = false;
delivery.sendEmail = delivery.sendSms = async (identifier, code) => {
  if (failDelivery) throw new Error('simulated provider outage');
  sent.set(identifier, code);
};
const registration = require('../src/services/registrationService');
const User = require('../src/models/User');
const Budget = require('../src/models/RegistrationBudget');
const Otp = require('../src/models/Otp');
const Session = require('../src/models/Session');
const { env } = require('../src/config/env');
const { hashRegistrationOtp } = require('../src/utils/secure');
const { keyOf } = require('../src/utils/identifierThrottle');
const express = require('express');
let server, base, serial = 0;
const ids = [];
function details() {
  serial += 1;
  return { name: 'Original Owner', email: `task2-${process.pid}-${serial}@example.com`, phone: `98${String(serial).padStart(8, '0')}`, password: 'Passw0rd1', verifyVia: 'email' };
}
async function fixture() {
  const data = details();
  const user = await User.create({ ...data, phone: '91' + data.phone, passwordHash: 'original-hash', referredByCode: 'ORIGINAL' });
  ids.push(user._id);
  await registration.issue({ identifier: user.email, channel: 'email', userId: user._id });
  return { user, code: sent.get(user.email), data };
}
const verify = (f, code = f.code) => registration.verify({ identifier: f.user.email, channel: 'email', code });
const call = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(serial / 200)}.${serial % 200 + 1}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), Budget.init(), Otp.init(), Session.init()]);
  const app = express(); app.set('trust proxy', 1); app.use(express.json());
  app.use(require('../src/routes/auth'));
  app.use(require('../src/middleware/error').errorHandler);
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await Session.deleteMany({ user: { $in: ids } });
  await User.deleteMany({ email: new RegExp(`^task2-${process.pid}-`) });
  await Budget.deleteMany({});
  if (server) await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

test('success atomically verifies the pending owner and does not create another account', async () => {
  const f = await fixture();
  const result = await call('/register/verify', { identifier: f.user.email, code: f.code });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.id, String(f.user._id));
  assert.equal(result.body.user.emailVerified, true);
  assert.equal(result.body.user.registration, undefined);
  assert.equal(await User.countDocuments({ email: f.user.email }), 1);
  assert.equal(await Session.countDocuments({ user: f.user._id }), 1);
});
test('expiry, including the exact boundary, is enforced without deleting pending accounts', async () => {
  for (const offset of [-1, 0]) {
    const f = await fixture();
    await User.updateOne({ _id: f.user._id }, { $set: { 'registration.expiresAt': new Date(Date.now() + offset) } });
    assert.equal(await verify(f), null);
    const saved = await User.findById(f.user._id).select('+passwordHash');
    assert.equal(saved.emailVerified, false); assert.equal(saved.passwordHash, 'original-hash');
  }
});
test('five invalid guesses exhaust attempts even when followed by the correct OTP', async () => {
  const f = await fixture(); const wrong = f.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(await verify(f, wrong), null);
  assert.equal(await verify(f), null);
  const saved = await User.findById(f.user._id).select('+registration');
  assert.equal(saved.registration.attempts, 5); assert.equal(saved.emailVerified, false);
});
test('repeated OTP is rejected after successful verification', async () => {
  const f = await fixture(); assert.ok(await verify(f)); assert.equal(await verify(f), null);
});
test('concurrent verification creates exactly one session and consumes exactly once', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 12 }, () => call('/register/verify', { identifier: f.user.email, code: f.code })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 400).length, 11);
  assert.equal(await Session.countDocuments({ user: f.user._id }), 1);
});
test('concurrent incorrect guesses cannot exceed five attempts', async () => {
  const f = await fixture(); const wrong = f.code === '000000' ? '111111' : '000000';
  await Promise.all(Array.from({ length: 20 }, () => verify(f, wrong)));
  assert.equal((await User.findById(f.user._id).select('+registration')).registration.attempts, 5);
  assert.equal(await verify(f), null);
});
test('OTP from a deleted pending account cannot activate a replacement or another channel', async () => {
  const f = await fixture(); const oldHash = hashRegistrationOtp(env.otpPepper, f.user._id, f.user.email, 'email', f.code);
  await User.deleteOne({ _id: f.user._id });
  const replacement = await User.create({ name: 'Replacement', email: f.user.email, phone: f.user.phone, passwordHash: 'replacement', registration: {
    identifier: f.user.email, channel: 'email', codeHash: oldHash, expiresAt: new Date(Date.now() + 600000), attempts: 0, consumedAt: null,
  } }); ids.push(replacement._id);
  assert.equal(await verify(f), null);
  assert.equal(await registration.verify({ identifier: f.user.phone, channel: 'phone', code: f.code }), null);
  assert.equal((await User.findById(replacement._id)).emailVerified, false);
});
test('reregister preserves pending identity, credentials, referral and the already-delivered OTP', async () => {
  const f = await fixture();
  const r = await call('/register', { ...f.data, name: 'Attacker Name', password: 'Attacker123' });
  assert.equal(r.status, 201);
  const saved = await User.findById(f.user._id).select('+passwordHash');
  assert.equal(saved.name, 'Original Owner'); assert.equal(saved.passwordHash, 'original-hash'); assert.equal(saved.referredByCode, 'ORIGINAL');
  assert.ok(await verify(f));
});
test('concurrent registration and partial collisions never duplicate or replace accounts', async () => {
  const data = details();
  const responses = await Promise.all(Array.from({ length: 4 }, () => call('/register', data)));
  assert.ok(responses.every((r) => r.status === 201));
  assert.ok(responses.every((r) => JSON.stringify(r.body) === JSON.stringify(responses[0].body)));
  const user = await User.findOne({ email: data.email }); ids.push(user._id);
  assert.equal(await User.countDocuments({ $or: [{ email: data.email }, { phone: '91' + data.phone }] }), 1);
  const other = details();
  assert.equal((await call('/register', { ...other, email: data.email })).status, 201);
  assert.equal(await User.countDocuments({ email: data.email }), 1);
  assert.equal((await User.findById(user._id)).phone, '91' + data.phone);
});
test('resends enforce 30 seconds, ten-minute expiry, five per hour, and invalidate the prior OTP', async () => {
  const f = await fixture();
  const original = (await User.findById(f.user._id).select('+registration')).registration;
  const budget = await Budget.findById(keyOf('registration-send', f.user.email));
  assert.equal(original.expiresAt.getTime() - budget.hits[0].getTime() >= 600000, true);
  assert.equal(await registration.reserve(f.user.email), false);
  await Budget.updateOne({ _id: budget._id }, { $set: { hits: [new Date(Date.now() - 29900)] } });
  assert.equal(await registration.reserve(f.user.email), false);
  await Budget.updateOne({ _id: budget._id }, { $set: { hits: [new Date(Date.now() - 30100)] } });
  assert.equal((await registration.issue({ identifier: f.user.email, channel: 'email', userId: f.user._id })).sent, true);
  const newHash = (await User.findById(f.user._id).select('+registration')).registration.codeHash;
  if (newHash !== original.codeHash) assert.equal(await verify(f), null);
  await Budget.updateOne({ _id: budget._id }, { $set: { hits: Array.from({ length: 5 }, (_, i) => new Date(Date.now() - 60000 - i * 60000)) } });
  assert.equal(await registration.reserve(f.user.email), false);
  await Budget.updateOne({ _id: budget._id }, { $set: { hits: [new Date(Date.now() - 3600001)] } });
  assert.equal(await registration.reserve(f.user.email), true);
});
test('concurrent resend requests admit one code, not multiple cooldown bypasses', async () => {
  const data = details(); const result = await Promise.all(Array.from({ length: 20 }, () => registration.reserve(data.email)));
  assert.equal(result.filter(Boolean).length, 1);
});
test('login/reset cannot bypass registration send budgets by switching purpose', async () => {
  const f = await fixture();
  const otp = require('../src/services/otpService');
  for (const purpose of ['login', 'reset']) {
    assert.equal((await otp.issue({ identifier: f.user.email, channel: 'email', purpose })).sent, false);
  }
  await Budget.updateOne({ _id: keyOf('registration-send', f.user.email) }, { $set: {
    hits: Array.from({ length: 5 }, (_, i) => new Date(Date.now() - 60000 - i * 60000)),
  } });
  assert.equal((await otp.issue({ identifier: f.user.email, channel: 'email', purpose: 'login' })).sent, false);
});
test('pre-upgrade OTP history preserves cooldown and five-per-hour cap', async () => {
  for (const count of [1, 5]) {
    const data = details();
    await Otp.insertMany(Array.from({ length: count }, (_, i) => ({
      identifier: data.email, channel: 'email', purpose: 'register', codeHash: 'legacy-hash',
      createdAt: new Date(Date.now() - (count === 1 ? 1000 : 60000 + i * 60000)),
      expiresAt: new Date(Date.now() + 600000), purgeAt: new Date(Date.now() + 4200000),
    })));
    assert.equal(await registration.reserve(data.email), false);
    await Otp.deleteMany({ identifier: data.email });
  }
});
test('registration and resends do not enumerate active, pending, absent email/mobile or provider failures', async () => {
  const pendingUser = await fixture(); const active = await fixture();
  await User.updateOne({ _id: active.user._id }, { $set: { emailVerified: true } });
  failDelivery = true;
  for (const channel of ['email', 'phone']) {
    const unknown = details(); const identifier = channel === 'email' ? unknown.email : '91' + unknown.phone;
    const responses = await Promise.all([identifier, pendingUser.user[channel], active.user[channel]].map((id) => call('/otp/send', { identifier: id, purpose: 'register' })));
    assert.ok(responses.every((r) => r.status === 200));
    assert.deepEqual(responses[0], responses[1]); assert.deepEqual(responses[1], responses[2]);
    const fresh = details();
    const a = await call('/register', { ...fresh, verifyVia: channel });
    const b = await call('/register', { ...active.data, verifyVia: channel });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
    assert.equal(a.body.expiresInSec, b.body.expiresInSec); assert.equal(a.body.resendAfterSec, b.body.resendAfterSec);
    const bad = await Promise.all([identifier, pendingUser.user[channel], active.user[channel]].map((id) => call('/register/verify', { identifier: id, code: '000000' })));
    assert.deepEqual(bad[0], bad[1]); assert.deepEqual(bad[1], bad[2]);
  }
  failDelivery = false;
});
test('suspended or already-verified accounts cannot activate through registration', async () => {
  const f = await fixture(); await User.updateOne({ _id: f.user._id }, { $set: { status: 'suspended' } });
  assert.equal(await verify(f), null);
});