'use strict';
// Module 8: STORVA subscriptions. Plans are PREPAID periods (1 or 12 months) paid with Razorpay Standard Checkout, using the platform's
// own Razorpay keys. Why prepaid instead of Razorpay Subscriptions: no mandate/plan setup in the Razorpay dashboard, UPI works everywhere,
// and nothing is charged automatically; owners get reminders before the period ends (Module 13) and renew with one click.
// Safety: the amount always comes from src/config/plans.js; a period is granted only after the HMAC signature (or a signed webhook)
// proves the payment, and exactly once (compare-and-set on the payment row).
const Store = require('../models/Store');
const Product = require('../models/Product');
const BillingPayment = require('../models/BillingPayment');
const Sequence = require('../models/Sequence');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');
const { PLANS, CYCLES, priceFor, effectivePlanId, planFor, publicPlans, normalizePlanId, inGrace, graceMs } = require('../config/plans');
const { verifySignature, readProof } = require('../utils/razorpay');
const gateway = require('./razorpayApi');
const events = require('./events');
const Subscription = require('../models/Subscription');
const GatewayPlan = require('../models/GatewayPlan');
const S = require('../utils/razorpaySubscription');

const DAY = 864e5;
const addMonths = (d, n) => { const x = new Date(d); const day = x.getDate(); x.setMonth(x.getMonth() + n); if (x.getDate() < day) x.setDate(0); return x; };
const devBillingAllowed = () => !env.isProd && !env.razorpay.enabled && process.env.BILLING_DEV_MODE !== 'false';
// Auto-renew (Razorpay Subscriptions) is opt-in: it needs Subscriptions activated on the Razorpay account. Prepaid periods keep working either way.
const subscriptionsEnabled = () => env.razorpay.enabled && process.env.RAZORPAY_SUBSCRIPTIONS_ENABLED === 'true';
const LIVE_SUB = ['authenticated', 'active', 'pending'];

// What a purchase of (plan, cycle) right now would give. Pure: used for the quote shown before paying AND when granting.
function computePeriod(store, plan, cycle, now = new Date()) {
  const cur = effectivePlanId(store, now);
  const curEnd = store.planExpiresAt ? new Date(store.planExpiresAt) : null;
  const active = cur !== 'free' && curEnd && curEnd > now;
  if (active && PLANS[cur].rank > PLANS[plan].rank) {
    return { problem: `Your ${PLANS[cur].name} plan is active until ${curEnd.toDateString()}. You can move to ${PLANS[plan].name} when it ends.` };
  }
  let start = now, creditDays = 0;
  if (active && cur === plan) start = curEnd;                 // renewal: the new period starts when the current one ends
  else if (active) {                                          // upgrade: unused days of the cheaper plan become extra days on the new plan
    const remainingDays = (curEnd - now) / DAY;
    creditDays = Math.floor(remainingDays * (PLANS[cur].price.monthly / PLANS[plan].price.monthly));
  }
  const end = new Date(addMonths(start, CYCLES[cycle].months).getTime() + creditDays * DAY);
  return { start, end, creditDays, renewal: active && cur === plan, upgrade: active && cur !== plan };
}

async function usage(store) {
  const [activeProducts, totalProducts, stores] = await Promise.all([
    Product.countDocuments({ store: store._id, status: 'active' }), Product.countDocuments({ store: store._id }), Store.countDocuments({ owner: store.owner }),
  ]);
  let aiCreditsUsed = 0;
  try { aiCreditsUsed = await require('./ai').creditsUsedThisMonth(store._id); } catch { /* AI module optional */ }
  return { activeProducts, totalProducts, stores, aiCreditsUsed };
}

async function getBilling(store) {
  const plan = planFor(store);
  const [u, payments, sub] = await Promise.all([usage(store), BillingPayment.find({ store: store._id }).sort({ createdAt: -1 }).limit(24), Subscription.findOne({ store: store._id, status: { $in: [...LIVE_SUB, 'halted'] } }).sort({ createdAt: -1 })]);
  return {
    current: { id: plan.id, name: plan.name, cycle: plan.id === 'free' ? null : store.planCycle, expiresAt: plan.id === 'free' ? null : store.planExpiresAt, inGrace: inGrace(store), graceDays: Math.round(graceMs() / DAY), limits: plan.limits, features: plan.features },
    usage: u, plans: publicPlans(), payments: payments.map((p) => p.toApi()),
    checkout: { online: env.razorpay.enabled, devMode: devBillingAllowed(), subscriptions: subscriptionsEnabled() },
    subscription: sub ? sub.toApi() : null,
  };
}

