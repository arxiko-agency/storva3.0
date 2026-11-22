'use strict';
// Payment reconciliation (Module 6 step 4, part 2). Asks Razorpay about online orders whose local state may have been missed by the browser
// verify call AND the webhooks (webhook not configured, delivery failed for a day, server was down), and corrects them SAFELY.
//
// How it stays safe:
//   * It only ever MOVES FORWARD. Changes go through the very same pure decisions the webhooks use (decideCaptured / decideFailed / decideRefund) and the same
//     compare-and-set writer (applyToOrder, guarded by paymentRev). A paid or refunded order cannot be downgraded: the decisions refuse it, and X.safeDecide
//     re-checks every change as a second safety net. If anything changed the order after we read it, the write is re-decided from the fresh state.
//   * It is idempotent. A second run (or two runs at once) finds the order already settled and does nothing: "noop:already_paid" and so on.
//   * It never trusts Razorpay's answer blindly: ids, amounts, currency and order/payment ownership are validated; a mismatch changes nothing and is logged
//     as a ReconciliationIssue for a human.
//   * It never creates money movement: it only READS from Razorpay (GET). It never refunds, captures or cancels, and never touches stock or order status.
//   * Gateway trouble (timeouts, 429, 5xx) changes nothing and is retried on a later run; rejected credentials stop the whole run.
const Order = require('../models/Order');
const Issue = require('../models/ReconciliationIssue');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');
const W = require('../utils/razorpayWebhook');
const X = require('../utils/reconcile');
const gateway = require('./razorpayApi');
const { applyToOrder } = require('./webhooks');

const CLOSED_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_REPORT_ROWS = 100;
const MAX_CONSECUTIVE_TRANSIENT = 3;
class AbortRun extends Error { constructor(reason) { super(reason); this.reason = reason; } }

const thresholds = (over = {}) => ({ ...X.DEFAULTS, ...(env.reconcile ? { minAgeMs: env.reconcile.minAgeMs } : {}), ...over });
const issueKey = (order, code, ref) => `${order._id}:${code}:${ref || ''}`.slice(0, 200);

// ---------- writing ----------
// Applies a decision with compare-and-set, or only previews it in dry-run mode. Same outcome strings either way.
async function run(lookup, decide, ctx) {
  const safe = X.safeDecide(decide);
  if (!ctx.dryRun) return applyToOrder(lookup, safe);
  const order = await lookup();
  if (!order) return { outcome: 'ignored:order_not_found', order: null };
  const d = safe(order);
  return { outcome: d.action === 'apply' ? 'would_apply:' + d.reason : (d.action === 'noop' ? 'noop:' : 'ignored:') + d.reason, order };
}

function note(report, pass, outcome, ref) {
  if (outcome.startsWith('applied:') || outcome.startsWith('would_apply:')) report.changes.push(outcome);
  else if (outcome.startsWith('ignored:')) {
    const code = outcome.slice('ignored:'.length);
    if (code === 'order_not_found') report.skipped = 'order_not_found'; // the order vanished (store deleted) between listing and checking
    else report.issues.push({ code, ref: ref || '', detail: ref ? `reference ${ref}` : '', pass });
  } else report.unchanged += 1;
}

