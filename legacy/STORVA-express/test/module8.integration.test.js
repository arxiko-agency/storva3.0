'use strict';
// Module 8 plans + billing against a REAL MongoDB. Razorpay's order API is stubbed; signatures and webhooks are computed with a test secret.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.RAZORPAY_KEY_ID = 'rzp_test_STORVAm8key'; process.env.RAZORPAY_KEY_SECRET = 'm8_secret_' + 'k'.repeat(20); process.env.RAZORPAY_WEBHOOK_SECRET = 'm8_whsec_' + 'w'.repeat(20);
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 8'); return; }
const gateway = require('../src/services/razorpayApi');
let orderSeq = 0;
gateway.createOrder = async ({ amountPaise }) => ({ id: `order_M8T${Date.now().toString(36)}${orderSeq++}`, amount: amountPaise, currency: 'INR' });
test.before(H.start); test.after(H.stop);

const sign = (o, p) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o}|${p}`).digest('hex');
const webhook = (body) => { const raw = JSON.stringify(body); return fetch(H.base + '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'), 'x-razorpay-event-id': 'evt_' + crypto.randomBytes(6).toString('hex') }, body: raw }); };
let FREE, PRO, OTHER;

test('setup', async () => { FREE = await H.owner(); PRO = await H.owner({ plan: 'pro' }); OTHER = await H.owner(); });

test('billing overview shows plan, usage and the price list; other owners get 404', async () => {
  const r = await H.api(FREE, `/stores/${FREE.sid}/billing`);
  assert.equal(r.status, 200); assert.equal(r.json.current.id, 'free'); assert.equal(r.json.current.limits.activeProducts, 10);
  assert.deepEqual(r.json.plans.map((p) => [p.id, p.price.monthly, p.price.yearlyPerMonth]), [['free', 0, 0], ['pro', 299, 239], ['advanced', 599, 479]]);
  assert.equal((await H.api(OTHER, `/stores/${FREE.sid}/billing`)).status, 404);
});

test('Free: the 11th ACTIVE product is refused with 402; drafts still allowed; activating a draft at the limit is refused', async () => {
  for (let i = 0; i < 10; i++) await H.product(FREE, { title: 'Free item ' + i });
  const r = await H.api(FREE, `/stores/${FREE.sid}/products`, { method: 'POST', body: { title: 'Eleventh', price: 10, stock: 1, status: 'active' } });
  assert.equal(r.status, 402); assert.equal(r.json.error.code, 'upgrade_required'); assert.equal(r.json.error.details.requiredPlan, 'pro');
  const d = await H.api(FREE, `/stores/${FREE.sid}/products`, { method: 'POST', body: { title: 'Draft one', price: 10, stock: 1, status: 'draft' } });
  assert.equal(d.status, 201);
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/products/${d.json.product.id}`, { method: 'PATCH', body: { status: 'active' } })).status, 402);
});

