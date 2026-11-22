'use strict';
// Module 5 against a REAL MongoDB:  MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
// NOTE: this suite has NOT been executed in the sandbox this module was written in (no MongoDB, no npm registry).
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('module 5 integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40);
process.env.APP_URL = 'http://localhost:3000'; process.env.MAX_STORES_PER_USER = '1'; process.env.MAX_PRODUCTS_PER_STORE = '50';
process.env.CHECKOUT_RATE_LIMIT = '100000'; process.env.QUOTE_RATE_LIMIT = '100000';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-m5-uploads-' + process.pid);
const crypto = require('crypto');
const { assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product');
const Collection = require('../src/models/Collection'); const Coupon = require('../src/models/Coupon'); const Order = require('../src/models/Order'); const Counter = require('../src/models/Counter');
const { hashPassword } = require('../src/utils/password');

const rnd = () => crypto.randomBytes(4).toString('hex'); const PW = 'Passw0rd!x';
let server, base, A, B, ipSeq = 1;
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`; // each request looks like a different shopper (trust proxy = 1)
async function mkUser() { const email = `m5${rnd()}@example.com`; await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true }); return { email }; }
async function login(u) { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fakeIp() }, body: JSON.stringify({ identifier: u.email, password: PW }) }); assert.equal(r.status, 200); u.jar = r.headers.getSetCookie()[0].split(';')[0]; return u; }
const api = (u, path, { method = 'GET', body } = {}) => fetch(base + '/api' + path, { method, headers: { 'x-forwarded-for': fakeIp(), ...(u && u.jar ? { cookie: u.jar } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const pub = (store, path, opts) => api(null, `/public/stores/${store.slug}${path}`, opts);
const page = async (path, opts = {}) => { const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { 'x-forwarded-for': fakeIp(), ...(opts.headers || {}) } }); return { status: r.status, text: await r.text(), location: r.headers.get('location') }; };
const ADDR = { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const checkout = (items, extra = {}) => ({ name: 'Priya Nair', phone: '9876543210', email: 'priya@example.com', address: ADDR, items, ...extra });
const mkProduct = async (u, body) => { const r = await api(u, `/stores/${u.sid}/products`, { method: 'POST', body: { status: 'active', ...body } }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.product; };
const mkCoupon = async (u, body) => { const r = await api(u, `/stores/${u.sid}/coupons`, { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.coupon; };
const stockOf = async (u, id) => (await Product.findOne({ _id: id, store: u.sid })).stock;
const used = async (u, id) => (await Coupon.findOne({ _id: id, store: u.sid })).usedCount;

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Collection.init(), Coupon.init(), Order.init(), Counter.init(), User.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ['A', 'B']) {
    const u = await login(await mkUser()); const r = await api(u, '/stores', { method: 'POST', body: { name: `M5 Store ${k}`, slug: `m5t-${k.toLowerCase()}-${rnd()}`, tagline: `Tagline ${k}`, whatsappNumber: '9876543210' } });
    assert.equal(r.status, 201, JSON.stringify(r.json)); u.sid = r.json.store.id; u.slug = r.json.store.slug; if (k === 'A') A = u; else B = u;
    await Store.updateOne({ _id: u.sid }, { plan: 'pro', planCycle: 'monthly', planExpiresAt: new Date(Date.now() + 30 * 864e5) }); // Module 8: coupons are a Pro feature
  }
});
test.after(async () => {
  const ids = [A, B].filter(Boolean).map((u) => u.sid);
  for (const M of [Product, Collection, Coupon, Order, Counter]) await M.deleteMany({}).setOptions({ skipTenant: true }).where({ store: { $in: ids } });
  await Store.deleteMany({ _id: { $in: ids } }); await User.deleteMany({ email: /^m5.*@example\.com$/ });
  server.close(); await disconnectDb();
});

let saree, draft, tee, bProd, col, pctCoupon;

test('public store API: branding, collections and ACTIVE products only; drafts hidden; other stores unreachable', async () => {
  saree = await mkProduct(A, { title: 'M5 Silk Saree', price: 1000, compareAtPrice: 1500, stock: 10, category: 'Sarees' });
  draft = await mkProduct(A, { title: 'M5 Secret Draft', price: 50, stock: 1, status: 'draft' });
  bProd = await mkProduct(B, { title: 'M5 B Only Item', price: 70, stock: 5 });
  col = (await api(A, `/stores/${A.sid}/collections`, { method: 'POST', body: { name: 'M5 Festive' } })).json.collection;
  assert.equal((await api(A, `/stores/${A.sid}/collections/${col.id}/products`, { method: 'PUT', body: { productIds: [saree.id] } })).status, 200);
  const s = await pub(A, '');
  assert.equal(s.status, 200); assert.equal(s.json.store.name, 'M5 Store A'); assert.equal(s.json.store.tagline, 'Tagline A');
  assert.deepEqual(Object.keys(s.json.store).sort(), ['address', 'contactEmail', 'currency', 'description', 'logoUrl', 'name', 'slug', 'tagline', 'whatsappNumber'], 'no owner id, status or plan leaks');
  assert.deepEqual(s.json.collections.map((c) => [c.slug, c.productCount]), [['m5-festive', 1]]);
  const l = await pub(A, '/products'); assert.deepEqual(l.json.products.map((p) => p.title), ['M5 Silk Saree']); assert.equal(l.json.total, 1);
  assert.equal(l.json.products[0].price, 1000); assert.equal(l.json.products[0].inStock, true);
  assert.equal((await pub(A, `/products/${draft.slug}`)).status, 404, 'draft product');
  assert.equal((await pub(A, `/products/${bProd.slug}`)).status, 404, 'a product of another store');
  assert.equal((await pub(A, '/products?collection=m5-festive')).json.total, 1); assert.equal((await pub(A, '/products?collection=nope')).json.total, 0);
  assert.equal((await pub(A, '/products?q=' + encodeURIComponent('.*'))).json.total, 0, 'regex characters are escaped');
  assert.equal((await pub(A, '/products?q[$ne]=x')).status, 200);
  assert.equal((await api(null, '/public/stores/does-not-exist')).status, 404);
  assert.equal((await api(null, '/public/stores/' + encodeURIComponent('{"$ne":1}'))).status, 404);
});

test('storefront pages: /store/:slug, product, cart, checkout render; unknown store and draft are 404 pages', async () => {
  const home = await page(`/store/${A.slug}`);
  assert.equal(home.status, 200); assert.match(home.text, /M5 Store A/); assert.match(home.text, /M5 Silk Saree/); assert.ok(!home.text.includes('M5 Secret Draft')); assert.ok(!home.text.includes('M5 B Only Item'));
  assert.match(home.text, /name="viewport"/); assert.match(home.text, /M5 Festive/);
  assert.match((await page(`/store/${A.slug}?collection=m5-festive`)).text, /M5 Silk Saree/);
  assert.equal((await page(`/store/${A.slug}?q=zzzz`)).status, 200);
  const pdp = await page(`/store/${A.slug}/product/${saree.slug}`); assert.equal(pdp.status, 200); assert.match(pdp.text, /Add to cart/); assert.match(pdp.text, /id="product-data"/);
  assert.equal((await page(`/store/${A.slug}/product/${draft.slug}`)).status, 404); assert.equal((await page(`/store/${A.slug}/product/${bProd.slug}`)).status, 404);
  assert.equal((await page(`/store/${A.slug}/cart`)).status, 200); assert.equal((await page(`/store/${A.slug}/checkout`)).status, 200);
  assert.equal((await page('/store/not-a-store')).status, 404);
  const hostile = await Product.create({ store: A.sid, title: 'M5 <script>alert(1)</script>', slug: 'm5-xss', pricePaise: 100, status: 'active', stock: 1 });
  const x = await page(`/store/${A.slug}`); assert.ok(!x.text.includes('<script>alert(1)</script>'), 'product titles are escaped'); assert.match(x.text, /&lt;script&gt;/);
  const xp = await page(`/store/${A.slug}/product/m5-xss`); assert.ok(!xp.text.includes('<script>alert(1)</script>'), 'escaped on the product page and in the embedded JSON');
  await Product.deleteOne({ _id: hostile._id, store: A.sid });
});

test('renamed store: old address redirects (301); suspended store is not served', async () => {
  const old = A.slug, fresh = `m5t-a-${rnd()}`;
  assert.equal((await api(A, `/stores/${A.sid}`, { method: 'PATCH', body: { slug: fresh } })).status, 200); A.slug = fresh;
  const r = await page(`/store/${old}/product/${saree.slug}`); assert.equal(r.status, 301); assert.equal(r.location, `/store/${fresh}/product/${saree.slug}`);
  assert.equal((await api(null, `/public/stores/${old}`)).status, 404, 'API does not redirect');
  await Store.updateOne({ _id: A.sid }, { status: 'suspended' });
  assert.equal((await pub(A, '')).status, 404); assert.equal((await page(`/store/${A.slug}`)).status, 404);
  await Store.updateOne({ _id: A.sid }, { status: 'active' });
  assert.equal((await pub(A, '')).status, 200);
});

test('coupons (owner): CRUD, validation, duplicates, same code allowed in another store, isolation', async () => {
  assert.equal((await api(null, `/stores/${A.sid}/coupons`)).status, 401);
  assert.equal((await api(B, `/stores/${A.sid}/coupons`)).status, 404);
  assert.equal((await api(B, `/stores/${A.sid}/coupons`, { method: 'POST', body: { code: 'HACK', type: 'percent', value: 90 } })).status, 404);
  pctCoupon = await mkCoupon(A, { code: 'm5save10', type: 'percent', value: 10, minOrder: 500, maxDiscount: 150 });
  assert.equal(pctCoupon.code, 'M5SAVE10'); assert.equal(pctCoupon.minOrder, 500); assert.equal(pctCoupon.usedCount, 0);
  const dup = await api(A, `/stores/${A.sid}/coupons`, { method: 'POST', body: { code: 'M5SAVE10', type: 'fixed', value: 5 } }); assert.equal(dup.status, 409); assert.ok(dup.json.error.fields.code);
  assert.equal((await api(A, `/stores/${A.sid}/coupons`, { method: 'POST', body: { code: 'x', type: 'percent', value: 500 } })).status, 400);
  assert.equal((await api(A, `/stores/${A.sid}/coupons`, { method: 'POST', body: { code: { $ne: 1 }, type: 'percent', value: 5 } })).status, 400);
  const bc = await mkCoupon(B, { code: 'M5SAVE10', type: 'percent', value: 50 }); assert.equal(bc.value, 50);
  assert.equal((await api(A, `/stores/${A.sid}/coupons`)).json.coupons.length, 1); assert.equal((await api(B, `/stores/${B.sid}/coupons/${pctCoupon.id}`)).status, 404);
  assert.equal((await api(A, `/stores/${A.sid}/coupons/${pctCoupon.id}`, { method: 'PATCH', body: { code: 'CHANGED' } })).status, 400);
  assert.equal((await api(A, `/stores/${A.sid}/coupons/${pctCoupon.id}`, { method: 'PATCH', body: { description: 'ten percent' } })).json.coupon.description, 'ten percent');
});

test('cart quote: prices come from the database; cross-store ids, stock and junk input are handled', async () => {
  const q = await pub(A, '/cart/quote', { method: 'POST', body: { items: [{ productId: saree.id, qty: 2, price: 1 }] } });
  assert.equal(q.status, 200); assert.equal(q.json.subtotal, 2000); assert.equal(q.json.total, 2000); assert.equal(q.json.lines[0].unitPrice, 1000); assert.equal(q.json.canCheckout, true);
  const cross = await pub(A, '/cart/quote', { method: 'POST', body: { items: [{ productId: bProd.id, qty: 1 }] } });
  assert.equal(cross.json.lines[0].ok, false); assert.equal(cross.json.canCheckout, false); assert.equal(cross.json.subtotal, 0);
  const dr = await pub(A, '/cart/quote', { method: 'POST', body: { items: [{ productId: draft.id, qty: 1 }] } }); assert.equal(dr.json.lines[0].ok, false);
  const over = await pub(A, '/cart/quote', { method: 'POST', body: { items: [{ productId: saree.id, qty: 11 }] } }); assert.equal(over.json.lines[0].ok, false); assert.match(over.json.lines[0].problem, /Only 10 left/);
  for (const items of [[], 'x', [{ productId: { $ne: 1 }, qty: 1 }], [{ productId: saree.id, qty: -1 }], [{ productId: saree.id, qty: 99 }]]) assert.equal((await pub(A, '/cart/quote', { method: 'POST', body: { items } })).status, 400, JSON.stringify(items));
  assert.equal((await pub(A, '/cart/quote', { method: 'POST', body: {} })).status, 400);
});

test('coupon validation at the shopper side: percent, cap, minimum, case, other store, inactive, expired, limit', async () => {
  const v = (code, qty = 2, store = A, pid = saree.id) => pub(store, '/coupons/validate', { method: 'POST', body: { code, items: [{ productId: pid, qty }] } });
  let r = await v('m5save10'); assert.equal(r.json.valid, true); assert.equal(r.json.discount, 150, '10% of 2000 = 200, capped at 150'); assert.equal(r.json.total, 1850);
  r = await v('M5SAVE10', 1); assert.equal(r.json.discount, 100); assert.equal(r.json.total, 900);
  assert.equal((await v('NOPE')).json.valid, false); assert.equal((await v('')).status, 400);
  const small = await mkProduct(A, { title: 'M5 Cheap', price: 100, stock: 50 }); r = await v('M5SAVE10', 2, A, small.id); assert.equal(r.json.valid, false); assert.match(r.json.message, /minimum order/);
  // B's 50% coupon with the same code does not leak into A's pricing, and A's code is invalid in B
  assert.equal((await v('M5SAVE10', 1, B, bProd.id)).json.discount, 35);
  const only = await mkCoupon(A, { code: 'M5ONLYA', type: 'fixed', value: 10 }); assert.equal((await v('M5ONLYA', 1, B, bProd.id)).json.valid, false);
  await api(A, `/stores/${A.sid}/coupons/${only.id}`, { method: 'PATCH', body: { active: false } }); assert.equal((await v('M5ONLYA')).json.valid, false);
  await Coupon.create({ store: A.sid, code: 'M5EXPIRED', type: 'fixed', value: 1000, expiresAt: new Date(Date.now() - 1000) }); assert.match((await v('M5EXPIRED')).json.message, /expired/);
  await Coupon.create({ store: A.sid, code: 'M5FUTURE', type: 'fixed', value: 1000, startsAt: new Date(Date.now() + 86400000) }); assert.match((await v('M5FUTURE')).json.message, /not active yet/);
  await Coupon.create({ store: A.sid, code: 'M5USEDUP', type: 'fixed', value: 1000, usageLimit: 1, usedCount: 1 }); assert.match((await v('M5USEDUP')).json.message, /fully used/);
  const fixed = await mkCoupon(A, { code: 'M5BIG', type: 'fixed', value: 5000 }); assert.equal((await v('M5BIG', 1)).json.total, 0, 'a fixed coupon cannot push the total below zero');
});

test('checkout: validation errors, order creation, totals, stock and coupon accounting, order numbers, idempotency, snapshots', async () => {
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }], { phone: '123' }) })).status, 400);
  const bad = await pub(A, '/orders', { method: 'POST', body: { items: [{ productId: saree.id, qty: 1 }] } }); assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.name && bad.json.error.fields.phone && bad.json.error.fields.pincode);
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }], { couponCode: 'NOPE1' }) })).status, 400);
  assert.equal(await stockOf(A, saree.id), 10, 'failed checkouts do not touch stock');

  const key = 'idem-' + rnd() + rnd();
  const r1 = await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 2, price: 1 }], { couponCode: 'm5save10', idempotencyKey: key, total: 1 }) });
  assert.equal(r1.status, 201, JSON.stringify(r1.json)); const o = r1.json.order;
  assert.equal(o.orderNumber, 1001); assert.equal(o.subtotal, 2000); assert.equal(o.discount, 150); assert.equal(o.total, 1850); assert.equal(o.status, 'pending'); assert.equal(o.paymentMethod, 'cod'); assert.equal(o.customer.phone, '919876543210');
  assert.equal(await stockOf(A, saree.id), 8); assert.equal(await used(A, pctCoupon.id), 1);
  assert.match(r1.json.url, new RegExp(`/store/${A.slug}/order/1001\\?t=[a-f0-9]{32}`));
  const again = await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 2 }], { couponCode: 'M5SAVE10', idempotencyKey: key }) });
  assert.equal(again.status, 200); assert.equal(again.json.replayed, true); assert.equal(again.json.order.orderNumber, 1001);
  assert.equal(await stockOf(A, saree.id), 8, 'a repeated submit does not reserve stock twice'); assert.equal(await Order.countDocuments({ store: A.sid }), 1);
  const r2 = await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }]) }); assert.equal(r2.json.order.orderNumber, 1002);
  assert.equal((await pub(B, '/orders', { method: 'POST', body: checkout([{ productId: bProd.id, qty: 1 }]) })).json.order.orderNumber, 1001, 'order numbers are per store');
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: bProd.id, qty: 1 }]) })).status, 409, "another store's product cannot be ordered through this store");
  assert.equal(await stockOf(B, bProd.id), 4);

  await api(A, `/stores/${A.sid}/products/${saree.id}`, { method: 'PATCH', body: { title: 'M5 Renamed', price: 5 } });
  const snap = (await api(A, `/stores/${A.sid}/orders/1001`)).json.order; assert.equal(snap.items[0].title, 'M5 Silk Saree'); assert.equal(snap.items[0].unitPrice, 1000); assert.equal(snap.total, 1850);
  await api(A, `/stores/${A.sid}/products/${saree.id}`, { method: 'PATCH', body: { title: 'M5 Silk Saree', price: 1000 } });
  A.order = { number: 1001, token: r1.json.token };

  // buyer confirmation page: needs the right token
  const okPage = await page(`/store/${A.slug}/order/1001?t=${r1.json.token}`); assert.equal(okPage.status, 200); assert.match(okPage.text, /#1001/); assert.match(okPage.text, /M5 Silk Saree/);
  assert.equal((await page(`/store/${A.slug}/order/1001?t=${'0'.repeat(32)}`)).status, 404); assert.equal((await page(`/store/${A.slug}/order/1001`)).status, 404);
  assert.equal((await page(`/store/${B.slug}/order/1001?t=${r1.json.token}`)).status, 404, "an order link does not work under another store's address");
  assert.equal((await pub(A, `/orders/1001?t=${r1.json.token}`)).status, 200); assert.equal((await pub(A, '/orders/1001?t[$ne]=x')).status, 404);
  assert.ok(!('publicToken' in (await pub(A, `/orders/1001?t=${r1.json.token}`)).json.order));
});

test('variants: stock is per variant; a missing or foreign variant is refused', async () => {
  tee = await mkProduct(A, { title: 'M5 Tee', price: 400, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ options: { Size: 'S' }, stock: 2 }, { options: { Size: 'M' }, stock: 3, price: 450 }] });
  const S = tee.variants.find((v) => v.key === 'S'), M = tee.variants.find((v) => v.key === 'M');
  const pj = (await pub(A, `/products/${tee.slug}`)).json.product; assert.equal(pj.hasVariants, true); assert.equal(pj.priceFrom, 400); assert.equal(pj.variants.find((v) => v.key === 'M').price, 450);
  assert.ok(!JSON.stringify(pj).includes('"stock"'), 'exact stock numbers are not exposed, only maxQty');
  const q = await pub(A, '/cart/quote', { method: 'POST', body: { items: [{ productId: tee.id, qty: 1 }] } }); assert.equal(q.json.lines[0].ok, false); assert.equal(q.json.canCheckout, false);
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: tee.id, qty: 1 }]) })).status, 409);
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: tee.id, variantId: 'f'.repeat(24), qty: 1 }]) })).status, 409);
  const r = await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: tee.id, variantId: M.id, qty: 2 }]) }); assert.equal(r.status, 201); assert.equal(r.json.order.total, 900); assert.equal(r.json.order.items[0].variantLabel, 'Size: M');
  let doc = await Product.findOne({ _id: tee.id, store: A.sid }); assert.equal(doc.variants.find((v) => v.key === 'M').stock, 1); assert.equal(doc.variants.find((v) => v.key === 'S').stock, 2);
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: tee.id, variantId: M.id, qty: 2 }]) })).status, 409, 'only 1 left');
  assert.equal((await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }, { productId: tee.id, variantId: S.id, qty: 5 }]) })).status, 409, 'one bad line refuses the whole order');
  // Rollback: 4 parallel orders want [saree x1 + rare x1] but only ONE rare item exists. Whatever the interleaving, the saree stock must drop by exactly the number of orders that succeeded.
  const rare = await mkProduct(A, { title: 'M5 Rare', price: 900, stock: 1 }); const before = await stockOf(A, saree.id);
  const rs = await Promise.all(Array.from({ length: 4 }, () => pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }, { productId: rare.id, qty: 1 }]) })));
  const won = rs.filter((x) => x.status === 201).length; assert.equal(won, 1, JSON.stringify(rs.map((x) => x.status))); assert.equal(await stockOf(A, rare.id), 0);
  assert.equal(await stockOf(A, saree.id), before - won, 'stock reserved by the losing orders was given back');
});

test('concurrency: parallel orders never oversell and never exceed a coupon limit', async () => {
  const hot = await mkProduct(A, { title: 'M5 Hot Item', price: 100, stock: 3 });
  const rs = await Promise.all(Array.from({ length: 8 }, () => pub(A, '/orders', { method: 'POST', body: checkout([{ productId: hot.id, qty: 1 }]) })));
  assert.equal(rs.filter((x) => x.status === 201).length, 3, JSON.stringify(rs.map((x) => x.status))); assert.equal(rs.filter((x) => x.status === 409).length, 5); assert.equal(await stockOf(A, hot.id), 0);
  const nums = rs.filter((x) => x.status === 201).map((x) => x.json.order.orderNumber); assert.equal(new Set(nums).size, 3, 'order numbers are unique');

  const plenty = await mkProduct(A, { title: 'M5 Plenty', price: 100, stock: 50 });
  const lim = await mkCoupon(A, { code: 'M5LIMIT2', type: 'fixed', value: 10, usageLimit: 2 });
  const rc = await Promise.all(Array.from({ length: 6 }, () => pub(A, '/orders', { method: 'POST', body: checkout([{ productId: plenty.id, qty: 1 }], { couponCode: 'M5LIMIT2' }) })));
  assert.equal(rc.filter((x) => x.status === 201).length, 2, JSON.stringify(rc.map((x) => x.status))); assert.equal(await used(A, lim.id), 2);
  assert.equal(await stockOf(A, plenty.id), 48, 'stock reserved for orders that lost the coupon race was given back');
});

test('owner orders: list/search/detail, isolation, lifecycle rules, payment, cancel restores stock + coupon exactly once', async () => {
  assert.equal((await api(null, `/stores/${A.sid}/orders`)).status, 401);
  assert.equal((await api(B, `/stores/${A.sid}/orders`)).status, 404); assert.equal((await api(B, `/stores/${A.sid}/orders/1001`, { method: 'PATCH', body: { status: 'cancelled' } })).status, 404);
  const bList = (await api(B, `/stores/${B.sid}/orders`)).json; assert.ok(bList.orders.every((o) => o.items.every((i) => i.title !== 'M5 Silk Saree')), 'store B never sees store A orders');
  const list = (await api(A, `/stores/${A.sid}/orders`)).json; assert.ok(list.total >= 3); assert.ok(!JSON.stringify(list).includes('publicToken'));
  assert.equal((await api(A, `/stores/${A.sid}/orders?q=1001`)).json.orders[0].orderNumber, 1001); assert.ok((await api(A, `/stores/${A.sid}/orders?q=Priya`)).json.total >= 3);
  assert.equal((await api(A, `/stores/${A.sid}/orders?status=shipped`)).json.total, 0); assert.equal((await api(A, `/stores/${A.sid}/orders?q[$ne]=x`)).status, 200);
  assert.equal((await api(A, `/stores/${A.sid}/orders/9999`)).status, 404); assert.equal((await api(A, `/stores/${A.sid}/orders/abc`)).status, 404);

  const p = `/stores/${A.sid}/orders/1001`, patch = (body) => api(A, p, { method: 'PATCH', body });
  assert.equal((await patch({ status: 'delivered' })).status, 400, 'pending cannot jump to delivered'); assert.equal((await patch({ status: 'bogus' })).status, 400);
  assert.equal((await patch({ paymentStatus: 'paid' })).json.order.paymentStatus, 'paid'); assert.equal((await patch({ status: 'confirmed' })).json.order.status, 'confirmed');
  const stockBefore = await stockOf(A, saree.id), usedBefore = await used(A, pctCoupon.id);
  const c1 = await patch({ status: 'cancelled' }); assert.equal(c1.status, 200); assert.equal(c1.json.order.status, 'cancelled'); assert.equal(c1.json.order.statusHistory.length, 3);
  assert.equal(await stockOf(A, saree.id), stockBefore + 2); assert.equal(await used(A, pctCoupon.id), usedBefore - 1);
  assert.equal((await patch({ status: 'cancelled' })).status, 200, 'repeating the same state is a no-op'); assert.equal((await patch({ status: 'confirmed' })).status, 400, 'a cancelled order cannot be reopened');
  assert.equal(await stockOf(A, saree.id), stockBefore + 2, 'cancelling twice does not restock twice'); assert.equal(await used(A, pctCoupon.id), usedBefore - 1);
  assert.equal((await patch({ paymentStatus: 'unpaid' })).status, 400);
  // two simultaneous cancels restock once
  const r = await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 3 }]) }); const n = r.json.order.orderNumber; const s0 = await stockOf(A, saree.id);
  const both = await Promise.all([api(A, `/stores/${A.sid}/orders/${n}`, { method: 'PATCH', body: { status: 'cancelled' } }), api(A, `/stores/${A.sid}/orders/${n}`, { method: 'PATCH', body: { status: 'cancelled' } })]);
  assert.ok(both.every((x) => [200, 409].includes(x.status))); assert.equal(await stockOf(A, saree.id), s0 + 3);
  // full happy path: pending -> confirmed -> shipped -> delivered; delivered and shipped orders cannot be cancelled
  const hp = (await pub(A, '/orders', { method: 'POST', body: checkout([{ productId: saree.id, qty: 1 }]) })).json.order.orderNumber, hpath = `/stores/${A.sid}/orders/${hp}`;
  for (const st of ['confirmed', 'shipped']) assert.equal((await api(A, hpath, { method: 'PATCH', body: { status: st } })).json.order.status, st);
  assert.equal((await api(A, hpath, { method: 'PATCH', body: { status: 'cancelled' } })).status, 400, 'shipped orders cannot be cancelled');
  const dl = await api(A, hpath, { method: 'PATCH', body: { status: 'delivered' } }); assert.equal(dl.json.order.status, 'delivered'); assert.deepEqual(dl.json.order.statusHistory.map((h) => h.status), ['pending', 'confirmed', 'shipped', 'delivered']);
});

test('tenant guard + cascade: unscoped Order/Coupon queries throw; deleting a store removes its orders and coupons', async () => {
  await assert.rejects(() => Order.find({}).exec(), /Tenant guard/); await assert.rejects(() => Coupon.findOne({ code: 'M5SAVE10' }).exec(), /Tenant guard/); await assert.rejects(() => Order.find({ store: { $ne: A.sid } }).exec(), /Tenant guard/);
  await assert.rejects(() => Counter.findOne({ key: 'order' }).exec(), /Tenant guard/);
  assert.ok(await Order.countDocuments({ store: B.sid }) >= 1 && await Coupon.countDocuments({ store: B.sid }) >= 1);
  const del = await api(B, `/stores/${B.sid}`, { method: 'DELETE', body: { confirmSlug: B.slug } }); assert.equal(del.status, 200);
  assert.equal(await Order.countDocuments({ store: B.sid }), 0); assert.equal(await Coupon.countDocuments({ store: B.sid }), 0); assert.equal(await Counter.countDocuments({ store: B.sid }), 0); assert.equal(await Product.countDocuments({ store: B.sid }), 0);
  assert.ok(await Order.countDocuments({ store: A.sid }) >= 3, "store A's data is untouched");
  assert.equal((await page(`/store/${B.slug}`)).status, 404);
});