// A discrepancy we will NOT fix automatically. Idempotent: one row per (order, code, reference).
async function recordIssue(order, issue, ctx) {
  const key = issueKey(order, issue.code, issue.ref), text = X.ISSUE_TEXT[issue.code] || X.ISSUE_TEXT.unknown, detail = String(issue.detail || '').slice(0, 300);
  const label = `store=${order.store} order=#${order.orderNumber} code=${issue.code}${detail ? ' ' + detail : ''}`;
  if (ctx.dryRun) { console.warn('[reconcile] (dry run) discrepancy ' + label); return key; }
  const now = ctx.now;
  await Issue.updateOne({ store: order.store, key, status: 'resolved' }, { $set: { status: 'open', resolvedAt: null, expireAt: null } }); // it came back: reopen (a dismissed one stays dismissed)
  const doc = { $setOnInsert: { orderId: order._id, orderNumber: order.orderNumber, code: issue.code, message: text, firstSeenAt: now, status: 'open' }, $set: { lastSeenAt: now, detail }, $inc: { occurrences: 1 } };
  let up;
  try { up = await Issue.updateOne({ store: order.store, key }, doc, { upsert: true }); }
  catch (e) { if (!(e && e.code === 11000)) throw e; up = await Issue.updateOne({ store: order.store, key }, doc, { upsert: true }); } // two runs created it at the same moment
  if (up && up.upsertedCount) { console.warn('[reconcile] DISCREPANCY needs review: ' + label); require('./events').emit('payment.issue', { storeId: order.store, orderNumber: order.orderNumber, message: text, key }); } // Module 13: tell the owner once
  return key;
}
// Closes issues of the passes that completed and did not see them again (e.g. Razorpay answered later, the refund finally appeared).
async function closeCleared(order, passes, observed, ctx) {
  if (ctx.dryRun) return;
  for (const pass of passes) {
    await Issue.updateMany({ store: order.store, orderId: order._id, status: 'open', code: { $in: X.AUTO_RESOLVE[pass] }, key: { $nin: observed } },
      { $set: { status: 'resolved', resolvedAt: ctx.now, expireAt: new Date(ctx.now.getTime() + CLOSED_TTL_MS) } });
  }
}

// ---------- reading Razorpay ----------
// -> true when Razorpay gave a usable answer (the order counts as checked), false for trouble that should simply be retried later.
function gatewayProblem(e, report, pass) {
  if (!e || !e.kind) throw e;
  if (e.kind === 'auth') throw new AbortRun('gateway_auth');
  if (e.kind === 'transient') { report.error = 'gateway_unavailable'; return false; }
  report.issues.push({ code: e.kind === 'not_found' ? 'gateway_order_not_found' : 'gateway_bad_response', ref: '', detail: e.kind === 'not_found' ? 'Razorpay answered 404' : 'unreadable answer', pass });
  return true;
}

async function paymentPass(order, ctx, report) {
  const lookup = () => Order.findOne({ _id: order._id, store: order.store });
  let items; try { items = await gateway.fetchOrderPayments(order.razorpayOrderId); } catch (e) { return { checked: gatewayProblem(e, report, 'payment'), syncRefunds: false }; }
  const payments = items.map(X.parseGatewayPayment).filter(Boolean);
  if (payments.length !== items.length) report.issues.push({ code: 'gateway_bad_response', ref: '', detail: `${items.length - payments.length} unreadable payment record(s)`, pass: 'payment' });
  const plan = X.planPayment(order, payments);
  plan.issues.forEach((i) => report.issues.push({ ...i, pass: 'payment' }));
  let syncRefunds = false;
  for (const a of plan.actions) {
    const decide = a.kind === 'captured' ? (o) => W.decideCaptured(o, a.pay) : (o) => W.decideFailed(o, a.pay);
    const r = await run(lookup, decide, ctx);
    note(report, 'payment', r.outcome, a.pay.id);
    if (a.kind === 'captured' && a.pay.amountRefunded > 0) syncRefunds = true; // a capture that was already (partly) refunded: bring the refund ledger up to date too
  }
  report.passes.push('payment');
  return { checked: true, syncRefunds };
}

