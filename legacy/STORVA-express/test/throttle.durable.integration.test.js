'use strict';
// Needs a real MongoDB TEST database (name must contain "test"). Run: node scripts/test-registration-security.js
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.MONGODB_URI || !/test/i.test(process.env.MONGODB_URI)) {
  test('durable throttle integration', { skip: 'requires isolated MongoDB test database' }, () => {});
  return;
}
process.env.JWT_SECRET = 'test-session-secret-'.repeat(3);
process.env.OTP_PEPPER = 'test-otp-secret-'.repeat(3);
process.env.NODE_ENV = 'development';
const mongoose = require('mongoose');
const delivery = require('../src/services/delivery');
delivery.sendEmail = delivery.sendSms = async () => {}; // stub ONLY the provider boundary
const registration = require('../src/services/registrationService');
const { admitUnknownLogin } = require('../src/services/loginThrottle');
const Budget = require('../src/models/RegistrationBudget');
const User = require('../src/models/User');
const { keyOf } = require('../src/utils/identifierThrottle');
const express = require('express');
let server, base, serial = 0, second;
const tag = `thr-${process.pid}`;
const uniq = () => { serial += 1; return `${tag}-${serial}@example.com`; };
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(serial / 200)}.${serial % 200 + 1}` }, body: JSON.stringify(body) });
  serial += 1;
  return { status: r.status, body: await r.json() };
};

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Budget.init(), User.init()]);
  second = await mongoose.createConnection(process.env.MONGODB_URI).asPromise(); // stands in for a second app instance
  second.Budget = second.model('RegistrationBudget', Budget.schema);
  const app = express(); app.set('trust proxy', 1); app.use(express.json());
  app.use(require('../src/routes/auth'));
  app.use(require('../src/middleware/error').errorHandler);
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await Budget.deleteMany({});
  await User.deleteMany({ email: new RegExp(`^${tag}-`) });
  if (server) await new Promise((r) => server.close(r));
  if (second) await second.close();
  await mongoose.disconnect();
});

test('unknown login: a burst of 25 parallel failures admits exactly 5', async () => {
  const id = uniq();
  const r = await Promise.all(Array.from({ length: 25 }, () => admitUnknownLogin(id)));
  assert.equal(r.filter(Boolean).length, 5);
  assert.equal(await admitUnknownLogin(id), false);
});
test('unknown login: limit is shared by two instances (separate connections) and is per identifier', async () => {
  const id = uniq(), other = uniq();
  const a = Array.from({ length: 10 }, () => admitUnknownLogin(id));
  const b = Array.from({ length: 10 }, () => admitUnknownLogin(id, { model: second.Budget }));
  assert.equal((await Promise.all([...a, ...b])).filter(Boolean).length, 5);
  assert.equal(await admitUnknownLogin(other), true);
});
test('unknown login: expiry uses the database clock; old failures stop counting', async () => {
  const id = uniq();
  for (let i = 0; i < 5; i++) assert.equal(await admitUnknownLogin(id), true);
  assert.equal(await admitUnknownLogin(id), false);
  const old = new Date(Date.now() - 16 * 60 * 1000);
  await Budget.updateOne({ _id: keyOf('login-unknown', id) }, { $set: { hits: [old, old, old, old, old] } });
  assert.equal(await admitUnknownLogin(id), true);
  const doc = await Budget.findById(keyOf('login-unknown', id)).lean();
  assert.equal(doc.hits.length, 1);
});
test('unknown login: cleanup is configured and no raw identifier is stored', async () => {
  const id = uniq(); await admitUnknownLogin(id);
  const doc = await Budget.findById(keyOf('login-unknown', id)).lean();
  assert.ok(doc.purgeAt > new Date());
  assert.ok(!JSON.stringify(doc).includes(id));
  const idx = await Budget.collection.indexes();
  assert.ok(idx.some((i) => i.key.purgeAt === 1 && i.expireAfterSeconds === 0), 'TTL index on purgeAt');
});
test('unknown login over HTTP: locks after 5 wrong passwords with the same 429 as a real locked account', async () => {
  const email = uniq();
  const real = uniq();
  await User.create({ name: 'Real User', email: real, phone: '91' + String(9000000000 + serial), passwordHash: 'x', emailVerified: true });
  for (const who of [email]) {
    for (let i = 0; i < 5; i++) assert.equal((await post('/login', { identifier: who, password: 'Wrong-pass1' })).status, 401);
  }
  const unknown = await post('/login', { identifier: email, password: 'Wrong-pass1' });
  assert.equal(unknown.status, 429); assert.equal(unknown.body.error.code, 'too_many_attempts');
  // Real account: the DB lock produces the identical response after 5 failures.
  for (let i = 0; i < 5; i++) assert.equal((await post('/login', { identifier: real, password: 'Wrong-pass1' })).status, 401);
  const locked = await post('/login', { identifier: real, password: 'Wrong-pass1' });
  assert.equal(locked.status, unknown.status); assert.deepEqual(locked.body.error, unknown.body.error);
});
test('sign-up budget: 25 parallel reservations for one email/mobile admit exactly 5 (durable, atomic)', async () => {
  const e = uniq();
  const r = await Promise.all(Array.from({ length: 25 }, () => registration.reserve(e, 'signup', 0)));
  assert.equal(r.filter(Boolean).length, 5);
  assert.equal(await registration.reserve(uniq(), 'signup', 0), true); // other identifiers unaffected
});
test('sign-up budget is shared across instances and expires on the database clock', async () => {
  const e = uniq();
  for (let i = 0; i < 5; i++) assert.equal(await registration.reserve(e, 'signup', 0), true);
  assert.equal(await registration.reserve(e, 'signup', 0), false);
  const old = new Date(Date.now() - 61 * 60 * 1000);
  await second.Budget.updateOne({ _id: keyOf('signup', e) }, { $set: { hits: [old, old, old, old, old] } }); // written by "another instance"
  assert.equal(await registration.reserve(e, 'signup', 0), true);
});
test('sign-up over HTTP: 6th attempt for the same email is 429, identically for an already-registered email', async () => {
  const fresh = uniq(), existing = uniq();
  await User.create({ name: 'Existing Owner', email: existing, phone: '91' + String(8000000000 + serial), passwordHash: 'x', emailVerified: true });
  const attempt = (email) => post('/register', { name: 'Test Person', email, phone: String(7000000000 + (serial % 99999999)), password: 'Passw0rd1', verifyVia: 'email' });
  const out = {};
  for (const [k, email] of Object.entries({ fresh, existing })) {
    for (let i = 0; i < 5; i++) assert.equal((await attempt(email)).status, 201, `${k} attempt ${i + 1}`);
    out[k] = await attempt(email);
    assert.equal(out[k].status, 429); assert.equal(out[k].body.error.code, 'too_many_attempts');
  }
  assert.deepEqual(out.fresh.body.error, out.existing.body.error);
});
