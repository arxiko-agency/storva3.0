'use strict';
// Module 13: turns domain events into in-app notifications, emails and WhatsApp messages, following each store's preferences
// (Store.notifications) and plan (WhatsApp messages need Pro or Advanced). Everything is deduplicated, so a repeated event never
// produces a second message. Owner contact: store contact email / WhatsApp number, falling back to the owner's login email / phone.
const Store = require('../models/Store');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const StoreDesign = require('../models/StoreDesign');
const outbox = require('./outbox');
const events = require('./events');
const M = require('../utils/messages');
const { env } = require('../config/env');
const { hasFeature } = require('../config/plans');

const PREF_DEFAULTS = { ownerEmail: { newOrder: true, paymentFailed: false, refund: true, lowStock: true, plan: true, issues: true, dailySummary: false }, ownerWhatsapp: { newOrder: true, lowStock: false }, buyerEmail: true, buyerWhatsapp: true, lowStockThreshold: 3 };
function prefs(store) {
  const n = (store.notifications && (typeof store.notifications.toObject === 'function' ? store.notifications.toObject() : store.notifications)) || {};
  return { ownerEmail: { ...PREF_DEFAULTS.ownerEmail, ...(n.ownerEmail || {}) }, ownerWhatsapp: { ...PREF_DEFAULTS.ownerWhatsapp, ...(n.ownerWhatsapp || {}) }, buyerEmail: n.buyerEmail !== false, buyerWhatsapp: n.buyerWhatsapp !== false, lowStockThreshold: Number.isInteger(n.lowStockThreshold) ? n.lowStockThreshold : 3 };
}
const orderLink = (store, o) => `${env.appUrl}/store/${store.slug}/order/${o.orderNumber}?t=${o.publicToken}`;
const dash = (hash) => `${env.appUrl}/dashboard${hash ? '#' + hash : ''}`;
async function brandColor(storeId) { const d = await StoreDesign.findOne({ store: storeId }).select('published.colors.primary').lean(); return d && d.published && d.published.colors ? d.published.colors.primary : undefined; }
async function ownerContact(store) {
  const u = await User.findById(store.owner).select('email phone emailVerified phoneVerified');
  return { email: store.contactEmail || (u && u.email) || '', phone: store.whatsappNumber || (u && u.phone) || '' };
}

async function inApp(store, n) {
  try { await Notification.create({ store: store._id, ...n }); } catch (e) { if (!(e && e.code === 11000)) throw e; }
}
const email = (store, audience, kind, to, msg, key) => (to ? outbox.enqueue({ store: store._id, channel: 'email', audience, kind, to, payload: msg, dedupeKey: key + ':email' }) : null);
const whatsapp = (store, audience, kind, to, msg, key) => (to && msg && hasFeature(store, 'whatsappNotifications') ? outbox.enqueue({ store: store._id, channel: 'whatsapp', audience, kind, to, payload: msg, dedupeKey: key + ':wa' }) : null);

async function load(storeId, orderId) {
  const [store, order] = await Promise.all([Store.findById(storeId), orderId ? Order.findOne({ _id: orderId, store: storeId }) : null]);
  return { store, order };
}

// ---------------- listeners ----------------
async function onOrderCreated({ storeId, orderId }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const p = prefs(store), key = `o:${order._id}:created`, link = orderLink(store, order), color = await brandColor(store._id);
  await inApp(store, { type: 'order.new', severity: 'success', title: `New order #${order.orderNumber} · ${M.inr(order.totalPaise)}`, body: `${order.customer.name} · ${M.itemsLine(order)}`, link: `#orders/${order.orderNumber}`, dedupeKey: key });
  const owner = await ownerContact(store), on = M.ownerNewOrder({ store, order, dashUrl: dash(`orders/${order.orderNumber}`) });
  if (p.ownerEmail.newOrder) await email(store, 'owner', 'new_order_alert', owner.email, on.email, key + ':owner');
  if (p.ownerWhatsapp.newOrder) await whatsapp(store, 'owner', 'new_order_alert', owner.phone, on.whatsapp, key + ':owner');
  const bc = M.orderConfirmation({ store, order, link, color });
  if (p.buyerEmail && order.customer.email) await email(store, 'buyer', 'order_confirmation', order.customer.email, { ...bc.email, replyTo: store.contactEmail || undefined }, key + ':buyer');
  if (p.buyerWhatsapp) await whatsapp(store, 'buyer', 'order_confirmation', order.customer.phone, bc.whatsapp, key + ':buyer');
}

