'use strict';
// Multi-tenant isolation tests against a REAL MongoDB:  MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) {
  test('stores integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {});
  return;
}
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40);
process.env.APP_URL = 'http://localhost:3000'; process.env.MAX_STORES_PER_USER = '1';
const crypto = require('crypto');
const mongoose = require('mongoose');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store');
const tenantScoped = require('../src/models/tenantScoped');
const { hashPassword } = require('../src/utils/password');

const rnd = () => crypto.randomBytes(4).toString('hex');
let server, base;
const PW = 'Passw0rd!x';

async function makeUser(verified = true) {
  const phone = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const email = `m3${rnd()}@example.com`;
  await User.create({ name: 'Tester', email, phone: '91' + phone, passwordHash: await hashPassword(PW), emailVerified: verified });
  return { email, jar: '' };
}
async function login(u) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: PW }) });
  assert.equal(r.status, 200, 'login failed');
  u.jar = r.headers.getSetCookie()[0].split(';')[0];
  return u;
}
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, {
  method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(u && u.jar ? { cookie: u.jar } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const good = (slug, extra = {}) => ({ name: 'Priya Boutique', slug, whatsappNumber: '9876543210', ...extra });
let A, B, storeA, slugA;

test.before(async () => {
  assertEnv(); await connectDb(URI); await Store.init(); await User.init();
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  A = await login(await makeUser()); B = await login(await makeUser());
});
test.after(async () => {
  await Store.deleteMany({ slug: /^m3t-/ }); await User.deleteMany({ email: /^m3.*@example\.com$/ });
  server.close(); await disconnectDb();
});

test('anonymous users cannot use store routes', async () => {
  assert.equal((await api(null, '/stores')).status, 401);
  assert.equal((await api(null, '/stores', { method: 'POST', body: good('m3t-anon') })).status, 401);
});

test('unverified users cannot create a store (they cannot even log in)', async () => {
  // Since Module 2 hardening, login itself refuses unverified accounts, so no session can reach POST /stores.
  const u = await makeUser(false);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: PW }) });
  assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'not_verified');
  assert.equal(r.headers.getSetCookie().length, 0, 'no session cookie for an unverified account');
});

test('A creates a store; owner is the session user and privileged fields are ignored', async () => {
  slugA = `m3t-${rnd()}`;
  const evil = await User.findOne({ email: B.email });
  const r = await api(A, '/stores', { method: 'POST', body: good(slugA, { owner: String(evil._id), status: 'suspended', plan: 'pro', logoUrl: 'x', _id: '507f1f77bcf86cd799439011' }) });
  assert.equal(r.status, 201);
  storeA = r.json.store;
  const doc = await Store.findById(storeA.id);
  const me = await User.findOne({ email: A.email });
  assert.equal(String(doc.owner), String(me._id));
  assert.equal(doc.status, 'active'); assert.equal(doc.plan, 'free'); assert.equal(doc.logoUrl, '');
  assert.notEqual(storeA.id, '507f1f77bcf86cd799439011');
  assert.equal(storeA.owner, undefined, 'owner id must not be exposed');
});

test('store limit is enforced', async () => {
  const r = await api(A, '/stores', { method: 'POST', body: good(`m3t-${rnd()}`) });
  assert.equal(r.status, 403); assert.equal(r.json.error.code, 'store_limit');
});

test('slug rules: duplicate, reserved, invalid, injection', async () => {
  assert.equal((await api(B, '/stores', { method: 'POST', body: good(slugA) })).json.error.code, 'slug_taken');
  assert.equal((await api(B, '/stores', { method: 'POST', body: good('admin') })).status, 400);
  assert.equal((await api(B, '/stores', { method: 'POST', body: good('Bad Slug!') })).status, 400);
  assert.equal((await api(B, '/stores', { method: 'POST', body: good({ $ne: 'x' }) })).status, 400);
  assert.equal((await api(B, '/stores', { method: 'POST', body: { ...good('m3t-ok'), name: { $gt: '' } } })).status, 400);
});

test('slug-check is public and accurate', async () => {
  assert.equal((await api(null, `/stores/slug-check?slug=${slugA}`)).json.available, false);
  assert.equal((await api(null, `/stores/slug-check?slug=m3t-free-${rnd()}`)).json.available, true);
  assert.equal((await api(null, '/stores/slug-check?slug=api')).json.available, false);
});

test('B creates their own independent store', async () => {
  const r = await api(B, '/stores', { method: 'POST', body: good(`m3t-${rnd()}`, { name: 'B Store' }) });
  assert.equal(r.status, 201); B.store = r.json.store;
});

test('each user lists only their own stores', async () => {
  const a = await api(A, '/stores'), b = await api(B, '/stores');
  assert.deepEqual(a.json.stores.map((s) => s.id), [storeA.id]);
  assert.deepEqual(b.json.stores.map((s) => s.id), [B.store.id]);
});