async function refundPass(order, ctx, report) {
  const lookup = () => Order.findOne({ _id: order._id, store: order.store });
  const fresh = await lookup();
  if (!fresh || !fresh.razorpayPaymentId) return false;
  let items; try { items = await gateway.fetchPaymentRefunds(fresh.razorpayPaymentId); } catch (e) { return gatewayProblem(e, report, 'refund'); }
  const refunds = items.map(X.parseGatewayRefund).filter(Boolean);
  if (refunds.length !== items.length) report.issues.push({ code: 'gateway_bad_response', ref: '', detail: `${items.length - refunds.length} unreadable refund record(s)`, pass: 'refund' });
  const plan = X.planRefunds(fresh, refunds, ctx.now.getTime(), ctx.t);
  plan.issues.forEach((i) => report.issues.push({ ...i, pass: 'refund' }));
  for (const a of plan.actions) { const r = await run(lookup, (o) => W.decideRefund(o, a.rf), ctx); note(report, 'refund', r.outcome, a.rf.id); }
  if (!ctx.dryRun && report.changes.length) require('./refundEvents').announce(fresh, await lookup()); // Razorpay finished a refund we only knew as 'in progress': tell the buyer / owner
  report.passes.push('refund');
  return true;
}

// ---------- one order ----------
async function reconcileOrder(order, ctx) {
  const report = { orderNumber: order.orderNumber, store: String(order.store), pass: '', changes: [], unchanged: 0, issues: [], passes: [], skipped: null, error: null };
  let checked = false;
  if (X.PAYMENT_STATES.includes(order.paymentStatus)) {
    report.pass = 'payment';
    const r = await paymentPass(order, ctx, report); checked = r.checked;
    if (r.checked && r.syncRefunds) await refundPass(order, ctx, report);
  } else if (order.paymentStatus === 'paid') {
    report.pass = 'refund'; checked = await refundPass(order, ctx, report);
  } else report.skipped = 'nothing_to_check'; // refunded (final) or unpaid cash order: nothing can be moved forward
  if (checked) {
    const observed = [];
    for (const i of report.issues) observed.push(await recordIssue(order, i, ctx));
    await closeCleared(order, report.passes, observed, ctx);
    if (!ctx.dryRun) await Order.updateOne({ _id: order._id, store: order.store }, { $set: { reconcileCheckedAt: ctx.now } }, { timestamps: false }); // scheduling hint only; not payment state, no paymentRev bump
  }
  return report;
}

// ---------- the job ----------
// opts: { dryRun, limit, now, ...threshold overrides }. Safe to run any time, as often as you like, from several places at once.
async function reconcileBatch(opts = {}) {
  const t = thresholds(opts.thresholds), now = opts.now ? new Date(opts.now) : new Date();
  const ctx = { now, dryRun: Boolean(opts.dryRun), t };
  const summary = { dryRun: ctx.dryRun, startedAt: now, scanned: 0, applied: 0, unchanged: 0, issues: 0, errors: 0, aborted: null, orders: [] };
  if (!env.razorpay.enabled) { summary.aborted = 'payments_not_configured'; return summary; }
  const limit = Math.min(Math.max(Number(opts.limit) || (env.reconcile && env.reconcile.batch) || 50, 1), 200), nowMs = now.getTime();
  const find = (filter) => Order.find(filter).setOptions({ skipTenant: true }).sort({ reconcileCheckedAt: 1, createdAt: 1 }).limit(limit); // platform job: the ONLY cross-store read; every write below is store-scoped
  const candidates = [
    ...(await find(X.stuckPaymentFilter(nowMs, t))).filter((o) => X.isStuckPayment(o, nowMs, t)),
    ...(await find(X.stuckRefundFilter(nowMs, t))).filter((o) => X.isStuckRefund(o, nowMs, t)),
  ];
  let transient = 0;
  for (const order of candidates) {
    summary.scanned += 1;
    try {
      const rep = await reconcileOrder(order, ctx);
      transient = rep.error ? transient + 1 : 0;
      if (rep.error) summary.errors += 1;
      summary.applied += rep.changes.length; summary.unchanged += rep.unchanged; summary.issues += rep.issues.length;
      if (summary.orders.length < MAX_REPORT_ROWS) summary.orders.push({ orderNumber: rep.orderNumber, store: rep.store, pass: rep.pass, changes: rep.changes, issues: rep.issues.map((i) => i.code), error: rep.error, skipped: rep.skipped });
      if (transient >= MAX_CONSECUTIVE_TRANSIENT) { summary.aborted = 'gateway_unavailable'; break; } // Razorpay looks down: stop hammering it, try again next run
    } catch (e) {
      if (e instanceof AbortRun) { summary.aborted = e.reason; console.error('[reconcile] stopped: Razorpay rejected our credentials (check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET and test/live mode)'); break; }
      summary.errors += 1; console.error(`[reconcile] order #${order.orderNumber} (store ${order.store}) failed:`, e && e.message);
    }
  }
  summary.finishedAt = new Date();
  if (summary.scanned || summary.aborted) console.info(`[reconcile] ${ctx.dryRun ? '(dry run) ' : ''}scanned=${summary.scanned} applied=${summary.applied} unchanged=${summary.unchanged} issues=${summary.issues} errors=${summary.errors}${summary.aborted ? ' aborted=' + summary.aborted : ''}`);
  return summary;
}

