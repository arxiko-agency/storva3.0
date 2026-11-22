'use strict';
// Tiny in-process domain event bus (Modules 8-14). Business code calls emit('order.created', {...}) after its own write succeeded;
// listeners (notifications, customers, analytics, WhatsApp) react. A failing listener is logged and never breaks the caller,
// and every listener must be idempotent (a dedupe key is part of each outbound message), because events can be re-emitted by repair jobs.
//
// Events and payloads (ids are strings or ObjectIds):
//   order.created        { storeId, orderId }
//   order.status_changed { storeId, orderId, from, to }
//   order.paid           { storeId, orderId }            (online payment verified / captured, or COD marked paid)
//   order.payment_failed { storeId, orderId }
//   order.refunded       { storeId, orderId, amountPaise, full }
//   order.refund_initiated { storeId, orderId, refundId, amountPaise, auto }   (Razorpay accepted a refund; auto = started by the cancel-order automation)
//   order.refund_failed  { storeId, orderId, refundId, amountPaise, auto, final }  (final = every automatic attempt failed: the owner must act)
//   stock.low            { storeId, productId, variantId, stock }
//   plan.activated       { storeId, plan, cycle, expiresAt, paymentId, amountPaise, source }
//   affiliate.commission_earned { affiliateId, commissionId, amountPaise }
//   plan.expiring        { storeId, plan, expiresAt, daysLeft }
//   plan.expired         { storeId, plan }
//   payment.issue        { storeId, orderNumber, message }
const listeners = new Map();
const pending = new Set();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
  return () => listeners.set(event, listeners.get(event).filter((f) => f !== fn));
}

// Fire-and-forget. Returns a promise that settles when every listener finished (tests and scripts can await it).
function emit(event, payload) {
  const fns = [...(listeners.get(event) || []), ...(listeners.get('*') || [])];
  const p = Promise.allSettled(fns.map((fn) => Promise.resolve().then(() => fn(payload, event)))).then((rs) => {
    rs.forEach((r) => { if (r.status === 'rejected') console.error(`[events] listener for ${event} failed:`, r.reason && r.reason.message); });
  });
  pending.add(p); p.finally(() => pending.delete(p));
  return p;
}
// Waits for every in-flight listener (used by tests and graceful shutdown).
const drain = async () => { while (pending.size) await Promise.allSettled([...pending]); };
const reset = () => listeners.clear();

module.exports = { on, emit, drain, reset };