function readChoice(input) {
  const b = input && typeof input === 'object' ? input : {};
  const plan = typeof b.plan === 'string' ? b.plan : '', cycle = typeof b.cycle === 'string' ? b.cycle : '';
  const fields = {};
  if (!['pro', 'advanced'].includes(plan)) fields.plan = 'Choose Pro or Advanced.';
  if (!CYCLES[cycle]) fields.cycle = 'Choose monthly or yearly billing.';
  if (Object.keys(fields).length) throw new AppError('Please choose a plan.', 400, 'validation_error', { fields });
  return { plan, cycle };
}

async function quote(store, input) {
  const { plan, cycle } = readChoice(input);
  const p = computePeriod(store, plan, cycle);
  if (p.problem) throw new AppError(p.problem, 409, 'downgrade_not_allowed');
  return { plan, cycle, amount: priceFor(plan, cycle) / 100, periodStart: p.start, periodEnd: p.end, creditDays: p.creditDays, renewal: p.renewal, upgrade: p.upgrade };
}

async function startCheckout(store, user, input) {
  const { plan, cycle } = readChoice(input);
  const p = computePeriod(store, plan, cycle);
  if (p.problem) throw new AppError(p.problem, 409, 'downgrade_not_allowed');
  if (!env.razorpay.enabled) throw new AppError(devBillingAllowed() ? 'Online payments are not configured. In development you can use "Activate (test)" instead.' : 'Plan payments are not available right now. Please try again later.', 503, 'payments_unavailable');
  const amountPaise = priceFor(plan, cycle);
  const created = await gateway.createOrder({ amountPaise, receipt: `plan-${String(store._id).slice(-8)}-${Date.now().toString(36)}`.slice(0, 40), notes: { kind: 'storva_plan', store: String(store._id), plan, cycle } });
  if (created.amount !== amountPaise || created.currency !== 'INR') throw new AppError('The payment provider returned an unexpected amount.', 502, 'gateway_error');
  const row = await BillingPayment.create({ store: store._id, user: user._id, plan, cycle, amountPaise, razorpayOrderId: created.id });
  return { paymentId: String(row._id), keyId: env.razorpay.keyId, razorpayOrderId: created.id, amount: amountPaise, currency: 'INR', name: env.brandName, description: `${PLANS[plan].name} plan · ${CYCLES[cycle].label}`, prefill: { name: user.name, email: user.email, contact: '+' + user.phone } };
}

async function nextInvoiceNumber(date = new Date()) {
  const y = date.getFullYear();
  return `SV-${y}-${String(await Sequence.next('platform-invoice-' + y)).padStart(6, '0')}`;
}

// Grants the period for a payment row exactly once. Called by the browser verify step, the webhook and dev activation.
async function grant(row, { razorpayPaymentId = null, now = new Date() } = {}) {
  const store = await Store.findById(row.store);
  if (!store) return { granted: false, reason: 'store_gone' };
  const p = computePeriod(store, row.plan, row.cycle, now);
  // A payment that cannot be applied (e.g. a higher plan was bought meanwhile) is still recorded as paid; the period is added after the current one.
  const start = p.problem ? new Date(store.planExpiresAt) : p.start;
  const end = p.problem ? addMonths(start, CYCLES[row.cycle].months) : p.end;
  let claimed = await BillingPayment.findOneAndUpdate(
    { _id: row._id, store: row.store, status: { $in: ['created', 'failed'] } },
    { $set: { status: 'paid', paidAt: now, razorpayPaymentId: razorpayPaymentId || row.razorpayPaymentId, periodStart: start, periodEnd: end, creditDays: p.problem ? 0 : p.creditDays, error: '' } },
    { new: true });
  // The invoice number is taken only by the caller that won the claim, so racing verify/webhook calls never burn a number (no gaps in the series).
  if (claimed && !claimed.invoiceNumber) {
    claimed = (await BillingPayment.findOneAndUpdate({ _id: row._id, store: row.store, invoiceNumber: null }, { $set: { invoiceNumber: await nextInvoiceNumber(now) } }, { new: true })) || claimed;
  }
  if (!claimed) return { granted: false, reason: 'already_applied', payment: await BillingPayment.findOne({ _id: row._id, store: row.store }) };
  const keepHigher = p.problem ? {} : { plan: row.plan, planCycle: row.cycle };
  await Store.updateOne({ _id: row.store }, { $set: { ...keepHigher, planExpiresAt: p.problem ? end : end, planRenewalReminderAt: null } });
  events.emit('plan.activated', { storeId: row.store, plan: row.plan, cycle: row.cycle, expiresAt: end, paymentId: claimed._id, amountPaise: claimed.amountPaise, source: claimed.source }); // paymentId: affiliate commissions (services/affiliates.js)
  return { granted: true, payment: claimed };
}

