'use strict';
// Module 12 shipping, COD and GST against a REAL MongoDB: settings validation, quotes by state/PIN, placing orders with region
// charges + COD fee + GST snapshot, COD rules, unserviceable PIN codes, invoice numbering on shipping (one number even under
// parallel requests, sequential per financial year), owner + buyer invoice pages, tenant isolation.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 12'); return; }
const I = require('../src/utils/india');
const events = require('../src/services/events');
test.before(H.start); test.after(H.stop);
let A, B, kurta, ring;
const GSTIN = '32AAPFU0939F1Z' + I.gstinCheckChar('32AAPFU0939F1Z');
const put = (u, body) => H.api(u, `/stores/${u.sid}/shipping`, { method: 'PUT', body });
const items = () => [{ productId: kurta.id, qty: 1 }, { productId: ring.id, qty: 1 }];
const quote = (u, body) => H.pub(u, '/cart/quote', { method: 'POST', body: { items: items(), ...body } }).then((r) => r.json);
const buy = (u, extra = {}) => H.pub(u, '/orders', { method: 'POST', body: { name: 'Asha Menon', phone: extra.phone || '9876500000', email: 'asha@example.com', address: { ...H.ADDR, ...(extra.address || {}) }, items: extra.items || items(), paymentMethod: extra.paymentMethod || 'cod', ...(extra.gstin ? { gstin: extra.gstin } : {}) } });
const patch = (u, n, body) => H.api(u, `/stores/${u.sid}/orders/${n}`, { method: 'PATCH', body });
const ZONES = [{ name: 'Kerala', states: ['kerala'], rate: 40, freeAbove: 3000, etaDays: '1-3' }, { name: 'South', states: ['Tamil Nadu', 'Karnataka'], rate: 60, etaDays: '3-5' }, { name: 'Rest of India', states: [], rate: 90, codAvailable: false }];

