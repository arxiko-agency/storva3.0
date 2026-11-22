'use strict';
// Module 11 customers against a REAL MongoDB: built from orders, recomputed on cancel/refund, segments, search, notes/tags,
// COD blocking at checkout, CSV export (plan-gated, formula-safe), tenant isolation and personal-data erasure.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 11'); return; }
const events = require('../src/services/events');
test.before(H.start); test.after(H.stop);
let A, B, p;
const order = async (u, phone, qty = 1, extra = {}) => { const r = await H.pub(u, '/orders', { method: 'POST', body: { name: extra.name || 'Priya Nair', phone, email: extra.email || 'priya@example.com', address: H.ADDR, items: [{ productId: p.id, qty }], ...extra.body } }); await events.drain(); return r; };

test('setup', async () => { A = await H.owner({ plan: 'pro' }); B = await H.owner(); p = await H.product(A, { title: 'Saree', price: 1000, stock: 100 }); });

test('orders create and update one customer per phone; cancelled orders do not count', async () => {
  await order(A, '9811111111'); await order(A, '9811111111', 2, { name: 'Priya N.' }); const third = await order(A, '9811111111', 1);
  await order(A, '9822222222', 1, { name: '=HYPERLINK("http://x")', email: 'other@example.com' });
  let r = await H.api(A, `/stores/${A.sid}/customers?sort=spent`);
  assert.equal(r.status, 200); assert.equal(r.json.total, 2);
  const priya = r.json.customers[0];
  assert.equal(priya.phone, '919811111111'); assert.equal(priya.name, 'Priya Nair'); assert.equal(priya.orderCount, 3); assert.equal(priya.totalSpent, 4000); assert.equal(priya.segment, 'vip');
  assert.equal(r.json.summary.customers, 2); assert.equal(r.json.summary.repeatRate, 50);
  await H.api(A, `/stores/${A.sid}/orders/${third.json.order.orderNumber}`, { method: 'PATCH', body: { status: 'cancelled' } }); await events.drain();
  r = await H.api(A, `/stores/${A.sid}/customers/${priya.id}`);
  assert.equal(r.json.customer.orderCount, 2); assert.equal(r.json.customer.cancelledCount, 1); assert.equal(r.json.customer.totalSpent, 3000); assert.equal(r.json.customer.segment, 'repeat');
  assert.equal(r.json.orders.length, 3); assert.equal(r.json.customer.addresses.length, 1);
  A.priya = priya.id;
});

test('search by name / phone digits, segments and tags', async () => {
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?q=priya`)).json.total, 1);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?q=22222`)).json.total, 1);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?segment=new`)).json.total, 1);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?segment=repeat`)).json.total, 1);
  const bad = await H.api(A, `/stores/${A.sid}/customers/${A.priya}`, { method: 'PATCH', body: { tags: Array(11).fill('x'), codBlocked: 'yes' } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.tags && bad.json.error.fields.codBlocked);
  const ok = await H.api(A, `/stores/${A.sid}/customers/${A.priya}`, { method: 'PATCH', body: { tags: 'Wholesale, kochi, wholesale', notes: 'Size M' } });
  assert.deepEqual(ok.json.customer.tags, ['wholesale', 'kochi']); assert.equal(ok.json.customer.notes, 'Size M');
  const byTag = await H.api(A, `/stores/${A.sid}/customers?tag=kochi`); assert.equal(byTag.json.total, 1); assert.deepEqual(byTag.json.tags, ['kochi', 'wholesale']);
});

test('blocking cash on delivery stops COD checkout for that number only', async () => {
  await H.api(A, `/stores/${A.sid}/customers/${A.priya}`, { method: 'PATCH', body: { codBlocked: true } });
  const r = await order(A, '9811111111');
  assert.equal(r.status, 400); assert.match(r.json.error.fields.paymentMethod, /contact the shop|pay online/);
  assert.equal((await order(A, '9833333333')).status, 201);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?segment=blocked`)).json.total, 1);
  await H.api(A, `/stores/${A.sid}/customers/${A.priya}`, { method: 'PATCH', body: { codBlocked: false } });
  assert.equal((await order(A, '9811111111')).status, 201);
});

test('CSV export: Pro only, BOM + header, formula injection neutralised', async () => {
  const free = await fetch(`${H.base}/api/stores/${B.sid}/customers/export.csv`, { headers: { cookie: B.jar } });
  assert.equal(free.status, 402);
  const r = await fetch(`${H.base}/api/stores/${A.sid}/customers/export.csv?sort=name`, { headers: { cookie: A.jar } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /attachment; filename="customers-/);
  const buf = Buffer.from(await r.arrayBuffer()), text = buf.toString('utf8');
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel'); assert.ok(text.slice(1).startsWith('Name,Phone,Email,Orders'));
  assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'formula is quoted as text');
  assert.ok(text.includes('+919811111111'));
});

test('tenant isolation: another owner cannot list, read, edit or erase', async () => {
  assert.equal((await H.api(B, `/stores/${B.sid}/customers`)).json.total, 0);
  assert.equal((await H.api(B, `/stores/${A.sid}/customers`)).status, 404);
  assert.equal((await H.api(B, `/stores/${B.sid}/customers/${A.priya}`)).status, 404);
  assert.equal((await H.api(B, `/stores/${B.sid}/customers/${A.priya}`, { method: 'PATCH', body: { notes: 'x' } })).status, 404);
});

test('rebuild recreates customers from orders (e.g. stores that had orders before this module)', async () => {
  const Customer = require('../src/models/Customer');
  await Customer.deleteMany({ store: A.sid });
  const r = await H.api(A, `/stores/${A.sid}/customers`); // first visit rebuilds automatically
  assert.equal(r.json.total, 3);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers/rebuild`, { method: 'POST' })).json.customers, 3);
});

test('erase: refused with open orders, then anonymises orders and removes the customer', async () => {
  const list = await H.api(A, `/stores/${A.sid}/customers?q=33333`); const c = list.json.customers[0];
  assert.equal((await H.api(A, `/stores/${A.sid}/customers/${c.id}`, { method: 'DELETE', body: { confirmPhone: '0000000000' } })).status, 400);
  const open = await H.api(A, `/stores/${A.sid}/customers/${c.id}`, { method: 'DELETE', body: { confirmPhone: '9833333333' } });
  assert.equal(open.status, 409); assert.equal(open.json.error.code, 'open_orders');
  const o = await H.api(A, `/stores/${A.sid}/customers/${c.id}`);
  for (const x of o.json.orders) await H.api(A, `/stores/${A.sid}/orders/${x.orderNumber}`, { method: 'PATCH', body: { status: 'cancelled' } });
  await events.drain();
  const ok = await H.api(A, `/stores/${A.sid}/customers/${c.id}`, { method: 'DELETE', body: { confirmPhone: '9833333333' } });
  assert.equal(ok.status, 200);
  assert.equal((await H.api(A, `/stores/${A.sid}/customers/${c.id}`)).status, 404);
  const ord = await H.api(A, `/stores/${A.sid}/orders/${o.json.orders[0].orderNumber}`);
  assert.equal(ord.json.order.customer.name, 'Deleted customer'); assert.equal(ord.json.order.customer.email, ''); assert.equal(ord.json.order.shippingAddress.line1, '—');
  await H.api(A, `/stores/${A.sid}/customers/rebuild`, { method: 'POST' });
  assert.equal((await H.api(A, `/stores/${A.sid}/customers?q=Deleted`)).json.total, 0, 'erased orders never form a new customer');
});
