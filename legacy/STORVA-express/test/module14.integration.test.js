'use strict';
// Module 14 analytics against a REAL MongoDB: cookie-less visitor counting (distinct, bots ignored, sources), funnel steps,
// sales maths (cancelled + unpaid online excluded, refunds subtracted), plan tiers, CSV exports, GST filing summary, isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 14'); return; }
const events = require('../src/services/events');
test.before(H.start); test.after(H.stop);
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36';
const visit = (path, ip, extra = {}) => H.page(path, { headers: { 'user-agent': UA, 'x-forwarded-for': ip, ...extra } });
const settle = () => new Promise((r) => setTimeout(r, 250));
let ADV, PRO, FREE, p1, p2;

test('setup', async () => {
  ADV = await H.owner({ plan: 'advanced' }); PRO = await H.owner({ plan: 'pro' }); FREE = await H.owner();
  p1 = await H.product(ADV, { title: 'Saree', price: 2000, stock: 50 }); p2 = await H.product(ADV, { title: 'Bangle', price: 500, stock: 50 });
});

test('visitors: distinct per day, bots and link previews ignored, sources, funnel steps', async () => {
  await visit(`/store/${ADV.slug}`, '10.0.0.1', { referer: 'https://l.instagram.com/' });
  await visit(`/store/${ADV.slug}/product/${p1.slug}`, '10.0.0.1', { referer: `http://127.0.0.1/store/${ADV.slug}` });
  await visit(`/store/${ADV.slug}/product/${p1.slug}`, '10.0.0.1');
  await visit(`/store/${ADV.slug}?ref=wa`, '10.0.0.2');
  await visit(`/store/${ADV.slug}/product/${p2.slug}?ref=qr`, '10.0.0.3');
  await visit(`/store/${ADV.slug}/checkout`, '10.0.0.3');
  await H.page(`/store/${ADV.slug}`, { headers: { 'user-agent': 'WhatsApp/2.23.20.0 A', 'x-forwarded-for': '10.0.0.9' } });
  await H.page(`/store/${ADV.slug}`, { headers: { 'user-agent': 'facebookexternalhit/1.1', 'x-forwarded-for': '10.0.0.8' } });
  await H.page(`/store/${ADV.slug}`, { headers: { 'user-agent': UA, 'x-forwarded-for': '10.0.0.7', 'sec-purpose': 'prefetch' } });
  for (let i = 0; i < 2; i++) await H.pub(ADV, '/events', { method: 'POST', body: { type: 'cart_add', productId: p1.id }, headers: { 'user-agent': UA, 'x-forwarded-for': '10.0.0.3' } });
  assert.equal((await H.pub(ADV, '/events', { method: 'POST', body: { type: 'nonsense' } })).status, 204);
  await settle();
  const r = await H.api(ADV, `/stores/${ADV.sid}/analytics?days=7`);
  assert.equal(r.status, 200); const d = r.json;
  assert.equal(d.summary.visitors, 3, 'three people; bots/previews/prefetch not counted'); assert.equal(d.summary.pageViews, 6);
  const src = Object.fromEntries(d.sources.map((s) => [s.source, s.visitors]));
  assert.deepEqual(src, { instagram: 1, whatsapp: 1, qr: 1 });
  const f = Object.fromEntries(d.funnel.map((s) => [s.step, s.count]));
  assert.equal(f['Visited the store'], 3); assert.equal(f['Viewed a product'], 2); assert.equal(f['Added to cart'], 1); assert.equal(f['Reached checkout'], 1);
  const pc = d.productConversion.find((x) => x.title === 'Saree'); assert.equal(pc.views, 2);
  assert.equal(d.daily.length, 7); assert.equal(d.daily[6].visitors, 3);
});