async function onStatusChanged({ storeId, orderId, to }) {
  if (!['confirmed', 'shipped', 'delivered', 'cancelled'].includes(to)) return;
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const p = prefs(store), key = `o:${order._id}:status:${to}`, msg = M.orderUpdate({ store, order, status: to, link: orderLink(store, order), color: await brandColor(store._id) });
  if (p.buyerEmail && order.customer.email) await email(store, 'buyer', 'order_' + to, order.customer.email, msg.email, key + ':buyer');
  if (p.buyerWhatsapp) await whatsapp(store, 'buyer', 'order_' + to, order.customer.phone, msg.whatsapp, key + ':buyer');
}

async function onPaid({ storeId, orderId }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const key = `o:${order._id}:paid`;
  await inApp(store, { type: 'payment.received', severity: 'success', title: `Payment received for #${order.orderNumber}`, body: `${M.inr(order.totalPaise)} from ${order.customer.name}`, link: `#orders/${order.orderNumber}`, dedupeKey: key });
  if (order.paymentMethod === 'razorpay' && prefs(store).buyerEmail && order.customer.email) await email(store, 'buyer', 'payment_received', order.customer.email, M.paymentReceived({ store, order, link: orderLink(store, order), color: await brandColor(store._id) }).email, key + ':buyer');
}

async function onPaymentFailed({ storeId, orderId }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const key = `o:${order._id}:payfail:${order.paymentRev || 0}`;
  await inApp(store, { type: 'payment.failed', severity: 'warning', title: `Payment failed for #${order.orderNumber}`, body: `${order.customer.name} may try again. ${order.paymentError || ''}`.trim(), link: `#orders/${order.orderNumber}`, dedupeKey: key });
  if (prefs(store).ownerEmail.paymentFailed) { const o = await ownerContact(store); await email(store, 'owner', 'payment_failed', o.email, M.ownerSimple({ store, subject: `Payment failed · order #${order.orderNumber}`, title: 'A payment failed', body: `The online payment for order #${order.orderNumber} (${M.inr(order.totalPaise)}) failed. The buyer can retry from their order page.`, dashUrl: dash(`orders/${order.orderNumber}`) }).email, key + ':owner'); }
}

async function onRefunded({ storeId, orderId, refundId, amountPaise, full }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const key = `o:${order._id}:refund:${refundId || amountPaise}`, p = prefs(store);
  await inApp(store, { type: 'refund.processed', severity: 'info', title: `Refund processed for #${order.orderNumber}`, body: `${M.inr(amountPaise)}${full ? ' (full refund)' : ''}`, link: `#payments/${order.orderNumber}`, dedupeKey: key });
  const msg = M.refundProcessed({ store, order, amountPaise, link: orderLink(store, order), color: await brandColor(store._id) });
  if (p.buyerEmail && order.customer.email) await email(store, 'buyer', 'refund_processed', order.customer.email, msg.email, key + ':buyer');
  if (p.buyerWhatsapp) await whatsapp(store, 'buyer', 'refund_processed', order.customer.phone, msg.whatsapp, key + ':buyer');
  if (p.ownerEmail.refund) { const o = await ownerContact(store); await email(store, 'owner', 'refund_processed', o.email, M.ownerSimple({ store, subject: `Refund processed · order #${order.orderNumber}`, title: 'Refund processed', body: `Razorpay processed a refund of ${M.inr(amountPaise)} for order #${order.orderNumber}.`, dashUrl: dash(`payments/${order.orderNumber}`) }).email, key + ':owner'); }
}

async function onRefundInitiated({ storeId, orderId, refundId, amountPaise, auto }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const key = `o:${order._id}:refundstart:${refundId || amountPaise}`, p = prefs(store);
  await inApp(store, { type: 'refund.started', severity: 'info', title: `${auto ? 'Automatic refund' : 'Refund'} started for #${order.orderNumber}`, body: M.inr(amountPaise), link: `#payments/${order.orderNumber}`, dedupeKey: key });
  if (p.buyerEmail && order.customer.email) await email(store, 'buyer', 'refund_started', order.customer.email, M.refundInitiated({ store, order, amountPaise, link: orderLink(store, order), color: await brandColor(store._id) }).email, key + ':buyer');
}

