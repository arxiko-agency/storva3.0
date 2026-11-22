'use strict';
// Turns "what changed in an order's refund ledger" into domain events, so every path that moves a refund forward (dashboard refund, automatic refund,
// Razorpay webhook, reconciliation) tells the buyer and the owner the same way. Safe to call any number of times: the notification listeners are
// deduplicated by refund id, so a repeated event never produces a second message.
//   order.refund_initiated { storeId, orderId, refundId, amountPaise, auto }   Razorpay accepted a refund that is not finished yet (or finished at once)
//   order.refunded         { storeId, orderId, refundId, amountPaise, full }   the refund was processed
//   order.refund_failed    { storeId, orderId, refundId, amountPaise, auto, final }   Razorpay failed it; final = no automatic attempts are left
const events = require('./events');

const plain = (r) => (r && typeof r.toObject === 'function' ? r.toObject() : r);
const entries = (order) => ((order && order.refunds) || []).map(plain);

// before / after: order documents (before may be null). Emits one event per ledger entry whose status moved forward.
function announce(before, after, { final = false } = {}) {
  if (!after) return [];
  const prev = new Map(entries(before).filter((r) => r.refundId).map((r) => [r.refundId, r]));
  const out = [];
  for (const e of entries(after)) {
    if (!e.refundId) continue;
    const was = prev.get(e.refundId), was_status = was ? was.status : null;
    if (was_status === e.status) continue;
    const base = { storeId: after.store, orderId: after._id, refundId: e.refundId, amountPaise: e.amountPaise, auto: e.source === 'auto' };
    if (e.status === 'created' && !was) out.push(['order.refund_initiated', base]);
    else if (e.status === 'processed') {
      if (!was) out.push(['order.refund_initiated', base]);
      out.push(['order.refunded', { ...base, full: (after.refundedPaise || 0) >= after.totalPaise }]);
    } else if (e.status === 'failed') out.push(['order.refund_failed', { ...base, final }]);
  }
  out.forEach(([name, payload]) => events.emit(name, payload));
  return out.map(([name]) => name);
}

module.exports = { announce };
