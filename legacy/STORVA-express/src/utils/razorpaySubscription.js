'use strict';
// Pure helpers for Razorpay Subscriptions (auto-renewing STORVA plans). No database, no network: unit-tested without MongoDB.
// Flow: we create a Razorpay Plan (once per plan/cycle/price) -> a Subscription for the store -> the owner authorises it in Razorpay
// Checkout -> every charge arrives as a signed `subscription.charged` webhook, and each one extends the store's plan by one period.
const crypto = require('crypto');

const SUB_ID = /^sub_[A-Za-z0-9]{6,40}$/, PLAN_ID = /^plan_[A-Za-z0-9]{6,40}$/, PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/, SIGNATURE = /^[a-f0-9]{64}$/i;
const SUBSCRIPTION_EVENTS = ['subscription.authenticated', 'subscription.activated', 'subscription.charged', 'subscription.pending', 'subscription.halted',
  'subscription.cancelled', 'subscription.completed', 'subscription.paused', 'subscription.resumed', 'subscription.updated'];
const STATUS_OF = { authenticated: 'authenticated', activated: 'active', charged: 'active', pending: 'pending', halted: 'halted', cancelled: 'cancelled', completed: 'completed', paused: 'paused', resumed: 'active', updated: null };
const TERMINAL = new Set(['cancelled', 'completed']);
const TOTAL_COUNT = { monthly: 120, yearly: 10 };       // billing cycles the mandate covers (about ten years); the owner can cancel any time
const MIN_START_LEAD_MS = 15 * 60 * 1000;               // Razorpay needs start_at comfortably in the future

// Checkout proof for a subscription payment: hex(HMAC_SHA256(razorpay_payment_id + '|' + razorpay_subscription_id, KEY_SECRET)).
// (Order payments use order_id|payment_id; for subscriptions the payment id comes FIRST.)
const computeSubscriptionSignature = (paymentId, subscriptionId, secret) => crypto.createHmac('sha256', String(secret)).update(`${paymentId}|${subscriptionId}`).digest('hex');
function verifySubscriptionSignature({ paymentId, subscriptionId, signature }, secret) {
  if (!secret || !PAYMENT_ID.test(String(paymentId)) || !SUB_ID.test(String(subscriptionId)) || !SIGNATURE.test(String(signature))) return false;
  const a = Buffer.from(computeSubscriptionSignature(paymentId, subscriptionId, secret), 'hex'), b = Buffer.from(String(signature), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function readSubscriptionProof(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const paymentId = b.razorpay_payment_id, subscriptionId = b.razorpay_subscription_id, signature = b.razorpay_signature;
  if (typeof paymentId !== 'string' || !PAYMENT_ID.test(paymentId) || typeof subscriptionId !== 'string' || !SUB_ID.test(subscriptionId) || typeof signature !== 'string' || !SIGNATURE.test(signature)) return { problem: 'The payment details are incomplete or invalid.' };
  return { proof: { paymentId, subscriptionId, signature: signature.toLowerCase() } };
}

// ---------- request bodies (what we send to Razorpay) ----------
const planKey = (plan, cycle, amountPaise) => `${plan}:${cycle}:${amountPaise}`;
function planRequest({ plan, cycle, amountPaise, name }) {
  return { period: cycle, interval: 1, item: { name: String(name).slice(0, 80), amount: amountPaise, currency: 'INR', description: `${plan} plan, billed ${cycle}` }, notes: { kind: 'storva_plan', plan, cycle } };
}
// startAtMs only when it is at least 15 minutes ahead (a renewal that begins when the paid period ends); otherwise the first charge happens at checkout.
function subscriptionRequest({ planId, cycle, startAtMs = null, now = Date.now(), notes = {} }) {
  const body = { plan_id: planId, total_count: TOTAL_COUNT[cycle], quantity: 1, customer_notify: 1, notes: Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, String(v).slice(0, 250)])) };
  if (startAtMs && startAtMs - now >= MIN_START_LEAD_MS) body.start_at = Math.floor(startAtMs / 1000);
  return body;
}

// ---------- webhook parsing ----------
const int = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const date = (v) => (int(v) && v > 0 ? new Date(v * 1000) : null);
const note = (v) => (typeof v === 'string' ? v.slice(0, 60) : '');
// j = the already-parsed JSON body. -> { event, supported, subscription, payment?, eventAt } or { problem }
function parseSubscriptionEvent(j) {
  if (!SUBSCRIPTION_EVENTS.includes(j.event)) return { event: j.event, supported: false };
  const pl = j.payload && typeof j.payload === 'object' ? j.payload : {};
  const se = pl.subscription && pl.subscription.entity, pe = pl.payment && pl.payment.entity;
  if (!se || typeof se !== 'object' || typeof se.id !== 'string' || !SUB_ID.test(se.id)) return { problem: 'Invalid subscription entity.' };
  const n = se.notes && typeof se.notes === 'object' && !Array.isArray(se.notes) ? se.notes : {};
  const out = {
    event: j.event, supported: true, eventAt: int(j.created_at) ? j.created_at * 1000 : null,
    subscription: { id: se.id, planId: typeof se.plan_id === 'string' && PLAN_ID.test(se.plan_id) ? se.plan_id : null, status: typeof se.status === 'string' ? se.status : '', paidCount: int(se.paid_count) ? se.paid_count : null, currentEnd: date(se.current_end), notes: { kind: note(n.kind), store: note(n.store), plan: note(n.plan), cycle: note(n.cycle) } },
  };
  if (j.event === 'subscription.charged') {
    if (!pe || typeof pe !== 'object' || typeof pe.id !== 'string' || !PAYMENT_ID.test(pe.id) || !int(pe.amount) || typeof pe.currency !== 'string') return { problem: 'Invalid payment entity.' };
    out.payment = { id: pe.id, amount: pe.amount, currency: pe.currency, status: typeof pe.status === 'string' ? pe.status : '' };
  }
  return out;
}

// ---------- decision ----------
// row = { status, lastEventAt } snapshot of OUR subscription row. -> { action: 'apply' | 'noop' | 'ignore', reason, set? }
// A cancelled/completed subscription never comes back; an event older than the newest one we processed (webhooks can arrive out of order) is ignored.
function decideSubscriptionState(row, parsed) {
  const ev = parsed.event.slice('subscription.'.length), target = STATUS_OF[ev];
  const at = parsed.eventAt ? new Date(parsed.eventAt) : null;
  if (TERMINAL.has(row.status)) return { action: 'ignore', reason: 'subscription_already_ended' };
  if (at && row.lastEventAt && at.getTime() < new Date(row.lastEventAt).getTime()) return { action: 'ignore', reason: 'stale_event' };
  const set = {};
  if (at) set.lastEventAt = at;
  if (parsed.subscription.currentEnd) set.currentEnd = parsed.subscription.currentEnd;
  if (target && target !== row.status) set.status = target;
  if (ev === 'cancelled' || ev === 'completed') set.cancelAtCycleEnd = false; // it has actually ended now
  if (!set.status && !set.currentEnd) return { action: 'noop', reason: 'no_change' };
  return { action: 'apply', reason: ev, set };
}

module.exports = { SUBSCRIPTION_EVENTS, TOTAL_COUNT, MIN_START_LEAD_MS, computeSubscriptionSignature, verifySubscriptionSignature, readSubscriptionProof, planKey, planRequest, subscriptionRequest, parseSubscriptionEvent, decideSubscriptionState };