// A refund failed at Razorpay (or every automatic attempt did). The owner always hears about it; the buyer only when no automatic attempt is left.
async function onRefundFailed({ storeId, orderId, refundId, amountPaise, auto, final, attempt }) {
  const { store, order } = await load(storeId, orderId); if (!store || !order) return;
  const key = `o:${order._id}:refundfail:${refundId || 'a' + (attempt || 0)}:${final ? 'final' : 'try'}`, p = prefs(store);
  await inApp(store, { type: 'refund.failed', severity: 'danger', title: final ? `Refund needs you: order #${order.orderNumber}` : `Refund attempt failed for #${order.orderNumber}`, body: final ? `${M.inr(amountPaise)} could not be refunded automatically. Refund it from the Payments tab or in Razorpay.` : `${M.inr(amountPaise)}${auto ? ' will be retried automatically.' : '. You can try again from the Payments tab.'}`, link: `#payments/${order.orderNumber}`, dedupeKey: key });
  if (final && p.ownerEmail.issues) { const o = await ownerContact(store); await email(store, 'owner', 'refund_failed', o.email, M.ownerSimple({ store, subject: `Refund needs your attention · order #${order.orderNumber}`, title: 'A refund could not be completed', body: `The automatic refund of ${M.inr(amountPaise)} for cancelled order #${order.orderNumber} failed after several attempts. Please refund it from the Payments tab or in your Razorpay dashboard.`, dashUrl: dash(`payments/${order.orderNumber}`) }).email, key + ':owner'); }
  if (final && p.buyerEmail && order.customer.email) await email(store, 'buyer', 'refund_delayed', order.customer.email, M.refundDelayed({ store, order, amountPaise, link: orderLink(store, order), color: await brandColor(store._id) }).email, key + ':buyer');
}

async function onLowStock({ storeId, productId, variantId, stock, title }) {
  const store = await Store.findById(storeId); if (!store) return;
  const day = new Date().toISOString().slice(0, 10), key = `ls:${productId}:${variantId || '-'}:${day}`, p = prefs(store);
  await inApp(store, { type: 'stock.low', severity: stock === 0 ? 'danger' : 'warning', title: stock === 0 ? `Sold out: ${title}` : `Low stock: ${title}`, body: stock === 0 ? 'Shoppers can no longer order it.' : `${stock} left`, link: `#products/${productId}`, dedupeKey: key });
  const owner = await ownerContact(store), msg = M.ownerLowStock({ store, title, stock, dashUrl: dash(`products/${productId}`) });
  if (p.ownerEmail.lowStock) await email(store, 'owner', 'low_stock', owner.email, msg.email, key);
  if (p.ownerWhatsapp.lowStock) await whatsapp(store, 'owner', 'low_stock', owner.phone, msg.whatsapp, key);
}