// ---------- owner actions ("Check with Razorpay" button) ----------
const notFound = () => new AppError('Order not found.', 404, 'not_found');
async function reconcileOne(store, orderNumber) {
  const n = Number(orderNumber);
  if (!Number.isInteger(n) || n < 1001) throw notFound();
  const order = await Order.findOne({ store: store._id, orderNumber: n }); // store-scoped: another store's order is simply "not found"
  if (!order) throw notFound();
  if (order.paymentMethod !== 'razorpay') throw new AppError('Only online (Razorpay) payments can be checked with Razorpay.', 400, 'not_online_order');
  if (!env.razorpay.enabled) throw new AppError('Online payments are not configured, so Razorpay cannot be checked.', 503, 'payments_unavailable');
  if (X.PAYMENT_STATES.includes(order.paymentStatus) && !order.razorpayOrderId) throw new AppError('No online payment was ever started for this order, so there is nothing to check.', 409, 'nothing_to_reconcile');
  const ctx = { now: new Date(), dryRun: false, t: { ...thresholds(), refundMinAgeMs: 0 } };
  let rep;
  try { rep = await reconcileOrder(order, ctx); } catch (e) { if (e instanceof AbortRun) throw new AppError('Razorpay rejected our credentials. Contact support.', 502, 'gateway_auth'); throw e; }
  if (rep.error) throw new AppError('Razorpay could not be reached. Nothing was changed; please try again in a moment.', 503, 'gateway_unreachable');
  return { changed: rep.changes.length > 0, changes: rep.changes, issues: rep.issues.map((i) => ({ code: i.code, message: X.ISSUE_TEXT[i.code] || X.ISSUE_TEXT.unknown })), nothingToCheck: rep.skipped === 'nothing_to_check', order: await Order.findOne({ _id: order._id, store: order.store }) };
}

async function listIssues(store) { return (await Issue.find({ store: store._id, status: 'open' }).sort({ lastSeenAt: -1 }).limit(50)).map((i) => i.toOwnerApi()); }
async function dismissIssue(store, user, issueId) {
  if (typeof issueId !== 'string' || !/^[a-f0-9]{24}$/i.test(issueId)) throw new AppError('Issue not found.', 404, 'not_found');
  const now = new Date();
  const done = await Issue.findOneAndUpdate({ _id: issueId, store: store._id, status: 'open' }, { $set: { status: 'dismissed', dismissedAt: now, dismissedBy: user._id, expireAt: new Date(now.getTime() + CLOSED_TTL_MS) } }, { new: true });
  if (!done) throw new AppError('Issue not found.', 404, 'not_found');
  return { ok: true };
}

module.exports = { reconcileBatch, reconcileOne, reconcileOrder, listIssues, dismissIssue, AbortRun };
