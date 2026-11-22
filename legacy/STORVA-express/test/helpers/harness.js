'use strict';
// Shared setup for the Module 7-15 integration suites: real Express app + real MongoDB (database name must contain "test").
// Usage:  const H = require('./helpers/harness'); if (!H.enabled) return H.skip(test, 'module 9');  test.before(H.start); test.after(H.stop);
const crypto = require('crypto');
const path = require('path');
const os = require('os');

const URI = process.env.MONGODB_URI;
const enabled = Boolean(URI && /test/i.test(URI));
function skip(test, name) { test(name + ' integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); }

if (enabled) {
  Object.assign(process.env, {
    NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40), OTP_PEPPER: 'y'.repeat(40), APP_URL: 'http://localhost:3000',
    MAX_STORES_PER_USER: '1', MAX_PRODUCTS_PER_STORE: '10000', CHECKOUT_RATE_LIMIT: '100000', QUOTE_RATE_LIMIT: '100000', DESIGN_RATE_LIMIT: '100000',
    EVENTS_RATE_LIMIT: '100000', AI_RATE_LIMIT: '100000', RECONCILE_ENABLED: 'false', ABANDON_CLEANUP_ENABLED: 'false', OUTBOX_ENABLED: 'false', PLAN_EXPIRY_ENABLED: 'false',
    UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'storva-int-uploads-' + process.pid),
  });
}

const rnd = () => crypto.randomBytes(4).toString('hex');
const PW = 'Passw0rd!x';
const H = { enabled, skip, rnd, PW, base: '', server: null, created: { users: [], stores: [] } };
let ipSeq = Math.floor(Math.random() * 60000) + 1;
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
H.fakeIp = fakeIp;

H.start = async () => {
  const { assertEnv } = require('../../src/config/env');
  const { connectDb } = require('../../src/config/db');
  const { createApp } = require('../../src/app');
  assertEnv(); await connectDb(URI);
  const mongoose = require('mongoose');
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => {})));
  H.server = createApp().listen(0); H.base = `http://127.0.0.1:${H.server.address().port}`;
};
H.stop = async () => {
  const mongoose = require('mongoose');
  const { runCascades } = require('../../src/middleware/tenant');
  const Store = require('../../src/models/Store'); const User = require('../../src/models/User');
  for (const id of H.created.stores) { await runCascades(id).catch(() => {}); }
  await Store.deleteMany({ _id: { $in: H.created.stores } });
  await User.deleteMany({ _id: { $in: H.created.users } });
  if (H.server) H.server.close();
  await mongoose.disconnect();
};

H.api = (u, p, { method = 'GET', body, headers = {}, raw } = {}) => fetch(H.base + '/api' + p, {
  method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
}).then(async (r) => { const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* not json */ } return { status: r.status, json, text: t, headers: r.headers }; });
H.pub = (u, p, opts) => H.api(null, `/public/stores/${u.slug}${p}`, opts);
H.page = async (p, opts = {}) => { const r = await fetch(H.base + p, { redirect: 'manual', ...opts, headers: { 'x-forwarded-for': fakeIp(), ...(opts.headers || {}) } }); return { status: r.status, text: await r.text(), headers: r.headers }; };

// A verified owner with one store. plan: 'free' | 'pro' | 'advanced' (set directly, like a completed payment would).
H.owner = async ({ plan = 'free', name = 'Test Store', whatsapp = '9876543210', email } = {}) => {
  const User = require('../../src/models/User'); const Store = require('../../src/models/Store');
  const { hashPassword } = require('../../src/utils/password');
  const em = email || `it${rnd()}@example.com`;
  const phone = '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await User.create({ name: 'Owner ' + rnd(), email: em, phone, passwordHash: await hashPassword(PW), emailVerified: true, phoneVerified: true });
  H.created.users.push(user._id);
  const r = await fetch(H.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: em, password: PW }) });
  if (r.status !== 200) throw new Error('login failed ' + r.status);
  const u = { email: em, phone, user, jar: r.headers.getSetCookie()[0].split(';')[0] };
  const s = await H.api(u, '/stores', { method: 'POST', body: { name, slug: `it-${rnd()}${rnd()}`.slice(0, 20), whatsappNumber: whatsapp } });
  if (s.status !== 201) throw new Error('store create failed ' + JSON.stringify(s.json));
  u.sid = s.json.store.id; u.slug = s.json.store.slug; H.created.stores.push(u.sid);
  if (plan !== 'free') await Store.updateOne({ _id: u.sid }, { plan, planCycle: 'monthly', planExpiresAt: new Date(Date.now() + 30 * 864e5) });
  return u;
};
H.product = async (u, body = {}) => {
  const r = await H.api(u, `/stores/${u.sid}/products`, { method: 'POST', body: { title: 'Item ' + rnd(), price: 500, stock: 20, status: 'active', ...body } });
  if (r.status !== 201) throw new Error('product create failed ' + JSON.stringify(r.json));
  return r.json.product;
};
H.ADDR = { line1: '12 MG Road', line2: '', city: 'Kochi', state: 'Kerala', pincode: '682001' };
H.order = async (u, items, extra = {}) => {
  const r = await H.pub(u, '/orders', { method: 'POST', body: { name: 'Priya Nair', phone: '9876543210', email: 'priya@example.com', address: H.ADDR, items, ...extra } });
  if (r.status !== 201) throw new Error('order failed ' + JSON.stringify(r.json));
  return r.json;
};
module.exports = H;