async function onPlan(payload, event) {
  const store = await Store.findById(payload.storeId); if (!store) return;
  const name = payload.plan === 'advanced' ? 'Advanced' : 'Pro';
  const when = payload.expiresAt ? new Date(payload.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
  const n = event === 'plan.activated' ? { severity: 'success', title: `${name} plan active until ${when}`, body: 'Thank you! All plan features are now on.', key: `plan:${store._id}:act:${new Date(payload.expiresAt).getTime()}` }
    : event === 'plan.expiring' ? { severity: 'warning', title: payload.daysLeft > 0 ? `Your ${name} plan ends in ${payload.daysLeft} day${payload.daysLeft === 1 ? '' : 's'}` : `Your ${name} plan has ended`, body: payload.daysLeft > 0 ? `Renew before ${when} to keep AI tools, coupons, WhatsApp alerts and your product limit.` : 'Paid features stay on for a few days. Renew now to keep them.', key: `plan:${store._id}:exp:${new Date(payload.expiresAt).getTime()}:${payload.daysLeft}` }
      : { severity: 'danger', title: `Your store is now on the Free plan`, body: 'Paid features are off. Products above the Free limit stay saved; upgrade any time to show them again.', key: `plan:${store._id}:expired:${Date.now() - (Date.now() % 864e5)}` };
  await inApp(store, { type: event, severity: n.severity, title: n.title, body: n.body, link: '#plan', dedupeKey: n.key });
  if (prefs(store).ownerEmail.plan) { const o = await ownerContact(store); await email(store, 'owner', event.replace('.', '_'), o.email, M.ownerSimple({ store, subject: n.title, title: n.title, body: n.body, dashUrl: dash('plan'), cta: event === 'plan.activated' ? 'Open dashboard' : 'Renew now' }).email, n.key); }
}

async function onIssue({ storeId, orderNumber, message, key }) {
  const store = await Store.findById(storeId); if (!store) return;
  const k = `issue:${key || orderNumber + ':' + message}`;
  await inApp(store, { type: 'payment.issue', severity: 'danger', title: `Payment needs review: order #${orderNumber}`, body: message, link: `#payments/${orderNumber}`, dedupeKey: k });
  if (prefs(store).ownerEmail.issues) { const o = await ownerContact(store); await email(store, 'owner', 'payment_issue', o.email, M.ownerSimple({ store, subject: `Payment needs review · order #${orderNumber}`, title: 'A payment needs your review', body: `${message} (order #${orderNumber}). Nothing was changed automatically.`, dashUrl: dash(`payments/${orderNumber}`) }).email, k); }
}

// Checks the products of an order after stock was taken and raises stock.low once per product per day.
async function checkLowStock(storeId, order) {
  const store = await Store.findById(storeId).select('notifications'); if (!store) return;
  const threshold = prefs(store).lowStockThreshold;
  const products = await Product.find({ store: storeId, _id: { $in: order.items.map((i) => i.product) }, trackInventory: true }).select('title stock variants');
  for (const it of order.items) {
    const p = products.find((x) => String(x._id) === String(it.product)); if (!p) continue;
    const v = it.variantId ? p.variants.id(it.variantId) : null;
    const stock = v ? v.stock : p.stock;
    if (stock <= threshold) events.emit('stock.low', { storeId, productId: p._id, variantId: v ? v._id : null, stock, title: v ? `${p.title} (${v.options.map((o) => o.value).join(' / ')})` : p.title });
  }
}

// Daily summary email at 21:00 India time for stores that turned it on.
async function dailySummaries(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  if (ist.getUTCHours() !== 21) return 0;
  const day = ist.toISOString().slice(0, 10), start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600e3);
  const stores = await Store.find({ 'notifications.ownerEmail.dailySummary': true, status: 'active' }).limit(5000);
  let n = 0;
  for (const store of stores) {
    const orders = await Order.find({ store: store._id, createdAt: { $gte: start, $lt: now }, status: { $ne: 'cancelled' } }).select('totalPaise');
    const revenue = orders.reduce((s, o) => s + o.totalPaise, 0);
    const o = await ownerContact(store);
    await email(store, 'owner', 'daily_summary', o.email, M.ownerSimple({ store, subject: `Today at ${store.name}: ${orders.length} order${orders.length === 1 ? '' : 's'} · ${M.inr(revenue)}`, title: 'Your day in numbers', body: `${orders.length} order${orders.length === 1 ? '' : 's'} today, worth ${M.inr(revenue)}.`, dashUrl: dash('analytics'), cta: 'See analytics' }).email, `daily:${store._id}:${day}`);
    n++;
  }
  return n;
}

let registered = false;
function register() {
  if (registered) return; registered = true;
  events.on('order.created', onOrderCreated);
  events.on('order.status_changed', onStatusChanged);
  events.on('order.paid', onPaid);
  events.on('order.payment_failed', onPaymentFailed);
  events.on('order.refunded', onRefunded);
  events.on('order.refund_initiated', onRefundInitiated);
  events.on('order.refund_failed', onRefundFailed);
  events.on('stock.low', onLowStock);
  ['plan.activated', 'plan.expiring', 'plan.expired'].forEach((e) => events.on(e, onPlan));
  events.on('payment.issue', onIssue);
}
function startDigestJob() { return require('./jobs').startJob('daily-summary', () => dailySummaries(), { intervalMs: 60 * 60 * 1000, firstDelayMs: 90 * 1000, enabled: process.env.OUTBOX_ENABLED !== 'false' }); }

module.exports = { register, prefs, PREF_DEFAULTS, checkLowStock, dailySummaries, startDigestJob, orderLink, onOrderCreated };