async function verifyCheckout(store, input) {
  const { proof, problem } = readProof(input);
  if (problem) throw new AppError(problem, 400, 'invalid_payment');
  if (!env.razorpay.keySecret) throw new AppError('Plan payments are not available right now.', 503, 'payments_unavailable');
  const row = await BillingPayment.findOne({ store: store._id, razorpayOrderId: proof.orderId });
  if (!row || !verifySignature(proof, env.razorpay.keySecret)) throw new AppError('We could not verify this payment. If money was deducted, contact support with your payment id.', 400, 'invalid_signature');
  const r = await grant(row, { razorpayPaymentId: proof.paymentId });
  return { ok: true, alreadyApplied: !r.granted, payment: (r.payment || row).toApi(), billing: await getBilling(await Store.findById(store._id)) };
}

// Development only (no Razorpay keys, NODE_ENV != production): activate a plan without paying so every gated feature can be tried locally.
async function devActivate(store, user, input) {
  if (!devBillingAllowed()) throw new AppError('Test activation is only available in development without Razorpay keys.', 403, 'forbidden');
  const { plan, cycle } = readChoice(input);
  const p = computePeriod(store, plan, cycle);
  if (p.problem) throw new AppError(p.problem, 409, 'downgrade_not_allowed');
  const row = await BillingPayment.create({ store: store._id, user: user._id, plan, cycle, amountPaise: 0, source: 'dev' });
  await grant(row);
  return getBilling(await Store.findById(store._id));
}

// Webhook path (payment.captured / payment.failed for a Razorpay order that is not a storefront order). Returns an outcome string or null if unknown.
async function handleGatewayEvent(event, payment) {
  const row = await BillingPayment.findOne({ razorpayOrderId: payment.orderId }).setOptions({ skipTenant: true });
  if (!row) return null;
  if (event === 'payment.captured') {
    if (payment.amount !== undefined && payment.amount !== row.amountPaise) { console.error('[billing] captured amount mismatch for', row.razorpayOrderId); return 'ignored:billing_amount_mismatch'; }
    const r = await grant(row, { razorpayPaymentId: payment.id });
    return r.granted ? 'applied:billing_paid' : 'noop:billing_already_paid';
  }
  if (event === 'payment.failed') {
    await BillingPayment.updateOne({ _id: row._id, store: row.store, status: 'created' }, { $set: { status: 'failed', error: String(payment.error || 'Payment failed').slice(0, 200) } });
    return 'applied:billing_failed';
  }
  return 'ignored:billing_event';
}

// Hourly: drop stores past their grace period to Free, and send "ends soon" reminders 7 days and 1 day before the end.
async function expireAndRemind(now = new Date()) {
  const cutoff = new Date(now.getTime() - graceMs());
  const expired = await Store.find({ plan: { $ne: 'free' }, planExpiresAt: { $ne: null, $lte: cutoff } }).select('_id plan planExpiresAt').limit(500);
  for (const s of expired) {
    const r = await Store.updateOne({ _id: s._id, plan: s.plan, planExpiresAt: s.planExpiresAt }, { $set: { plan: 'free', planCycle: null, planExpiresAt: null, planRenewalReminderAt: null } });
    if (r.modifiedCount) events.emit('plan.expired', { storeId: s._id, plan: normalizePlanId(s.plan) });
  }
  const soon = await Store.find({ plan: { $ne: 'free' }, planExpiresAt: { $gt: new Date(now.getTime() - graceMs()), $lte: new Date(now.getTime() + 7 * DAY) } }).select('_id plan planExpiresAt planRenewalReminderAt').limit(500);
  const autoRenewing = new Set((await Subscription.distinct('store', { status: { $in: LIVE_SUB }, cancelAtCycleEnd: { $ne: true } }).setOptions({ skipTenant: true })).map(String));
  let reminded = 0;
  for (const s of soon) {
    if (autoRenewing.has(String(s._id))) continue; // the next charge renews it
    const daysLeft = Math.ceil((new Date(s.planExpiresAt) - now) / DAY);
    const last = s.planRenewalReminderAt ? new Date(s.planRenewalReminderAt) : null;
    const due = !last || (daysLeft <= 1 && (now - last) > 2 * DAY) || (daysLeft <= 0 && (now - last) > DAY);
    if (!due) continue;
    const r = await Store.updateOne({ _id: s._id, planRenewalReminderAt: s.planRenewalReminderAt || null }, { $set: { planRenewalReminderAt: now } });
    if (r.modifiedCount) { reminded++; events.emit('plan.expiring', { storeId: s._id, plan: normalizePlanId(s.plan), expiresAt: s.planExpiresAt, daysLeft }); }
  }
  return { expired: expired.length, reminded };
}

