'use strict';
// Razorpay Subscriptions (auto-renew): pure logic only, no database and no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const S = require('../src/utils/razorpaySubscription');
const W = require('../src/utils/razorpayWebhook');

const SECRET = 'rzp_secret_for_tests_' + 'x'.repeat(10);
const SUB = 'sub_TestSub12345', PAY = 'pay_TestPay12345', PLAN = 'plan_TestPlan1234';
const sigOf = (p, s, secret = SECRET) => crypto.createHmac('sha256', secret).update(`${p}|${s}`).digest('hex');
const event = (name, extra = {}) => ({ event: name, created_at: 1790000000, payload: { subscription: { entity: { id: SUB, plan_id: PLAN, status: 'active', paid_count: 1, current_end: 1792600000, notes: { kind: 'storva_plan', store: 'abc', plan: 'pro', cycle: 'monthly' } } }, ...extra } });
const charged = () => event('subscription.charged', { payment: { entity: { id: PAY, amount: 29900, currency: 'INR', status: 'captured' } } });

test('checkout signature = HMAC(payment_id|subscription_id) and nothing else verifies', () => {
  const good = { paymentId: PAY, subscriptionId: SUB, signature: sigOf(PAY, SUB) };
  assert.equal(S.verifySubscriptionSignature(good, SECRET), true);
  assert.equal(S.verifySubscriptionSignature({ ...good, signature: sigOf(SUB, PAY) }, SECRET), false, 'order|payment style is wrong for subscriptions');
  assert.equal(S.verifySubscriptionSignature(good, 'other-secret'), false);
  assert.equal(S.verifySubscriptionSignature({ ...good, signature: 'zz' }, SECRET), false);
  assert.equal(S.verifySubscriptionSignature({ ...good, subscriptionId: 'order_Abcdef123' }, SECRET), false);
  assert.equal(S.verifySubscriptionSignature(good, ''), false);
});
test('readSubscriptionProof accepts only the exact Razorpay formats', () => {
  const ok = S.readSubscriptionProof({ razorpay_payment_id: PAY, razorpay_subscription_id: SUB, razorpay_signature: sigOf(PAY, SUB).toUpperCase() });
  assert.equal(ok.proof.signature, sigOf(PAY, SUB));
  for (const bad of [null, [], {}, { razorpay_payment_id: PAY, razorpay_subscription_id: SUB }, { razorpay_payment_id: PAY, razorpay_subscription_id: 'x', razorpay_signature: sigOf(PAY, SUB) }, { razorpay_payment_id: { $ne: 1 }, razorpay_subscription_id: SUB, razorpay_signature: sigOf(PAY, SUB) }]) assert.ok(S.readSubscriptionProof(bad).problem);
});
test('request bodies: plan is billed monthly/yearly in INR paise; start_at only when 15+ minutes ahead; notes are strings', () => {
  const p = S.planRequest({ plan: 'pro', cycle: 'yearly', amountPaise: 286800, name: 'STORVA Pro (Yearly)' });
  assert.deepEqual([p.period, p.interval, p.item.amount, p.item.currency], ['yearly', 1, 286800, 'INR']);
  const now = 1_800_000_000_000;
  assert.equal(S.subscriptionRequest({ planId: PLAN, cycle: 'monthly', now }).start_at, undefined);
  assert.equal(S.subscriptionRequest({ planId: PLAN, cycle: 'monthly', startAtMs: now + 5 * 60e3, now }).start_at, undefined, 'too soon');
  assert.equal(S.subscriptionRequest({ planId: PLAN, cycle: 'monthly', startAtMs: now + 3 * 864e5, now }).start_at, Math.floor((now + 3 * 864e5) / 1000));
  const b = S.subscriptionRequest({ planId: PLAN, cycle: 'yearly', now, notes: { store: 123, plan: 'pro' } });
  assert.equal(b.total_count, S.TOTAL_COUNT.yearly); assert.deepEqual(b.notes, { store: '123', plan: 'pro' }); assert.equal(S.planKey('pro', 'monthly', 29900), 'pro:monthly:29900');
});
test('webhook parsing: charged carries subscription + payment; other events carry the subscription only; unknown events are unsupported', () => {
  const c = S.parseSubscriptionEvent(charged());
  assert.equal(c.supported, true); assert.equal(c.subscription.id, SUB); assert.equal(c.payment.amount, 29900); assert.equal(c.subscription.notes.plan, 'pro'); assert.equal(c.eventAt, 1790000000 * 1000);
  assert.equal(S.parseSubscriptionEvent(event('subscription.halted')).payment, undefined);
  assert.equal(S.parseSubscriptionEvent({ event: 'subscription.something_new', payload: {} }).supported, false);
  assert.ok(S.parseSubscriptionEvent(event('subscription.charged')).problem, 'charged without a payment entity');
  assert.ok(S.parseSubscriptionEvent({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'bad' } } } }).problem);
});
test('the shared webhook parser routes subscription.* here and leaves payment/refund parsing alone', () => {
  const sub = W.parseWebhook(Buffer.from(JSON.stringify(charged())));
  assert.equal(sub.supported, true); assert.equal(sub.subscription.id, SUB);
  const invoicePay = W.parseWebhook(Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: PAY, amount: 29900, currency: 'INR', invoice_id: 'inv_Abcdef1234' } } } })));
  assert.equal(invoicePay.supported, false, 'acknowledged, not rejected');
  const garbage = W.parseWebhook(Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: PAY } } } })));
  assert.ok(garbage.problem, 'a malformed order payment is still rejected');
  const order = W.parseWebhook(Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: PAY, order_id: 'order_Abcdef1234', amount: 100, currency: 'INR', status: 'captured' } } } })));
  assert.equal(order.supported, true); assert.equal(order.payment.orderId, 'order_Abcdef1234');
});
test('state decisions: forward, same, stale and terminal', () => {
  const parsed = (name, over = {}) => ({ ...S.parseSubscriptionEvent(name === 'subscription.charged' ? charged() : event(name)), ...over });
  const d1 = S.decideSubscriptionState({ status: 'authenticated', lastEventAt: null }, parsed('subscription.activated'));
  assert.equal(d1.action, 'apply'); assert.equal(d1.set.status, 'active'); assert.ok(d1.set.currentEnd instanceof Date);
  const d2 = S.decideSubscriptionState({ status: 'active', lastEventAt: new Date(1790000000 * 1000 - 5000) }, parsed('subscription.charged'));
  assert.equal(d2.action, 'apply'); assert.equal(d2.set.status, undefined, 'status unchanged, but the new cycle end is stored');
  assert.equal(S.decideSubscriptionState({ status: 'active', lastEventAt: new Date(1790000000 * 1000 + 1000) }, parsed('subscription.halted')).reason, 'stale_event');
  assert.equal(S.decideSubscriptionState({ status: 'cancelled', lastEventAt: null }, parsed('subscription.activated')).reason, 'subscription_already_ended');
  const d3 = S.decideSubscriptionState({ status: 'active', lastEventAt: null }, parsed('subscription.cancelled'));
  assert.equal(d3.set.status, 'cancelled'); assert.equal(d3.set.cancelAtCycleEnd, false);
  assert.equal(S.decideSubscriptionState({ status: 'halted', lastEventAt: null }, parsed('subscription.halted', { eventAt: null, subscription: { ...parsed('subscription.halted').subscription, currentEnd: null } })).action, 'noop');
});
