'use strict';
// The ONLY place that talks to Razorpay's server API, and the only place that reads the secret. Uses Node's built-in fetch (no SDK dependency).
const AppError = require('../utils/AppError');
const { env } = require('../config/env');

const BASE = 'https://api.razorpay.com/v1';

// -> { id, amount, currency }. Never leaks Razorpay's raw error text or any credential to the shopper.
async function createOrder({ amountPaise, receipt, notes }) {
  const { keyId, keySecret } = env.razorpay;
  let res;
  try {
    res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError('We could not reach the payment provider. Please try again.', 503, 'gateway_unreachable');
  }
  let data = null; try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !data || typeof data.id !== 'string') {
    console.error('[razorpay] order creation failed with HTTP', res.status, data && data.error ? data.error.code : '');
    throw new AppError('The payment provider could not start this payment. Please try again.', res.status >= 500 || res.status === 429 ? 503 : 502, 'gateway_error');
  }
  return { id: data.id, amount: data.amount, currency: data.currency };
}

const authHeader = () => 'Basic ' + Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64');

// Refund (full or partial) for a captured payment. `idempotencyKey` is sent as X-Refund-Idempotency so a retry of the SAME request can never refund twice.
// -> { id, paymentId, amount, status }. Throws AppError with `.definite = true` when Razorpay clearly REFUSED (safe to mark failed and let the owner try again)
// and `.definite = false` when the outcome is UNKNOWN (timeout, network, 5xx, 429): the caller must keep the refund reserved and retry with the same key.
async function createRefund({ paymentId, amountPaise, idempotencyKey, receipt, notes }) {
  let res;
  try {
    res = await fetch(`${BASE}/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader(), 'X-Refund-Idempotency': idempotencyKey },
      body: JSON.stringify({ amount: amountPaise, speed: 'normal', receipt, notes }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    const e = new AppError('We could not reach the payment provider, so the refund status is unknown. Retry it from this page: it will not refund twice.', 503, 'gateway_unreachable'); e.definite = false; throw e;
  }
  let data = null; try { data = await res.json(); } catch { /* handled below */ }
  if (res.ok && data && typeof data.id === 'string' && /^rfnd_[A-Za-z0-9]{6,40}$/.test(data.id) && Number.isSafeInteger(data.amount)) {
    return { id: data.id, paymentId: data.payment_id, amount: data.amount, status: typeof data.status === 'string' ? data.status : 'pending' };
  }
  const code = data && data.error ? String(data.error.code || '') : '';
  console.error('[razorpay] refund failed with HTTP', res.status, code);
  if (res.status >= 500 || res.status === 429 || res.ok) { const e = new AppError('The payment provider did not confirm the refund, so its status is unknown. Retry it from this page: it will not refund twice.', 503, 'gateway_error'); e.definite = false; throw e; }
  // 4xx: Razorpay refused. Show a short fixed explanation, never the raw gateway text.
  const e = new AppError(res.status === 401 || res.status === 403 ? 'The payment provider rejected our credentials. Contact support.' : 'The payment provider refused this refund. Check the amount and the payment status in your Razorpay dashboard.', 502, 'refund_rejected'); e.definite = true; e.gatewayCode = code.slice(0, 40); throw e;
}

// ---------- read-only calls used by payment reconciliation ----------
// GET helper. Every failure is classified so the caller can decide safely: kind = 'auth' (our keys were rejected: stop the whole run), 'not_found',
// 'transient' (network, timeout, 429, 5xx: try again later, change nothing) or 'bad_response' (unreadable answer: change nothing, report it).
async function getJson(path) {
  let res;
  try { res = await fetch(`${BASE}${path}`, { method: 'GET', headers: { authorization: authHeader() }, signal: AbortSignal.timeout(10000) }); }
  catch { const e = new AppError('Could not reach the payment provider.', 503, 'gateway_unreachable'); e.kind = 'transient'; throw e; }
  let data = null; try { data = await res.json(); } catch { /* handled below */ }
  const fail = (kind, status, code) => { const e = new AppError('The payment provider could not answer this request.', status, code); e.kind = kind; return e; };
  if (res.status === 401 || res.status === 403) { console.error('[razorpay] read request rejected with HTTP', res.status); throw fail('auth', 502, 'gateway_auth'); }
  if (res.status === 404) throw fail('not_found', 404, 'gateway_not_found');
  if (res.status === 429 || res.status >= 500) throw fail('transient', 503, 'gateway_error');
  if (!res.ok || !data || typeof data !== 'object' || !Array.isArray(data.items)) throw fail('bad_response', 502, 'gateway_error');
  return data.items; // raw items: the caller validates every field
}
// All payment attempts for one Razorpay order (GET /orders/:id/payments). -> raw items
const fetchOrderPayments = (razorpayOrderId) => getJson(`/orders/${encodeURIComponent(razorpayOrderId)}/payments`);
// All refunds of one payment (GET /payments/:id/refunds). -> raw items
const fetchPaymentRefunds = (paymentId) => getJson(`/payments/${encodeURIComponent(paymentId)}/refunds?count=100`);

// ---------- Subscriptions (auto-renew plans) ----------
// One JSON call; never leaks Razorpay's raw error text or any credential. Every object we ask for has an `id`.
async function callObject(method, path, body, what) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', authorization: authHeader() }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch { throw new AppError('We could not reach the payment provider. Please try again.', 503, 'gateway_unreachable'); }
  let data = null; try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !data || typeof data.id !== 'string') {
    console.error(`[razorpay] ${what} failed with HTTP`, res.status, data && data.error ? `${data.error.code || ''} ${String(data.error.description || '').slice(0, 120)}` : '');
    throw new AppError(`The payment provider could not ${what}. Please try again, or pay for one period instead.`, res.status >= 500 || res.status === 429 ? 503 : 502, 'gateway_error');
  }
  return data;
}
// -> { id }. Body built by utils/razorpaySubscription.planRequest.
const createPlan = async (body) => { const d = await callObject('POST', '/plans', body, 'create the billing plan'); return { id: d.id }; };
// -> { id, status }. Body built by utils/razorpaySubscription.subscriptionRequest.
const createSubscription = async (body) => { const d = await callObject('POST', '/subscriptions', body, 'start auto-renew'); return { id: d.id, status: typeof d.status === 'string' ? d.status : 'created' }; };
// atCycleEnd = true keeps charging-free access until the current paid period ends (only valid for an active subscription).
const cancelSubscription = async (subscriptionId, atCycleEnd) => { const d = await callObject('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }, 'cancel auto-renew'); return { id: d.id, status: typeof d.status === 'string' ? d.status : '' }; };

module.exports = { createOrder, createRefund, fetchOrderPayments, fetchPaymentRefunds, createPlan, createSubscription, cancelSubscription };
