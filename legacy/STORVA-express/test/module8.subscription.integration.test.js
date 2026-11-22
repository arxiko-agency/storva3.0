'use strict';
// Auto-renew (Razorpay Subscriptions) against a REAL MongoDB. Razorpay's plan/subscription API is stubbed; signatures and webhooks are computed with test secrets.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.RAZORPAY_KEY_ID = 'rzp_test_STORVAsubkey'; process.env.RAZORPAY_KEY_SECRET = 'sub_secret_' + 'k'.repeat(20); process.env.RAZORPAY_WEBHOOK_SECRET = 'sub_whsec_' + 'w'.repeat(20);
process.env.RAZORPAY_SUBSCRIPTIONS_ENABLED = 'true';
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'module 8 subscriptions'); return; }
const gateway = require('../src/services/razorpayApi');
let seq = 0; const cancelled = [], created = [];
gateway.createPlan = async () => ({ id: 'plan_T' + Date.now().toString(36) + seq++ });
gateway.createSubscription = async (body) => { created.push(body); return { id: 'sub_T' + Date.now().toString(36) + seq++, status: 'created' }; };
gateway.cancelSubscription = async (id, atCycleEnd) => { cancelled.push([id, atCycleEnd]); return { id, status: 'cancelled' }; };
test.before(H.start); test.after(H.stop);

const hex = (n) => crypto.randomBytes(n).toString('hex');
const subSig = (pay, sub) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${pay}|${sub}`).digest('hex');
const webhook = (body) => { const raw = JSON.stringify(body); return fetch(H.base + '/webhooks/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'), 'x-razorpay-event-id': 'evt_' + hex(6) }, body: raw }); };
const evt = (name, subId, extra = {}) => ({ event: name, created_at: Math.floor(Date.now() / 1000), payload: { subscription: { entity: { id: subId, plan_id: 'plan_TestPlan1234', status: 'active', paid_count: 1, current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: {} } }, ...extra } });
const charge = (subId, payId, amount = 29900) => evt('subscription.charged', subId, { payment: { entity: { id: payId, amount, currency: 'INR', status: 'captured' } } });
let OWNER, SUBID, FIRSTPAY;
const billing = () => H.api(OWNER, `/stores/${OWNER.sid}/billing`).then((r) => r.json);

test('setup', async () => { OWNER = await H.owner(); });

test('billing overview says auto-renew is available', async () => {
  const b = await billing(); assert.equal(b.checkout.subscriptions, true); assert.equal(b.subscription, null);
});

test('subscribe starts an immediate-charge subscription; a forged proof changes nothing; the signed proof grants the plan exactly once', async () => {
  const r = await H.api(OWNER, `/stores/${OWNER.sid}/billing/subscribe`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  assert.equal(r.status, 200); assert.match(r.json.checkout.subscriptionId, /^sub_/); assert.equal(r.json.checkout.amount, 29900); assert.equal(r.json.checkout.startsAt, null);
  assert.equal(created[0].total_count, 120); assert.equal(created[0].start_at, undefined);
  SUBID = r.json.checkout.subscriptionId; FIRSTPAY = 'pay_T' + hex(5);
  const forged = await H.api(OWNER, `/stores/${OWNER.sid}/billing/subscription/verify`, { method: 'POST', body: { razorpay_payment_id: FIRSTPAY, razorpay_subscription_id: SUBID, razorpay_signature: 'a'.repeat(64) } });
  assert.equal(forged.status, 400); assert.equal((await billing()).current.id, 'free');
  const proof = { razorpay_payment_id: FIRSTPAY, razorpay_subscription_id: SUBID, razorpay_signature: subSig(FIRSTPAY, SUBID) };
  const rs = await Promise.all([1, 2].map(() => H.api(OWNER, `/stores/${OWNER.sid}/billing/subscription/verify`, { method: 'POST', body: proof })));
  assert.deepEqual(rs.map((x) => x.status), [200, 200]);
  const b = await billing();
  assert.equal(b.current.id, 'pro'); assert.equal(b.payments.filter((p) => p.status === 'paid').length, 1, 'one period, one invoice');
  assert.equal(b.payments[0].source, 'subscription'); assert.match(b.payments[0].invoiceNumber, /^SV-\d{4}-\d{6}$/);
  assert.ok(['authenticated', 'active'].includes(b.subscription.status));
});

test('the webhook for the SAME payment is a duplicate; a NEW payment extends the plan by one more month', async () => {
  const before = (await billing()).current.expiresAt;
  assert.equal((await webhook(charge(SUBID, FIRSTPAY))).status, 200);
  let b = await billing(); assert.equal(b.current.expiresAt, before); assert.equal(b.payments.filter((p) => p.status === 'paid').length, 1);
  assert.equal(b.subscription.status, 'active');
  assert.equal((await webhook(charge(SUBID, 'pay_T' + hex(5)))).status, 200);
  b = await billing();
  assert.equal(b.payments.filter((p) => p.status === 'paid').length, 2);
  const days = (new Date(b.current.expiresAt) - new Date(before)) / 864e5; assert.ok(days > 27 && days < 32, `renewal starts when the first period ends (${days} days added)`);
});

test('a charge for the wrong amount, and an unknown subscription, change nothing', async () => {
  const before = (await billing()).current.expiresAt;
  assert.equal((await webhook(charge(SUBID, 'pay_T' + hex(5), 1000))).status, 200);
  assert.equal((await billing()).current.expiresAt, before);
  assert.equal((await webhook(charge('sub_Unknown12345', 'pay_T' + hex(5)))).status, 200);
});

test('a second subscription while one is live is refused (409)', async () => {
  const r = await H.api(OWNER, `/stores/${OWNER.sid}/billing/subscribe`, { method: 'POST', body: { plan: 'pro', cycle: 'monthly' } });
  assert.equal(r.status, 409); assert.equal(r.json.error.code, 'subscription_exists');
});

test('turning auto-renew off cancels at cycle end, keeps the paid plan, and the cancelled webhook ends it', async () => {
  const r = await H.api(OWNER, `/stores/${OWNER.sid}/billing/subscription/cancel`, { method: 'POST' });
  assert.equal(r.status, 200); assert.deepEqual(cancelled[cancelled.length - 1], [SUBID, true]);
  let b = await billing(); assert.equal(b.subscription.cancelAtCycleEnd, true); assert.equal(b.current.id, 'pro');
  assert.equal((await webhook(evt('subscription.cancelled', SUBID, {}))).status, 200);
  b = await billing(); assert.equal(b.current.id, 'pro', 'the paid period is not shortened'); assert.equal(b.subscription, null, 'no live subscription any more');
  assert.equal((await H.api(OWNER, `/stores/${OWNER.sid}/billing/subscription/cancel`, { method: 'POST' })).status, 404);
});

test('another owner cannot verify or cancel this store\'s subscription', async () => {
  const other = await H.owner();
  assert.equal((await H.api(other, `/stores/${OWNER.sid}/billing/subscription/cancel`, { method: 'POST' })).status, 404);
});
