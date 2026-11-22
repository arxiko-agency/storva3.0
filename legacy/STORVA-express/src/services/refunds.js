'use strict';
// Owner-initiated refunds (Module 6 step 4). Order of operations for every refund, and why:
//   1. validate everything server-side against the SAVED order (amount, state, previous and in-flight refunds)
//   2. RESERVE the money: push a 'pending' ledger entry with compare-and-set on paymentRev. Two clicks can never both pass this step for the same money,
//      and while an entry is in flight no other refund may start on the order.
//   3. call Razorpay with a stable idempotency key (X-Refund-Idempotency) derived from the entry, so a retry of the SAME request can never refund twice
//   4. record Razorpay's answer through the same pure decision the webhooks use (decideRefund), so the dashboard and webhooks always agree
// A clear refusal by Razorpay marks the entry 'failed' (money released, owner may try again). An unknown outcome (timeout / 5xx) leaves it 'pending',
// still reserved, and the owner retries THAT entry with the same key. The webhook adopts a pending entry if it arrives first.
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const { badRequest } = require('../utils/validate');
const { env } = require('../config/env');
const R = require('../utils/refundMath');
const W = require('../utils/razorpayWebhook');
const gateway = require('./razorpayApi');
const { applyToOrder } = require('./webhooks');
const { paymentApi } = require('../utils/paymentView');
const refundEvents = require('./refundEvents');

const MAX_TRIES = 5;
const STALE_MS = 30 * 1000; // a pending entry older than this is treated as abandoned by initiate (the explicit retry endpoint has no such wait)
const notFound = () => new AppError('Order not found.', 404, 'not_found');
const conflict = () => new AppError('This order was just changed. Reload and try again.', 409, 'conflict');

async function loadOrder(store, orderNumber) {
  const n = Number(orderNumber);
  if (!Number.isInteger(n) || n < 1001) throw notFound();
  const o = await Order.findOne({ store: store._id, orderNumber: n }); // store-scoped: another store's order is simply "not found"
  if (!o) throw notFound();
  return o;
}
const reload = (order) => Order.findOne({ _id: order._id, store: order.store });
const entryOf = (order, key) => (order.refunds || []).find((r) => r.idempotencyKey === key);
const plain = (r) => (typeof r.toObject === 'function' ? r.toObject() : { ...r });

// Compare-and-set edit of ONE ledger entry (found by idempotency key). Never overwrites a concurrent change.
async function editEntry(order, key, change) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const cur = i === 0 ? order : await reload(order);
    if (!cur) return null;
    const refunds = (cur.refunds || []).map(plain), at = refunds.findIndex((r) => r.idempotencyKey === key);
    if (at === -1) return cur;
    const next = change(refunds[at]);
    if (!next) return cur; // nothing to change (already settled by a webhook)
    refunds[at] = { ...refunds[at], ...next, updatedAt: new Date() };
    const upd = await Order.updateOne({ _id: cur._id, store: cur.store, ...R.revFilter(cur) }, { $set: { refunds }, $inc: { paymentRev: 1 } });
    if (upd.matchedCount) return reload(cur);
  }
  throw conflict();
}

// Sends the entry to Razorpay and records the outcome. Used by both "initiate" and "retry".
async function sendToGateway(store, order, entry) {
  const key = R.gatewayKeyFor(String(store._id), String(order._id), entry.idempotencyKey);
  let r;
  try {
    r = await gateway.createRefund({ paymentId: order.razorpayPaymentId, amountPaise: entry.amountPaise, idempotencyKey: key, receipt: `${store.slug}-${order.orderNumber}`.slice(0, 40), notes: { store: store.slug, orderNumber: String(order.orderNumber) } });
  } catch (e) {
    if (e && e.definite === true) { // refused: release the reserved money
      await editEntry(order, entry.idempotencyKey, (x) => (x.status === 'pending' && !x.refundId ? { status: 'failed', error: 'Razorpay refused this refund.' } : null));
    } else if (e instanceof AppError) { // unknown outcome: keep it reserved, remember why
      await editEntry(order, entry.idempotencyKey, (x) => (x.status === 'pending' && !x.refundId ? { error: 'Waiting for Razorpay to confirm. Retry to check.' } : null)).catch(() => {});
    }
    throw e;
  }
  if (r.amount !== entry.amountPaise || (r.paymentId && r.paymentId !== order.razorpayPaymentId)) {
    // Razorpay returned something other than what we asked for. Do NOT guess: keep it reserved and flag it for a human.
    console.error('[refund] gateway answer does not match the request for order', order.orderNumber);
    await editEntry(order, entry.idempotencyKey, (x) => (x.status === 'pending' && !x.refundId ? { error: 'Unexpected answer from Razorpay. Check your Razorpay dashboard.' } : null)).catch(() => {});
    throw new AppError('The payment provider returned an unexpected refund. Check your Razorpay dashboard before trying again.', 502, 'gateway_mismatch');
  }
  // Same pure decision the webhook uses. If the webhook already adopted our entry this is a harmless no-op.
  const rf = { id: r.id, paymentId: order.razorpayPaymentId, amount: r.amount, status: R.ledgerStatusOf(r.status) };
  const beforeApply = await reload(order);
  await applyToOrder(() => reload(order), (o) => W.decideRefund(o, rf));
  const fresh = await reload(order);
  refundEvents.announce(beforeApply, fresh); // tell the buyer / owner (deduplicated, so a webhook doing the same is harmless)
  await editEntry(fresh, entry.idempotencyKey, (x) => (x.error ? { error: '' } : null)).catch(() => {});
}