test('sales maths: cancelled and unpaid online orders excluded, refunds subtracted, previous period, breakdowns', async () => {
  const a = await H.order(ADV, [{ productId: p1.id, qty: 1 }]);                           // 2000
  const b = await H.order(ADV, [{ productId: p2.id, qty: 2 }], { phone: '9811100000' });   // 1000
  const c = await H.order(ADV, [{ productId: p2.id, qty: 1 }], { phone: '9822200000' });   // 500, cancelled below
  await H.api(ADV, `/stores/${ADV.sid}/orders/${c.order.orderNumber}`, { method: 'PATCH', body: { status: 'cancelled' } });
  const Order = require('../src/models/Order');
  await Order.updateOne({ store: ADV.sid, orderNumber: b.order.orderNumber }, { $set: { refundedPaise: 25000 } }).setOptions({ skipTenant: true });
  // an abandoned online payment: must not count
  await Order.create({ store: ADV.sid, orderNumber: 99001, publicToken: 'f'.repeat(32), status: 'pending', paymentMethod: 'razorpay', paymentStatus: 'pending', customer: { name: 'X', phone: '919800000000' }, shipping: H.ADDR, items: [{ product: p1.id, title: 'Saree', qty: 1, unitPricePaise: 200000, lineTotalPaise: 200000 }], subtotalPaise: 200000, totalPaise: 200000 });
  // last month's order for the comparison
  await Order.create({ store: ADV.sid, orderNumber: 99002, publicToken: 'e'.repeat(32), status: 'delivered', paymentMethod: 'cod', paymentStatus: 'paid', customer: { name: 'Old', phone: '919876543210' }, shipping: H.ADDR, items: [{ product: p1.id, title: 'Saree', qty: 1, unitPricePaise: 100000, lineTotalPaise: 100000 }], subtotalPaise: 100000, totalPaise: 100000, createdAt: new Date(Date.now() - 10 * 864e5) });
  await events.drain();
  const d = (await H.api(ADV, `/stores/${ADV.sid}/analytics?days=7`)).json;
  assert.equal(d.summary.orders, 2); assert.equal(d.summary.grossSales, 3000); assert.equal(d.summary.refunds, 250); assert.equal(d.summary.netSales, 2750); assert.equal(d.summary.averageOrder, 1500); assert.equal(d.summary.itemsSold, 3);
  assert.equal(d.previous.orders, 1); assert.equal(d.previous.netSales, 1000); assert.equal(d.change.orders, 100); assert.equal(d.change.netSales, 175);
  assert.equal(d.daily[6].orders, 2); assert.equal(d.daily[6].netSales, 2750);
  assert.equal(d.topProducts[0].title, 'Saree'); assert.equal(d.topProducts[0].revenue, 2000); assert.equal(d.topProducts[1].units, 2);
  assert.equal(d.payments.find((p) => p.method === 'cod').orders, 2); assert.equal(d.statuses.cancelled, 1); assert.equal(d.statuses.pending, 3);
  assert.equal(d.customers.returning.customers, 1, '9876543210 ordered 10 days ago'); assert.equal(d.customers.new.customers, 1);
  assert.equal(d.conversionRate, undefined); assert.equal(d.summary.conversionRate, 66.7);
  assert.equal(d.states[0].state, 'Kerala'); assert.equal(d.hours.length, 7); assert.equal(d.hours.flat().reduce((x, y) => x + y, 0), 2);
  void a;
});

test('plan tiers: Free gets the overview only, Pro gets reports + exports, Advanced gets funnel + GST', async () => {
  let r = await H.api(FREE, `/stores/${FREE.sid}/analytics`);
  assert.equal(r.status, 200); assert.deepEqual(r.json.locked, ['basic', 'advanced']); assert.equal(r.json.topProducts, undefined); assert.equal(r.json.funnel, undefined);
  r = await H.api(FREE, `/stores/${FREE.sid}/analytics?days=90`); assert.equal(r.status, 402); assert.equal(r.json.error.code, 'upgrade_required');
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/analytics/export/orders.csv`)).status, 402);
  r = await H.api(PRO, `/stores/${PRO.sid}/analytics?days=90`); assert.equal(r.status, 200); assert.deepEqual(r.json.locked, ['advanced']); assert.ok(Array.isArray(r.json.topProducts));
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/analytics/gst`)).status, 402);
  assert.equal((await H.api(PRO, `/stores/${ADV.sid}/analytics`)).status, 404, 'other owners cannot read a store\'s analytics');
  assert.equal((await H.api(ADV, `/stores/${ADV.sid}/analytics?from=2026-05-10&to=2026-05-01`)).status, 400);
});