function startPlanJob() {
  return require('./jobs').startJob('plans', () => expireAndRemind(), { intervalMs: 60 * 60 * 1000, firstDelayMs: 45 * 1000, enabled: process.env.PLAN_EXPIRY_ENABLED !== 'false' });
}

// ---------- Auto-renew (Razorpay Subscriptions) ----------
// Reuses grant() for every period, so invoices, plan limits, upgrade credit and exactly-once rules are identical to a prepaid purchase.
async function gatewayPlanId(plan, cycle) {
  const amountPaise = priceFor(plan, cycle), key = S.planKey(plan, cycle, amountPaise);
  const found = await GatewayPlan.findOne({ key });
  if (found) return found.razorpayPlanId;
  const created = await gateway.createPlan(S.planRequest({ plan, cycle, amountPaise, name: `${env.brandName} ${PLANS[plan].name} (${CYCLES[cycle].label})` }));
  try { await GatewayPlan.create({ key, razorpayPlanId: created.id, plan, cycle, amountPaise }); return created.id; }
  catch (e) { if (e && e.code === 11000) { const again = await GatewayPlan.findOne({ key }); if (again) return again.razorpayPlanId; } throw e; }
}

async function startSubscription(store, user, input) {
  if (!subscriptionsEnabled()) throw new AppError('Auto-renew is not available right now. You can still pay for one period.', 503, 'subscriptions_unavailable');
  const { plan, cycle } = readChoice(input);
  const now = new Date(), p = computePeriod(store, plan, cycle, now);
  if (p.problem) throw new AppError(p.problem, 409, 'downgrade_not_allowed');
  const live = await Subscription.findOne({ store: store._id, status: { $in: LIVE_SUB } });
  if (live) throw new AppError(live.cancelAtCycleEnd ? 'Auto-renew is switched off and ends with your current period. You can turn it on again after that.' : 'Auto-renew is already on for this store. Turn it off first to change plan.', 409, 'subscription_exists');
  const planId = await gatewayPlanId(plan, cycle), amountPaise = priceFor(plan, cycle);
  // A renewal of the plan the store already has starts charging when the paid period ends; everything else is charged right away at checkout.
  const startAtMs = p.renewal ? p.start.getTime() : null;
  const created = await gateway.createSubscription(S.subscriptionRequest({ planId, cycle, startAtMs, now: now.getTime(), notes: { kind: 'storva_plan', store: String(store._id), plan, cycle } }));
  const startsAt = startAtMs && startAtMs - now.getTime() >= S.MIN_START_LEAD_MS ? new Date(startAtMs) : null;
  await Subscription.create({ store: store._id, user: user._id, plan, cycle, amountPaise, razorpaySubscriptionId: created.id, razorpayPlanId: planId, startsAt });
  return { subscriptionId: created.id, keyId: env.razorpay.keyId, amount: amountPaise, currency: 'INR', startsAt, name: env.brandName, description: `${PLANS[plan].name} plan · ${CYCLES[cycle].label} · auto-renew`, prefill: { name: user.name, email: user.email, contact: '+' + user.phone } };
}

// One Razorpay payment of a subscription -> one BillingPayment row -> one granted period. Safe to call twice for the same payment (verify racing the webhook, webhook retries).
async function recordCharge(sub, paymentId, now = new Date()) {
  let row;
  try { row = await BillingPayment.create({ store: sub.store, user: sub.user, plan: sub.plan, cycle: sub.cycle, amountPaise: sub.amountPaise, source: 'subscription', razorpaySubscriptionId: sub.razorpaySubscriptionId, razorpayPaymentId: paymentId }); }
  catch (e) {
    if (!(e && e.code === 11000)) throw e;
    row = await BillingPayment.findOne({ store: sub.store, razorpayPaymentId: paymentId, source: 'subscription' });
    if (!row) throw e;
    if (row.status === 'paid') return { granted: false, reason: 'already_applied' };
  } // a row left "created" by a crash is finished here: grant() is compare-and-set, so only one caller wins
  const r = await grant(row, { razorpayPaymentId: paymentId, now });
  if (r.granted) await Subscription.updateOne({ _id: sub._id, store: sub.store }, { $set: { lastChargedAt: now }, $inc: { paidCount: 1 } });
  return r;
}

