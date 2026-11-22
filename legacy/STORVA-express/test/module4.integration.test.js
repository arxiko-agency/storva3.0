'use strict';
// Module 4 against a REAL MongoDB:  MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const URI = process.env.MONGODB_URI;
if (!URI || !/test/i.test(URI)) { test('products integration', { skip: 'set MONGODB_URI to a database whose name contains "test"' }, () => {}); return; }
process.env.NODE_ENV = 'development'; process.env.JWT_SECRET = 'x'.repeat(40); process.env.OTP_PEPPER = 'y'.repeat(40);
process.env.APP_URL = 'http://localhost:3000'; process.env.MAX_STORES_PER_USER = '1'; process.env.MAX_PRODUCTS_PER_STORE = '5';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'storva-test-uploads-' + process.pid);
const crypto = require('crypto'); const fs = require('fs');
const { assertEnv, env } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');
const { createApp } = require('../src/app');
const User = require('../src/models/User'); const Store = require('../src/models/Store'); const Product = require('../src/models/Product'); const Collection = require('../src/models/Collection');
const { hashPassword } = require('../src/utils/password');

const rnd = () => crypto.randomBytes(4).toString('hex'); const PW = 'Passw0rd!x';
let server, base, A, B;
async function mkUser() { const email = `m4${rnd()}@example.com`; await User.create({ name: 'T', email, phone: '919' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), passwordHash: await hashPassword(PW), emailVerified: true }); return { email }; }
async function login(u) { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: PW }) }); assert.equal(r.status, 200); u.jar = r.headers.getSetCookie()[0].split(';')[0]; return u; }
const api = (u, path, { method = 'GET', body, raw, type } = {}) => fetch(base + '/api' + path, { method, headers: { ...(u && u.jar ? { cookie: u.jar } : {}), ...(raw ? { 'content-type': type } : body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

test.before(async () => {
  assertEnv(); await connectDb(URI); await Promise.all([Store.init(), Product.init(), Collection.init(), User.init()]);
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, n] of [['A', 'A'], ['B', 'B']]) {
    const u = await login(await mkUser()); const r = await api(u, '/stores', { method: 'POST', body: { name: `M4 ${n}`, slug: `m4t-${rnd()}`, whatsappNumber: '9876543210' } });
    assert.equal(r.status, 201); u.sid = r.json.store.id; if (k === 'A') A = u; else B = u;
  }
});
test.after(async () => { for (const u of [A, B]) if (u) await Store.deleteMany({ _id: u.sid }); await Product.deleteMany({}).setOptions({ skipTenant: true }).where({ title: /^M4/ }); await Collection.deleteMany({}).setOptions({ skipTenant: true }).where({ name: /^M4/ }); await User.deleteMany({ email: /^m4.*@example\.com$/ }); fs.rmSync(env.uploadDir, { recursive: true, force: true }); server.close(); await disconnectDb(); });
const P = (u) => `/stores/${u.sid}/products`, C = (u) => `/stores/${u.sid}/collections`;
let pa, col;

test('anonymous and other owners cannot reach product routes', async () => {
  assert.equal((await api(null, P(A))).status, 401);
  assert.equal((await api(B, P(A))).status, 404);
  assert.equal((await api(B, P(A), { method: 'POST', body: { title: 'M4 hack', price: 1 } })).status, 404);
  assert.equal(await Product.countDocuments({ store: A.sid }), 0);
});
test('create simple product; money stored as paise; store/images ignored from body', async () => {
  const r = await api(A, P(A), { method: 'POST', body: { title: 'M4 Silk Saree', price: 1499.5, stock: 4, category: 'Sarees', tags: ['Silk'], status: 'active', store: B.sid, images: [{ url: 'http://evil' }] } });
  assert.equal(r.status, 201); pa = r.json.product;
  assert.equal(pa.price, 1499.5); assert.equal(pa.slug, 'm4-silk-saree'); assert.deepEqual(pa.images, []);
  const doc = await Product.findOne({ _id: pa.id, store: A.sid }); assert.equal(doc.pricePaise, 149950); assert.equal(String(doc.store), A.sid);
});
test('duplicate titles get unique slugs; validation errors are 400', async () => {
  const r = await api(A, P(A), { method: 'POST', body: { title: 'M4 Silk Saree', price: 10 } }); assert.equal(r.json.product.slug, 'm4-silk-saree-2');
  assert.equal((await api(A, P(A), { method: 'POST', body: { title: 'M4 x', price: -5 } })).status, 400);
  assert.equal((await api(A, P(A), { method: 'POST', body: { title: { $ne: 1 }, price: 5 } })).status, 400);
});
test('variants: create, ids stay stable on edit, stock per variant', async () => {
  const body = { title: 'M4 Tee', price: 499, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ options: { Size: 'S' }, stock: 2 }, { options: { Size: 'M' }, stock: 5, price: 549 }] };
  const r = await api(A, P(A), { method: 'POST', body }); assert.equal(r.status, 201);
  const t = r.json.product; assert.equal(t.totalStock, 7); const sId = t.variants.find((v) => v.key === 'S').id;
  const u = await api(A, `${P(A)}/${t.id}`, { method: 'PATCH', body: { options: body.options, variants: [{ options: { Size: 'S' }, stock: 9 }, { options: { Size: 'M' }, stock: 5 }] } });
  assert.equal(u.status, 200); assert.equal(u.json.product.variants.find((v) => v.key === 'S').id, sId); assert.equal(u.json.product.totalStock, 14);
  assert.equal((await api(A, `${P(A)}/${t.id}`, { method: 'PATCH', body: { options: body.options, variants: [{ options: { Size: 'XL' } }] } })).status, 400);
  A.tee = u.json.product;
});
test('inventory: atomic set/adjust, never below zero', async () => {
  const s = (b) => api(A, `${P(A)}/${pa.id}/stock`, { method: 'PATCH', body: b });
  assert.equal((await s({ delta: -3 })).json.product.stock, 1);
  const r = await s({ delta: -5 }); assert.equal(r.status, 409); assert.equal(r.json.error.code, 'insufficient_stock');
  assert.equal((await s({ stock: 20 })).json.product.stock, 20); assert.equal((await s({ stock: 1, delta: 1 })).status, 400);
  const vid = A.tee.variants[0].id; const v = await api(A, `${P(A)}/${A.tee.id}/stock`, { method: 'PATCH', body: { variantId: vid, delta: -9 } });
  assert.equal(v.status, 200); assert.equal((await api(A, `${P(A)}/${A.tee.id}/stock`, { method: 'PATCH', body: { variantId: vid, delta: -1 } })).status, 409);
  // concurrency: 10 parallel -1 on stock 5 must leave exactly 0 and never negative
  await s({ stock: 5 }); const rs = await Promise.all(Array.from({ length: 10 }, () => s({ delta: -1 })));
  assert.equal(rs.filter((x) => x.status === 200).length, 5); assert.equal((await Product.findOne({ _id: pa.id, store: A.sid })).stock, 0);
  await s({ stock: 4 });
});
test('search, filter, sort, paginate', async () => {
  const q = async (qs) => (await api(A, `${P(A)}?${qs}`)).json;
  assert.ok((await q('q=saree')).products.every((p) => /saree/i.test(p.title)));
  assert.equal((await q('q=' + encodeURIComponent('.*'))).total, 0, 'regex chars are escaped');
  assert.ok((await q('category=Sarees')).total >= 1); assert.equal((await q('status=draft')).products.every((p) => p.status === 'draft'), true);
  const asc = (await q('sort=price_asc')).products.map((p) => p.price); assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.equal((await q('limit=1')).products.length, 1); assert.equal((await api(A, `${P(A)}?minPrice=abc`)).status, 400);
  assert.equal((await api(A, `${P(A)}?q[$ne]=x`)).status, 200);
});
test('categories list and rename', async () => {
  assert.deepEqual((await api(A, `${P(A)}/categories`)).json.categories, [{ name: 'Sarees', count: 1 }]);
  assert.equal((await api(A, `${P(A)}/categories/rename`, { method: 'POST', body: { from: 'Sarees', to: 'Silk Sarees' } })).json.updated, 1);
});
test('collections: CRUD, membership, only own products, counts', async () => {
  col = (await api(A, C(A), { method: 'POST', body: { name: 'M4 Festive' } })).json.collection; assert.equal(col.slug, 'm4-festive');
  assert.equal((await api(A, `${C(A)}/${col.id}/products`, { method: 'PUT', body: { productIds: [pa.id] } })).status, 200);
  const bProd = (await api(B, P(B), { method: 'POST', body: { title: 'M4 B item', price: 5 } })).json.product;
  assert.equal((await api(A, `${C(A)}/${col.id}/products`, { method: 'PUT', body: { productIds: [bProd.id] } })).status, 400, "cannot add another store's product");
  assert.equal((await api(A, `${P(A)}/${pa.id}`, { method: 'PATCH', body: { collections: [col.id] } })).status, 200);
  assert.equal((await api(A, C(A))).json.collections.find((c) => c.id === col.id).productCount, 1);
  assert.equal((await api(A, `${P(A)}?collection=${col.id}`)).json.total, 1);
  const bCol = (await api(B, C(B), { method: 'POST', body: { name: 'M4 B col' } })).json.collection;
  assert.equal((await api(A, `${P(A)}/${pa.id}`, { method: 'PATCH', body: { collections: [bCol.id] } })).status, 400, "cannot use another store's collection");
  B.prod = bProd;
});
test('ISOLATION: B cannot read, edit, stock-adjust, upload to or delete A\'s products/collections', async () => {
  for (const [method, path, body] of [['GET', `${P(A)}/${pa.id}`], ['PATCH', `${P(A)}/${pa.id}`, { title: 'HACK' }], ['PATCH', `${P(A)}/${pa.id}/stock`, { stock: 999 }], ['DELETE', `${P(A)}/${pa.id}`], ['GET', `${C(A)}/${col.id}`], ['DELETE', `${C(A)}/${col.id}`]]) {
    assert.equal((await api(B, path, { method, body })).status, 404, `${method} ${path}`);
  }
  // B using its OWN store id with A's product id must also fail
  assert.equal((await api(B, `${P(B)}/${pa.id}`)).status, 404); assert.equal((await api(B, `${P(B)}/${pa.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await api(B, P(B))).json.products.some((p) => p.id === pa.id), false);
  const d = await Product.findOne({ _id: pa.id, store: A.sid }); assert.equal(d.title, 'M4 Silk Saree'); assert.equal(d.stock, 4);
});
test('images: validated by content, stored under server names, deleted with product', async () => {
  const up = (u, p, buf, type = 'image/png') => api(u, `${P(u)}/${p}/images`, { method: 'POST', raw: buf, type });
  const ok = await up(A, pa.id, PNG); assert.equal(ok.status, 201);
  const img = ok.json.product.images[0]; assert.match(img.url, new RegExp(`^/uploads/${A.sid}/[a-f0-9]{32}\\.png$`));
  const file = require('path').join(env.uploadDir, A.sid, require('path').basename(img.url)); assert.ok(fs.existsSync(file));
  const served = await fetch(base + img.url); assert.equal(served.status, 200); assert.equal(served.headers.get('x-content-type-options'), 'nosniff'); assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await up(A, pa.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status, 415, 'SVG with png header rejected');
  assert.equal((await up(A, pa.id, Buffer.from('<?php echo 1; ?>padpadpad'), 'image/jpeg')).status, 415);
  assert.equal((await up(A, pa.id, PNG, 'text/html')).status, 415);
  assert.equal((await up(B, pa.id, PNG)).status, 404);
  assert.equal((await api(B, `${P(B)}/${pa.id}/images/${img.id}`, { method: 'DELETE' })).status, 404); assert.ok(fs.existsSync(file));
  const del = await api(A, `${P(A)}/${pa.id}/images/${img.id}`, { method: 'DELETE' }); assert.equal(del.status, 200); assert.ok(!fs.existsSync(file));
  for (let i = 0; i < 8; i++) assert.equal((await up(A, pa.id, PNG)).status, 201);
  assert.equal((await up(A, pa.id, PNG)).status, 400, 'max 8 images');
});
test('product limit per store is enforced', async () => {
  let last; for (let i = 0; i < 5; i++) last = await api(A, P(A), { method: 'POST', body: { title: `M4 fill ${i}`, price: 1 } });
  assert.equal(last.status, 403); assert.equal(last.json.error.code, 'product_limit');
});
test('deleting a store removes its products, collections and image files', async () => {
  const dir = require('path').join(env.uploadDir, B.sid); await api(B, `${P(B)}/${B.prod.id}/images`, { method: 'POST', raw: PNG, type: 'image/png' }); assert.ok(fs.existsSync(dir));
  const s = await Store.findById(B.sid); const r = await api(B, `/stores/${B.sid}`, { method: 'DELETE', body: { confirmSlug: s.slug } }); assert.equal(r.status, 200);
  assert.equal(await Product.countDocuments({ store: B.sid }), 0); assert.equal(await Collection.countDocuments({ store: B.sid }), 0); assert.ok(!fs.existsSync(dir));
  assert.equal(await Product.countDocuments({ store: A.sid }) > 0, true, "A's data untouched");
});
test('deleting products and collections', async () => {
  assert.equal((await api(A, `${C(A)}/${col.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await Product.findOne({ _id: pa.id, store: A.sid })).collections, []);
  assert.equal((await api(A, `${P(A)}/${pa.id}`, { method: 'DELETE' })).status, 200); assert.equal((await api(A, `${P(A)}/${pa.id}`)).status, 404);
});