test('ISOLATION: B cannot read, update, delete or reach sub-routes of A\'s store (404, unchanged)', async () => {
  for (const [method, path, body] of [
    ['GET', `/stores/${storeA.id}`], ['GET', `/stores/${storeA.id}/overview`],
    ['PATCH', `/stores/${storeA.id}`, { name: 'HACKED' }], ['PATCH', `/stores/${storeA.id}`, { slug: 'hacked-slug' }],
    ['DELETE', `/stores/${storeA.id}`, { confirmSlug: slugA }],
  ]) {
    const r = await api(B, path, { method, body });
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.json.error.code, 'store_not_found');
  }
  const doc = await Store.findById(storeA.id);
  assert.equal(doc.name, 'Priya Boutique'); assert.equal(doc.slug, slugA);
  // same response as a store id that does not exist: no way to probe for valid ids
  const ghost = await api(B, '/stores/507f1f77bcf86cd799439099');
  assert.deepEqual(ghost.json, (await api(B, `/stores/${storeA.id}`)).json);
  assert.equal((await api(B, '/stores/not-an-id')).status, 404);
  assert.equal((await api(null, `/stores/${storeA.id}`)).status, 401);
});

test('owner can update; slug change keeps the old slug reserved', async () => {
  const newSlug = `m3t-${rnd()}`;
  const r = await api(A, `/stores/${storeA.id}`, { method: 'PATCH', body: { name: 'Priya Boutique 2', tagline: 'Sarees', slug: newSlug, whatsappNumber: '+91 98765 43210', showcase: true } });
  assert.equal(r.status, 200); assert.equal(r.json.store.slug, newSlug); assert.equal(r.json.store.whatsappNumber, '919876543210');
  assert.equal((await api(B, '/stores/slug-check?slug=' + slugA)).json.available, false, 'old slug must stay reserved');
  assert.equal((await api(A, `/stores/${storeA.id}`, { method: 'PATCH', body: { slug: B.store.slug } })).json.error.code, 'slug_taken');
  assert.equal((await api(A, `/stores/${storeA.id}`, { method: 'PATCH', body: { owner: 'x', status: 'suspended', plan: 'pro' } })).json.store.plan, 'free');
  slugA = newSlug;
});

test('showcase shows only opted-in stores and no private fields', async () => {
  const r = await api(null, '/showcase');
  assert.equal(r.status, 200);
  const mine = r.json.stores.find((s) => s.slug === slugA);
  assert.ok(mine); assert.deepEqual(Object.keys(mine).sort(), ['cover', 'logoUrl', 'name', 'slug', 'tagline', 'url']);
  assert.ok(!r.json.stores.some((s) => s.slug === B.store.slug), 'non-opted-in store must be hidden');
  assert.equal((await api(null, '/public/showcase')).status, 200, 'landing page endpoint');
});

test('delete requires confirmation and only the owner can do it', async () => {
  assert.equal((await api(B, `/stores/${B.store.id}`, { method: 'DELETE', body: {} })).json.error.code, 'confirm_required');
  assert.equal((await api(B, `/stores/${B.store.id}`, { method: 'DELETE', body: { confirmSlug: B.store.slug } })).status, 200);
  assert.equal(await Store.countDocuments({ _id: B.store.id }), 0);
  assert.equal(await Store.countDocuments({ _id: storeA.id }), 1);
});

test('tenantScoped plugin blocks unscoped and operator queries', async () => {
  const schema = new mongoose.Schema({ title: String }); schema.plugin(tenantScoped);
  const Thing = mongoose.model('M3Thing', schema, 'm3_things_test');
  const sA = new mongoose.Types.ObjectId(), sB = new mongoose.Types.ObjectId();
  const doc = await Thing.create({ title: 'a', store: sA }); await Thing.create({ title: 'b', store: sB });
  await assert.rejects(() => Thing.find({}), /Tenant guard/);
  await assert.rejects(() => Thing.findById(doc._id), /Tenant guard/);
  await assert.rejects(() => Thing.find({ store: { $ne: sA } }), /Tenant guard/);
  await assert.rejects(() => Thing.updateMany({}, { title: 'x' }), /Tenant guard/);
  await assert.rejects(() => Thing.deleteMany({}), /Tenant guard/);
  await assert.rejects(() => Thing.aggregate([{ $match: {} }]), /Tenant guard/);
  assert.equal((await Thing.find({ store: sA })).length, 1);
  assert.equal(await Thing.findOne({ _id: doc._id, store: sB }), null);
  doc.store = sB; await assert.rejects(() => doc.save(), /cannot be changed/);
  assert.equal((await Thing.find({}).setOptions({ skipTenant: true })).length >= 2, true);
  await Thing.deleteMany({}).setOptions({ skipTenant: true });
});
