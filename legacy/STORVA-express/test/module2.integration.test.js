'use strict';
// End-to-end auth tests against a REAL MongoDB. Run with:  MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm test
// Skipped automatically when MONGODB_URI is not set. Never point this at production data.
// Codes are read from the database via the same HMAC the server uses (no test-only backdoor in the app).
const test = require('node:test');
const assert = require('node:assert/strict');

const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) {
  test('auth integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {});
  return;
}
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40);
process.env.APP_URL = 'http://localhost:3000';
const { env, assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const Otp = require('../src/models/Otp'); const User = require('../src/models/User'); const Session = require('../src/models/Session');
const { hashOtp, hashRegistrationOtp } = require('../src/utils/secure');
const crypto = require('crypto');

let server, base;
const jar = {};
const call = async (path, { method = 'GET', body, cookie = true, headers = {} } = {}) => {
  const r = await fetch(base + '/api' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie && jar.c ? { cookie: jar.c } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) { const pair = sc[0].split(';')[0]; jar.c = pair.endsWith('=') ? '' : pair; jar.raw = sc[0]; }
  return { status: r.status, json: await r.json().catch(() => null) };
};
// Plant a known code for an identifier (the same hash the server verifies) instead of reading SMS/email.
const plant = async (identifier, purpose, code = '246810') => {
  if (purpose === 'register') {
    const user = await User.findOne({ email: identifier });
    await User.updateOne({ _id: user._id }, { $set: { registration: {
      identifier, channel: 'email', codeHash: hashRegistrationOtp(env.otpPepper, user._id, identifier, 'email', code),
      expiresAt: new Date(Date.now() + 600000), attempts: 0, consumedAt: null,
    } } });
    return code;
  }
  await Otp.updateMany({ identifier, consumedAt: null }, { consumedAt: new Date() });
  await Otp.create({ identifier, channel: identifier.includes('@') ? 'email' : 'phone', purpose, codeHash: hashOtp(env.otpPepper, identifier, purpose, code), expiresAt: new Date(Date.now() + 600000), purgeAt: new Date(Date.now() + 4000000) });
  return code;
};
const rnd = () => crypto.randomBytes(4).toString('hex');
const email = `t${rnd()}@example.com`, phone = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
const phoneId = '91' + phone;

test.before(async () => { assertEnv(); await connectDb(URI); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await User.deleteMany({ email }); await Otp.deleteMany({ identifier: { $in: [email, phoneId] } }); server.close(); await disconnectDb(); });

test('register validates input and rejects weak passwords', async () => {
  const r = await call('/auth/register', { method: 'POST', body: { name: 'A', email: 'bad', phone: '123', password: 'weak' } });
  assert.equal(r.status, 400); assert.deepEqual(Object.keys(r.json.error.fields).sort(), ['email', 'name', 'password', 'phone']);
});

test('register -> login blocked until verified -> verify creates secure session', async () => {
  let r = await call('/auth/register', { method: 'POST', body: { name: 'Test Owner', email, phone, password: 'Passw0rd1', verifyVia: 'email' } });
  assert.equal(r.status, 201); assert.equal(r.json.identifier, email); assert.equal(JSON.stringify(r.json).includes('code'), false, 'code never returned');
  r = await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'Passw0rd1' } });
  assert.equal(r.status, 403); assert.equal(r.json.error.code, 'not_verified');
  r = await call('/auth/register/verify', { method: 'POST', body: { identifier: email, code: '000000' } });
  assert.equal(r.status, 400);
  await plant(email, 'register');
  r = await call('/auth/register/verify', { method: 'POST', body: { identifier: email, code: '246810' } });
  assert.equal(r.status, 200); assert.equal(r.json.user.emailVerified, true); assert.equal(r.json.user.passwordHash, undefined);
  assert.match(jar.raw, /HttpOnly/i); assert.match(jar.raw, /SameSite=Lax/i);
  r = await call('/auth/me'); assert.equal(r.status, 200); assert.equal(r.json.user.email, email);
  const stored = await Session.findOne({ user: r.json.user.id }); assert.notEqual(stored.tokenHash, jar.c.split('=')[1], 'only a hash of the token is stored');
});