test('Free: creating a coupon needs Pro (402); Pro can', async () => {
  const c = await H.api(FREE, `/stores/${FREE.sid}/coupons`, { method: 'POST', body: { code: 'FREE10', type: 'percent', value: 10 } });
  assert.equal(c.status, 402); assert.equal(c.json.error.details.feature, 'coupons');
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/coupons`, { method: 'POST', body: { code: 'PRO10', type: 'percent', value: 10 } })).status, 201);
});

test('checkout + signed verify upgrades the store exactly once; a forged signature changes nothing', async () => {
  const q = await H.api(FREE, `/stores/${FREE.sid}/billing/quote`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  assert.equal(q.status, 200); assert.equal(q.json.quote.amount, 299);
  const co = await H.api(FREE, `/stores/${FREE.sid}/billing/checkout`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  assert.equal(co.status, 200); assert.equal(co.json.checkout.amount, 29900); assert.equal(co.json.checkout.keyId, process.env.RAZORPAY_KEY_ID);
  const o = co.json.checkout.razorpayOrderId, pay = 'pay_M8T' + crypto.randomBytes(5).toString('hex');
  const forged = await H.api(FREE, `/stores/${FREE.sid}/billing/verify`, { method: 'POST', body: { razorpay_order_id: o, razorpay_payment_id: pay, razorpay_signature: 'a'.repeat(64) } });
  assert.equal(forged.status, 400);
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/billing`)).json.current.id, 'free');
  const proof = { razorpay_order_id: o, razorpay_payment_id: pay, razorpay_signature: sign(o, pay) };
  assert.equal((await H.api(OTHER, `/stores/${FREE.sid}/billing/verify`, { method: 'POST', body: proof })).status, 404, 'another owner cannot apply it');
  const [v1, v2] = await Promise.all([1, 2].map(() => H.api(FREE, `/stores/${FREE.sid}/billing/verify`, { method: 'POST', body: proof })));
  assert.equal(v1.status, 200); assert.equal(v2.status, 200);
  assert.equal([v1.json.alreadyApplied, v2.json.alreadyApplied].filter(Boolean).length, 1, 'granted exactly once');
  const b = (await H.api(FREE, `/stores/${FREE.sid}/billing`)).json;
  assert.equal(b.current.id, 'pro'); assert.equal(b.payments[0].status, 'paid'); assert.match(b.payments[0].invoiceNumber, /^SV-\d{4}-\d{6}$/);
  const days = (new Date(b.current.expiresAt) - Date.now()) / 864e5;
  assert.ok(days > 27 && days < 32, 'about one month');
  const inv = await H.page(`/api/stores/${FREE.sid}/billing/payments/${b.payments[0].id}/invoice`, { headers: { cookie: FREE.jar } });
  assert.equal(inv.status, 200); assert.ok(inv.text.includes(b.payments[0].invoiceNumber)); assert.ok(inv.text.includes('₹299.00'));
  assert.equal((await H.page(`/api/stores/${FREE.sid}/billing/payments/${b.payments[0].id}/invoice`, { headers: { cookie: OTHER.jar } })).status, 404);
  // now Pro: the 11th active product and coupons work
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/products`, { method: 'POST', body: { title: 'Eleventh now ok', price: 10, stock: 1, status: 'active' } })).status, 201);
});

test('a captured-payment WEBHOOK for a plan order also grants the plan (browser closed before verify)', async () => {
  const co = await H.api(OTHER, `/stores/${OTHER.sid}/billing/checkout`, { method: 'POST', body: { plan: 'advanced', cycle: 'yearly' } });
  const o = co.json.checkout.razorpayOrderId;
  const evt = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_M8W' + crypto.randomBytes(5).toString('hex'), order_id: o, amount: 479 * 12 * 100, currency: 'INR', status: 'captured', created_at: Math.floor(Date.now() / 1000) } } } };
  const r = await webhook(evt);
  assert.equal(r.status, 200, await r.clone().text());
  const b = (await H.api(OTHER, `/stores/${OTHER.sid}/billing`)).json;
  assert.equal(b.current.id, 'advanced'); assert.equal(b.current.cycle, 'yearly');
  assert.ok((new Date(b.current.expiresAt) - Date.now()) / 864e5 > 360);
  const wrongAmount = await H.api(PRO, `/stores/${PRO.sid}/billing/checkout`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_M8X' + crypto.randomBytes(5).toString('hex'), order_id: wrongAmount.json.checkout.razorpayOrderId, amount: 100, currency: 'INR', status: 'captured', created_at: Math.floor(Date.now() / 1000) } } } });
  const BillingPayment = require('../src/models/BillingPayment');
  assert.equal((await BillingPayment.findOne({ store: PRO.sid, razorpayOrderId: wrongAmount.json.checkout.razorpayOrderId })).status, 'created', 'amount mismatch is not granted');
});

test('downgrade while a higher plan runs is refused; expiry job drops to Free after grace and sends reminders', async () => {
  const d = await H.api(OTHER, `/stores/${OTHER.sid}/billing/quote`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  assert.equal(d.status, 409); assert.equal(d.json.error.code, 'downgrade_not_allowed');
  const Store = require('../src/models/Store');
  const events = require('../src/services/events');
  const seen = []; const off1 = events.on('plan.expired', (p) => seen.push(['expired', String(p.storeId)])); const off2 = events.on('plan.expiring', (p) => seen.push(['expiring', String(p.storeId), p.daysLeft]));
  await Store.updateOne({ _id: PRO.sid }, { planExpiresAt: new Date(Date.now() - 5 * 864e5) });
  await Store.updateOne({ _id: OTHER.sid }, { planExpiresAt: new Date(Date.now() + 3 * 864e5), planRenewalReminderAt: null });
  await require('../src/services/billing').expireAndRemind(); await events.drain();
  off1(); off2();
  assert.equal((await Store.findById(PRO.sid)).plan, 'free');
  assert.ok(seen.some((x) => x[0] === 'expired' && x[1] === PRO.sid));
  assert.ok(seen.some((x) => x[0] === 'expiring' && x[1] === OTHER.sid && x[2] === 3));
  seen.length = 0; await require('../src/services/billing').expireAndRemind(); await events.drain();
  assert.equal(seen.length, 0, 'no duplicate reminder on the next run');
});

test('Advanced allows up to 3 stores per owner; Free allows 1', async () => {
  const s1 = await H.api(FREE, '/stores', { method: 'POST', body: { name: 'Second store', slug: 'it2-' + H.rnd(), whatsappNumber: '9876543210' } });
  assert.equal(s1.status, 403, 'Pro still allows one store'); 
  const s2 = await H.api(OTHER, '/stores', { method: 'POST', body: { name: 'Second store', slug: 'it2-' + H.rnd(), whatsappNumber: '9876543210' } });
  assert.equal(s2.status, 201); H.created.stores.push(s2.json.store.id);
});