test('CSV exports: orders and product sales', async () => {
  const r = await H.api(ADV, `/stores/${ADV.sid}/analytics/export/orders.csv?days=7`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /orders-it-.*\.csv/);
  const lines = r.text.replace(/^\uFEFF/, '').trim().split('\r\n'); assert.ok(lines[0].startsWith('Order,Date (IST),Status')); assert.equal(lines.length, 1 + 4, 'all orders in range incl. cancelled + unpaid, for bookkeeping');
  assert.ok(lines.some((l) => l.includes('cancelled')) && lines.some((l) => l.includes('+919811100000')));
  const p = await H.api(ADV, `/stores/${ADV.sid}/analytics/export/products.csv?days=7`);
  const pl = p.text.replace(/^\uFEFF/, '').trim().split('\r\n'); assert.equal(pl[0], 'Product,Variant,SKU,Orders,Units sold,Revenue,GST in revenue,Average price'); assert.ok(pl[1].startsWith('Saree,,,1,1,2000'));
});

test('GST filing summary: B2B with buyer GSTIN, B2C by state + rate, HSN, cancelled invoices counted', async () => {
  const I = require('../src/utils/india'); const g = '32AAPFU0939F1Z'; const GSTIN = g + I.gstinCheckChar(g);
  await H.api(ADV, `/stores/${ADV.sid}/shipping`, { method: 'PUT', body: { tax: { enabled: true, gstin: GSTIN, legalName: 'Adv Traders', defaultRate: 5, pricesIncludeTax: true } } });
  await H.api(ADV, `/stores/${ADV.sid}/products/${p1.id}`, { method: 'PATCH', body: { hsn: '5007' } });
  const b2b = await H.order(ADV, [{ productId: p1.id, qty: 1 }], { phone: '9833300000', gstin: '27AAPFU0939F1ZV' });
  const b2c = await H.order(ADV, [{ productId: p2.id, qty: 2 }], { phone: '9844400000', address: { ...H.ADDR, state: 'Tamil Nadu', city: 'Chennai', pincode: '600001' } });
  const gone = await H.order(ADV, [{ productId: p2.id, qty: 1 }], { phone: '9855500000' });
  for (const o of [b2b, b2c, gone]) { await H.api(ADV, `/stores/${ADV.sid}/orders/${o.order.orderNumber}`, { method: 'PATCH', body: { status: 'confirmed' } }); await H.api(ADV, `/stores/${ADV.sid}/orders/${o.order.orderNumber}/invoice`, { method: 'POST' }); }
  await H.api(ADV, `/stores/${ADV.sid}/orders/${gone.order.orderNumber}`, { method: 'PATCH', body: { status: 'cancelled' } });
  const r = await H.api(ADV, `/stores/${ADV.sid}/analytics/gst?days=7`); assert.equal(r.status, 200); const x = r.json;
  assert.equal(x.documents.issued, 3); assert.equal(x.documents.cancelled, 1); assert.equal(x.gstin, GSTIN);
  assert.equal(x.b2b.length, 1); assert.equal(x.b2b[0].gstin, '27AAPFU0939F1ZV'); assert.equal(x.b2b[0].rate, 5); assert.equal(x.b2b[0].taxable, 1904.76); assert.equal(x.b2b[0].cgst + x.b2b[0].sgst, 95.24); assert.equal(x.b2b[0].placeOfSupply, '32-Kerala');
  const tn = x.b2c.find((y) => y.placeOfSupply === '33-Tamil Nadu'); assert.equal(tn.igst, 47.62); assert.equal(tn.cgst, 0);
  assert.ok(x.hsn.find((h) => h.hsn === '5007' && h.qty === 1));
  const csv = await H.api(ADV, `/stores/${ADV.sid}/analytics/gst/b2b.csv?days=7`); assert.equal(csv.status, 200); assert.ok(csv.text.includes('27AAPFU0939F1ZV'));
  assert.equal((await H.api(ADV, `/stores/${ADV.sid}/analytics/gst/other.csv`)).status, 404);
});