test('an OTP is single-use', async () => {
  await plant(email, 'login');
  jar.c = '';
  let r = await call('/auth/otp/login', { method: 'POST', body: { identifier: email, code: '246810' } }); assert.equal(r.status, 200);
  r = await call('/auth/otp/login', { method: 'POST', body: { identifier: email, code: '246810' } }); assert.equal(r.status, 400);
});

test('a code is burned after 5 wrong guesses even if the right code follows', async () => {
  await plant(email, 'login');
  for (let i = 0; i < 5; i++) await call('/auth/otp/login', { method: 'POST', body: { identifier: email, code: '111111' } });
  const r = await call('/auth/otp/login', { method: 'POST', body: { identifier: email, code: '246810' } });
  assert.equal(r.status, 400);
});

test('login: wrong password gives generic error and unknown user is indistinguishable', async () => {
  const a = await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'Wrong123x' } });
  const b = await call('/auth/login', { method: 'POST', body: { identifier: 'nobody@example.com', password: 'Wrong123x' } });
  assert.equal(a.status, 401); assert.deepEqual(a.json, b.json);
});

test('otp/send responds identically for existing and unknown accounts', async () => {
  const a = await call('/auth/otp/send', { method: 'POST', body: { identifier: email, purpose: 'login' } });
  const b = await call('/auth/otp/send', { method: 'POST', body: { identifier: 'ghost@example.com', purpose: 'login' } });
  assert.equal(a.status, 200); assert.deepEqual(a.json, b.json);
});

test('forgot/reset password rotates the password and revokes every session', async () => {
  await call('/auth/password/forgot', { method: 'POST', body: { identifier: email } });
  await plant(email, 'reset');
  let r = await call('/auth/password/reset', { method: 'POST', body: { identifier: email, code: '246810', password: 'weak' } });
  assert.equal(r.status, 400, 'weak password rejected without burning the code');
  r = await call('/auth/password/reset', { method: 'POST', body: { identifier: email, code: '246810', password: 'NewPassw0rd2' } });
  assert.equal(r.status, 200);
  assert.equal(await Session.countDocuments({ user: (await User.findOne({ email }))._id }), 0);
  assert.equal((await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'Passw0rd1' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'NewPassw0rd2' } })).status, 200);
});

test('account locks after repeated failures, then OTP reset still works', async () => {
  jar.c = '';
  for (let i = 0; i < 5; i++) await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'Bad' + i + 'pass99' } });
  const r = await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'NewPassw0rd2' } });
  assert.equal(r.status, 429); assert.equal(r.json.error.code, 'too_many_attempts'); // was 'account_locked'; now identical for unknown accounts (enumeration fix)
});

test('logout invalidates the session server-side; cross-site Origin is blocked', async () => {
  await User.updateOne({ email }, { lockUntil: null, failedLogins: 0 });
  await call('/auth/login', { method: 'POST', body: { identifier: email, password: 'NewPassw0rd2' } });
  const stolen = jar.c;
  let r = await call('/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403); assert.equal(r.json.error.code, 'bad_origin');
  r = await call('/auth/logout', { method: 'POST' }); assert.equal(r.status, 200);
  r = await call('/auth/me', { cookie: false, headers: { cookie: stolen } }); assert.equal(r.status, 401, 'replaying the old cookie fails');
});

test('protected routes reject anonymous users', async () => {
  jar.c = '';
  for (const [m, p] of [['GET', '/auth/sessions'], ['POST', '/auth/password/change'], ['POST', '/auth/logout-all'], ['PATCH', '/auth/me']]) {
    assert.equal((await call(p, { method: m, body: m === 'GET' ? undefined : {} })).status, 401, p);
  }
});