// input = { type, amount, reason, idempotencyKey } -> { replayed, refund, payment }
// opts.source = 'auto' is set ONLY by services/autoRefund.js (cancelled paid orders); it can never come from a request body, and `user` may then be null.
async function initiateRefund(store, user, orderNumber, input, opts = {}) {
  const source = opts.source === 'auto' ? 'auto' : 'dashboard';
  const key = input && typeof input.idempotencyKey === 'string' ? input.idempotencyKey : '';
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const order = await loadOrder(store, orderNumber);
    // Replay: the same request key again (double click, network retry, page reload) never creates a second refund.
    const prior = key && entryOf(order, key);
    if (prior) {
      const same = input.type === 'full' ? true : R.parseRupeesToPaise(input.amount) === prior.amountPaise;
      if (!same) throw new AppError('This request key was already used for a different refund amount. Reload the page and try again.', 409, 'key_reused');
      // Only re-ask Razorpay if the first attempt looks abandoned. A fresh pending entry belongs to a request that is still running (a double click): just report its state.
      if (prior.status === 'pending' && !prior.refundId && Date.now() - new Date(prior.createdAt).getTime() > STALE_MS) { try { await sendToGateway(store, order, prior); } catch (e) { if (!(e instanceof AppError)) throw e; if (e.definite !== false) throw e; } } // unknown earlier outcome: ask Razorpay again with the same key
      return result(order, key, true);
    }
    const elig = R.refundEligibility(order);
    if (!elig.ok) throw new AppError(elig.message, elig.status, elig.code);
    const rf = R.refundable(order);
    if (rf.hasInFlight) throw new AppError('A refund is already in progress on this order. Wait for it to finish, or retry it, before starting another.', 409, 'refund_in_progress');
    const { value, fields } = R.readRefundInput(input, rf.refundablePaise);
    if (fields) throw badRequest(fields);
    if (!env.razorpay.enabled) throw new AppError('Refunds are not available right now: online payments are not configured.', 503, 'payments_unavailable');

    const now = new Date();
    const entry = { refundId: null, amountPaise: value.amountPaise, status: 'pending', createdAt: now, updatedAt: now, idempotencyKey: value.idempotencyKey, reason: value.reason, source, requestedBy: user ? user._id : null, error: '' };
    const res = await Order.updateOne(
      { _id: order._id, store: store._id, paymentStatus: 'paid', ...R.revFilter(order) },
      { $push: { refunds: entry }, $inc: { paymentRev: 1 } });
    if (!res.matchedCount) continue; // somebody (a webhook, another click) changed the order between read and write: re-read and re-validate everything
    console.info(`[refund] reserved (${source}) store=${store._id} order=#${order.orderNumber} paise=${entry.amountPaise}`);
    const reserved = await reload(order);
    try { await sendToGateway(store, reserved, entry); } catch (e) {
      if (e instanceof AppError) { e.details = { payment: paymentApi(await reload(order), { detail: true }) }; }
      throw e;
    }
    return result(order, key, false);
  }
  throw conflict();
}

async function result(order, key, replayed) {
  const fresh = await reload(order);
  const e = entryOf(fresh, key);
  return { replayed, refund: e ? paymentApi(fresh, { detail: true }).refunds.find((x) => x.idempotencyKey === key) : null, payment: paymentApi(fresh, { detail: true }) };
}

// Re-sends an entry whose outcome was never confirmed (still 'pending', no gateway id). Same key -> Razorpay cannot refund twice.
async function retryRefund(store, orderNumber, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw new AppError('Refund not found.', 404, 'not_found');
  const order = await loadOrder(store, orderNumber), entry = entryOf(order, key);
  if (!entry) throw new AppError('Refund not found.', 404, 'not_found');
  if (entry.status !== 'pending' || entry.refundId) throw new AppError('This refund is already confirmed or finished. Nothing to retry.', 409, 'nothing_to_retry');
  if (!env.razorpay.enabled) throw new AppError('Refunds are not available right now: online payments are not configured.', 503, 'payments_unavailable');
  try { await sendToGateway(store, order, plain(entry)); } catch (e) {
    if (e instanceof AppError) e.details = { payment: paymentApi(await reload(order), { detail: true }) };
    throw e;
  }
  return result(order, key, false);
}

module.exports = { initiateRefund, retryRefund, loadOrder };