test('setup: products with their own GST rate and HSN code', async () => {
  A = await H.owner({ plan: 'pro' }); B = await H.owner();
  kurta = await H.product(A, { title: 'Kurta', price: 1050, stock: 50 });
  ring = await H.product(A, { title: 'Silver ring', price: 1180, stock: 50 });
  const r = await H.api(A, `/stores/${A.sid}/products/${ring.id}`, { method: 'PATCH', body: { gstRate: 18, hsn: '7113' } });
  assert.equal(r.status, 200); assert.equal(r.json.product.gstRate, 18); assert.equal(r.json.product.hsn, '7113');
  const bad = await H.api(A, `/stores/${A.sid}/products/${ring.id}`, { method: 'PATCH', body: { gstRate: 7, hsn: '12' } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.gstRate && bad.json.error.fields.hsn);
});

test('settings: defaults, validation, saving regions / COD / GST, tenant isolation', async () => {
  let r = await H.api(A, `/stores/${A.sid}/shipping`);
  assert.equal(r.status, 200); assert.equal(r.json.shipping.mode, 'free'); assert.equal(r.json.tax.enabled, false); assert.ok(r.json.states.includes('Kerala')); assert.ok(r.json.gstRates.includes(18));
  r = await put(A, { shipping: { mode: 'zones', zones: [{ name: 'A', states: ['Kerala'], rate: 40 }, { name: 'B', states: ['Kerala'], rate: 60 }], blockedPincodes: 'abc' }, tax: { enabled: true, gstin: '27AAPFU0939F1ZX' } });
  assert.equal(r.status, 400); const f = Object.keys(r.json.error.fields);
  assert.ok(f.some((k) => /zones/.test(k)) && f.includes('tax.gstin') && f.includes('shipping.blockedPincodes'), f.join());
  r = await put(A, { tax: { enabled: true, gstin: GSTIN } }); assert.equal(r.status, 400); assert.ok(r.json.error.fields['tax.legalName'], 'legal name required with GST');
  r = await put(A, { shipping: { mode: 'zones', blockedPincodes: '744, 194101', zones: ZONES, cod: { enabled: true, fee: 30, maxOrder: 5000 } },
    tax: { enabled: true, gstin: GSTIN.toLowerCase(), legalName: 'Asha Crafts LLP', address: 'MG Road, Kochi', defaultRate: 5, pricesIncludeTax: true, shippingTaxable: true, invoicePrefix: 'ac' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.shipping.zones.length, 3); assert.deepEqual(r.json.shipping.zones[0].states, ['Kerala']); assert.deepEqual(r.json.shipping.blockedPincodes, ['744', '194101']);
  assert.equal(r.json.tax.gstin, GSTIN); assert.equal(r.json.tax.state, 'Kerala', 'state comes from the GSTIN'); assert.equal(r.json.tax.invoicePrefix, 'AC'); assert.equal(r.json.shipping.cod.fee, 30);
  assert.equal((await H.api(B, `/stores/${A.sid}/shipping`)).status, 404, 'another owner cannot read them');
  assert.equal((await H.api(B, `/stores/${A.sid}/shipping`, { method: 'PUT', body: { shipping: { mode: 'free' } } })).status, 404);
  const pv = await H.api(A, `/stores/${A.sid}/shipping/preview`, { method: 'POST', body: { subtotal: 1000, state: 'Tamil Nadu', paymentMethod: 'cod' } });
  assert.equal(pv.json.zone, 'South'); assert.equal(pv.json.shipping, 60); assert.equal(pv.json.codFee, 30); assert.ok(pv.json.taxBreakdown.igst > 0);
});

test('quote: from-price without address; region + COD fee + GST with address', async () => {
  let q = await quote(A, {});
  assert.equal(q.needsAddress, true); assert.equal(q.shippingFrom, 40); assert.equal(q.canCheckout, true); assert.equal(q.total, 2230);
  q = await quote(A, { address: { state: 'Kerala', pincode: '682001' }, paymentMethod: 'cod' });
  assert.equal(q.zone, 'Kerala'); assert.equal(q.etaDays, '1-3'); assert.equal(q.freeShippingAbove, 3000); assert.equal(q.shipping, 40); assert.equal(q.codFee, 30); assert.equal(q.total, 2300);
  assert.equal(q.taxInclusive, true); assert.equal(q.tax, 240.68, 'kurta 5% incl 50 + ring 18% incl 180 + fees ₹70 at 18% incl 10.68');
  assert.equal(q.taxBreakdown.cgst + q.taxBreakdown.sgst, 240.68); assert.equal(q.taxBreakdown.igst, 0);
  q = await quote(A, { address: { state: 'tamil nadu' }, paymentMethod: 'razorpay' });
  assert.equal(q.shipping, 60); assert.equal(q.codFee, 0); assert.equal(q.total, 2290); assert.ok(q.taxBreakdown.igst > 0 && !q.taxBreakdown.cgst);
  q = await quote(A, { address: { state: 'Punjab' }, paymentMethod: 'cod' }); assert.equal(q.cod.available, false); assert.match(q.cod.reason, /not available/i);
  q = await quote(A, { address: { state: 'Andaman and Nicobar Islands', pincode: '744101' } }); assert.equal(q.serviceable, false); assert.equal(q.canCheckout, false);
  q = await quote(A, { items: [{ productId: kurta.id, qty: 3 }], address: { state: 'Kerala' } }); assert.equal(q.shipping, 0, '₹3150 ≥ free-delivery threshold');
  q = await quote(A, { items: [{ productId: kurta.id, qty: 5 }], address: { state: 'Kerala' }, paymentMethod: 'cod' }); assert.equal(q.cod.available, false, '₹5250 > COD limit');
});

test('placing orders: charges and the GST snapshot are stored; COD and PIN rules are enforced', async () => {
  let r = await buy(A, { gstin: '27AAPFU0939F1ZV' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const o = r.json.order;
  assert.equal(o.total, 2300); assert.equal(o.shipping, 40); assert.equal(o.codFee, 30); assert.equal(o.tax, 240.68); assert.equal(o.shippingZone, 'Kerala'); assert.equal(o.buyerGstin, '27AAPFU0939F1ZV');
  assert.equal(o.items.find((i) => i.title === 'Silver ring').taxRate, 18); assert.equal(o.items.find((i) => i.title === 'Silver ring').hsn, '7113');
  A.n1 = o.orderNumber;
  r = await buy(A, { gstin: '27AAPFU0939F1ZX' }); assert.equal(r.status, 400); assert.ok(r.json.error.fields.gstin);
  r = await buy(A, { address: { state: 'Punjab', city: 'Ludhiana', pincode: '141001' } }); assert.equal(r.status, 400); assert.match(r.json.error.fields.paymentMethod, /not available/i);
  r = await buy(A, { address: { state: 'Andaman and Nicobar Islands', city: 'Port Blair', pincode: '744101' } }); assert.equal(r.status, 400); assert.ok(r.json.error.fields.pincode);
  r = await buy(A, { address: { state: 'Atlantis' } }); assert.equal(r.status, 400); assert.ok(r.json.error.fields.state);
  r = await buy(A, { address: { state: 'Karnataka', city: 'Bengaluru', pincode: '560001' }, phone: '9876511111' }); assert.equal(r.status, 201); assert.equal(r.json.order.total, 2230 + 60 + 30); assert.ok(r.json.order.taxBreakdown.igst > 0); A.n2 = r.json.order.orderNumber;
});

test('invoice: created on shipping, one number under parallel requests, sequential, owner + buyer pages', async () => {
  let r = await H.api(A, `/stores/${A.sid}/orders/${A.n1}/invoice`); assert.equal(r.status, 404, 'no invoice before shipping');
  r = await H.api(A, `/stores/${A.sid}/orders/${A.n1}/invoice`, { method: 'POST' }); assert.equal(r.status, 400, 'pending orders must be confirmed first');
  await patch(A, A.n1, { status: 'confirmed' }); await patch(A, A.n2, { status: 'confirmed' });
  const all = await Promise.all(Array.from({ length: 6 }, () => H.api(A, `/stores/${A.sid}/orders/${A.n2}/invoice`, { method: 'POST' })));
  const nums = new Set(all.filter((x) => x.status === 200).map((x) => x.json.order.invoiceNumber)); assert.equal(nums.size, 1, [...nums].join());
  const fy = I.financialYear(new Date()); assert.equal([...nums][0], `AC/${fy}/00001`);
  r = await patch(A, A.n1, { status: 'shipped' }); assert.equal(r.status, 200); await events.drain();
  r = await H.api(A, `/stores/${A.sid}/orders/${A.n1}`); assert.equal(r.json.order.invoiceNumber, `AC/${fy}/00002`, 'shipping assigns the next number, no gap');
  const page = await fetch(`${H.base}/api/stores/${A.sid}/orders/${A.n1}/invoice`, { headers: { cookie: A.jar } }); const html = await page.text();
  assert.equal(page.status, 200); assert.ok(html.includes('Tax invoice') && html.includes(GSTIN) && html.includes('Asha Crafts LLP') && html.includes('7113') && html.includes('CGST') && html.includes('27AAPFU0939F1ZV') && html.includes('Kerala (32)') && html.includes('Rupees Two Thousand Three Hundred Only'));
  assert.equal((await fetch(`${H.base}/api/stores/${A.sid}/orders/${A.n1}/invoice`, { headers: { cookie: B.jar } })).status, 404, 'other owners cannot open it');
  // buyer: same token as the order page
  const Order = require('../src/models/Order'); const doc = await Order.findOne({ store: A.sid, orderNumber: A.n1 }).setOptions({ skipTenant: true });
  const buyer = await fetch(`${H.base}/store/${A.slug}/order/${A.n1}/invoice?t=${doc.publicToken}`); assert.equal(buyer.status, 200); assert.ok((await buyer.text()).includes(`AC/${fy}/00002`));
  assert.equal((await fetch(`${H.base}/store/${A.slug}/order/${A.n1}/invoice?t=${'0'.repeat(32)}`)).status, 404);
  const orderPage = await (await fetch(`${H.base}/store/${A.slug}/order/${A.n1}?t=${doc.publicToken}`)).text(); assert.ok(orderPage.includes('Download invoice') && orderPage.includes('Cash on delivery fee'));
  // a cancelled order keeps its number (no reuse) and the invoice shows CANCELLED
  await patch(A, A.n2, { status: 'cancelled' });
  const voided = await (await fetch(`${H.base}/api/stores/${A.sid}/orders/${A.n2}/invoice`, { headers: { cookie: A.jar } })).text(); assert.ok(voided.includes('CANCELLED') && voided.includes(`AC/${fy}/00001`));
});

test('stores without GST keep working: plain invoice, no tax fields', async () => {
  const p = await H.product(B, { title: 'Mug', price: 300, stock: 5 });
  await put(B, { shipping: { mode: 'flat', flatRate: 50, freeAbove: 500 } });
  let r = await H.pub(B, '/orders', { method: 'POST', body: { name: 'Ravi', phone: '9800000001', address: H.ADDR, items: [{ productId: p.id, qty: 1 }] } });
  assert.equal(r.status, 201); assert.equal(r.json.order.total, 350); assert.equal(r.json.order.tax, 0); assert.equal(r.json.order.taxBreakdown, null);
  await patch(B, r.json.order.orderNumber, { status: 'confirmed' }); await patch(B, r.json.order.orderNumber, { status: 'shipped' });
  const html = await (await fetch(`${H.base}/api/stores/${B.sid}/orders/${r.json.order.orderNumber}/invoice`, { headers: { cookie: B.jar } })).text();
  assert.ok(html.includes('<h2>Invoice</h2>') && !html.includes('GSTIN') && html.includes('INV/'));
});