async function verifySubscriptionCheckout(store, input) {
  const { proof, problem } = S.readSubscriptionProof(input);
  if (problem) throw new AppError(problem, 400, 'invalid_payment');
  if (!env.razorpay.keySecret) throw new AppError('Plan payments are not available right now.', 503, 'payments_unavailable');
  const sub = await Subscription.findOne({ store: store._id, razorpaySubscriptionId: proof.subscriptionId });
  if (!sub || !S.verifySubscriptionSignature(proof, env.razorpay.keySecret)) throw new AppError('We could not verify this payment. If money was deducted, contact support with your payment id.', 400, 'invalid_signature');
  await Subscription.updateOne({ _id: sub._id, store: sub.store, status: 'created' }, { $set: { status: 'authenticated' } });
  // Immediate start: the checkout payment IS the first charge, and the signature ties it to this subscription (whose price we fixed). A scheduled start only authorised the mandate: the webhook grants when the real charge happens.
  if (!sub.startsAt) await recordCharge(sub, proof.paymentId);
  const fresh = await Store.findById(store._id);
  return { ok: true, billing: await getBilling(fresh) };
}

async function cancelAutoRenew(store) {
  if (!subscriptionsEnabled()) throw new AppError('Auto-renew is not available right now.', 503, 'subscriptions_unavailable');
  const sub = await Subscription.findOne({ store: store._id, status: { $in: LIVE_SUB } });
  if (!sub) throw new AppError('Auto-renew is not on for this store.', 404, 'not_found');
  const atCycleEnd = sub.status === 'active'; // Razorpay only allows "at the end of the cycle" for an active subscription
  await gateway.cancelSubscription(sub.razorpaySubscriptionId, atCycleEnd);
  await Subscription.updateOne({ _id: sub._id, store: sub.store }, { $set: atCycleEnd ? { cancelAtCycleEnd: true } : { status: 'cancelled', cancelAtCycleEnd: false } });
  return getBilling(await Store.findById(store._id)); // the paid period stays active until planExpiresAt either way
}

// Webhook path for subscription.* events. -> { outcome }. The charge is recorded even if the status event is stale or out of order.
async function handleSubscriptionEvent(parsed) {
  const sub = await Subscription.findOne({ razorpaySubscriptionId: parsed.subscription.id }).setOptions({ skipTenant: true });
  if (!sub) return { outcome: 'ignored:subscription_not_found', order: null };
  let outcome = 'noop:subscription_no_change';
  if (parsed.event === 'subscription.charged') {
    const pay = parsed.payment;
    if (pay.amount !== sub.amountPaise || pay.currency !== 'INR' || (pay.status && pay.status !== 'captured')) { console.error('[billing] subscription charge does not match the subscription (amount/status) for', sub.razorpaySubscriptionId); return { outcome: 'ignored:subscription_charge_mismatch', order: null }; }
    const r = await recordCharge(sub, pay.id);
    outcome = r.granted ? 'applied:subscription_charged' : 'noop:subscription_charge_already_applied';
  }
  const fresh = await Subscription.findOne({ _id: sub._id, store: sub.store });
  const d = S.decideSubscriptionState(fresh || sub, parsed);
  if (d.action === 'apply') {
    await Subscription.updateOne({ _id: sub._id, store: sub.store }, { $set: d.set });
    if (outcome.startsWith('noop')) outcome = 'applied:subscription_' + d.reason;
    if (d.reason === 'halted') events.emit('plan.subscription_halted', { storeId: sub.store, plan: sub.plan });
  } else if (outcome.startsWith('noop')) outcome = (d.action === 'ignore' ? 'ignored:' : 'noop:') + d.reason;
  return { outcome, order: null };
}

async function maxStoresFor(userId) {
  const stores = await Store.find({ owner: userId }).select('plan planExpiresAt');
  return Math.max(env.maxStoresPerUser, ...stores.map((s) => planFor(s).limits.stores));
}

module.exports = { computePeriod, getBilling, quote, startCheckout, verifyCheckout, devActivate, grant, handleGatewayEvent, startSubscription, verifySubscriptionCheckout, cancelAutoRenew, handleSubscriptionEvent, recordCharge, subscriptionsEnabled, expireAndRemind, startPlanJob, usage, maxStoresFor, nextInvoiceNumber, addMonths, devBillingAllowed };
