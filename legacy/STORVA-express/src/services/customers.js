'use strict';
// Module 11: keeps Customer records in sync with orders. Every order event recomputes that buyer's record from their orders,
// so the numbers are always exactly what the orders say (idempotent, safe to repeat, self-healing).
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const events = require('./events');

const sameAddr = (a, b) => a && b && ['line1', 'city', 'pincode'].every((k) => String(a[k] || '').trim().toLowerCase() === String(b[k] || '').trim().toLowerCase());

async function recompute(storeId, phone) {
  if (!storeId || !phone || /^0+$/.test(phone)) return null; // 0000000000 = anonymised (erased) orders
  const orders = await Order.find({ store: storeId, 'customer.phone': phone }).sort({ createdAt: -1 }).limit(500)
    .select('orderNumber status totalPaise refundedPaise createdAt customer shipping');
  const existing = await Customer.findOne({ store: storeId, phone });
  if (!orders.length) { if (existing && !existing.notes && !existing.tags.length && !existing.codBlocked) await Customer.deleteOne({ store: storeId, _id: existing._id }); return null; }
  const live = orders.filter((o) => o.status !== 'cancelled');
  const latest = orders[0];
  const addresses = [];
  for (const o of orders) { if (o.shipping && o.shipping.line1 && !addresses.some((a) => sameAddr(a, o.shipping)) && addresses.length < 3) addresses.push({ ...(typeof o.shipping.toObject === 'function' ? o.shipping.toObject() : o.shipping), lastUsedAt: o.createdAt }); }
  const set = {
    name: latest.customer.name || '', email: orders.find((o) => o.customer.email)?.customer.email || '', addresses,
    orderCount: live.length, cancelledCount: orders.length - live.length,
    totalSpentPaise: live.reduce((s, o) => s + Math.max(0, o.totalPaise - (o.refundedPaise || 0)), 0),
    firstOrderAt: orders[orders.length - 1].createdAt, lastOrderAt: latest.createdAt, lastOrderNumber: latest.orderNumber, erasedAt: null,
  };
  try { return await Customer.findOneAndUpdate({ store: storeId, phone }, { $set: set, $setOnInsert: { store: storeId, phone } }, { upsert: true, new: true }); }
  catch (e) { if (e && e.code === 11000) return Customer.findOneAndUpdate({ store: storeId, phone }, { $set: set }, { new: true }); throw e; }
}

async function fromOrderEvent({ storeId, orderId }) {
  const o = await Order.findOne({ _id: orderId, store: storeId }).select('customer.phone');
  if (o) await recompute(storeId, o.customer.phone);
}

// Builds every customer of a store from its orders (first visit to the Customers tab, or the "Rebuild" button).
async function rebuildStore(storeId) {
  const phones = await Order.distinct('customer.phone', { store: storeId });
  let n = 0;
  for (const p of phones.slice(0, 20000)) { if (await recompute(storeId, p)) n++; }
  return n;
}

// Cash on delivery blocked for this buyer by the owner?
async function codBlocked(storeId, phone) { return Boolean(await Customer.exists({ store: storeId, phone, codBlocked: true })); }

// Data-protection request: remove a buyer's personal data. Orders stay (the shop needs them for accounts/GST) but are anonymised.
async function erase(storeId, customer) {
  const open = await Order.countDocuments({ store: storeId, 'customer.phone': customer.phone, status: { $in: ['pending', 'confirmed', 'shipped'] } });
  if (open) return { ok: false, open };
  const now = new Date();
  await Order.updateMany({ store: storeId, 'customer.phone': customer.phone }, { $set: { 'customer.name': 'Deleted customer', 'customer.email': '', 'customer.phone': '0000000000', shipping: { line1: '—', line2: '', city: '—', state: '—', pincode: '000000' }, note: '' } });
  await Customer.deleteOne({ store: storeId, _id: customer._id });
  return { ok: true, erasedAt: now };
}

let registered = false;
function register() {
  if (registered) return; registered = true;
  ['order.created', 'order.status_changed', 'order.paid', 'order.refunded'].forEach((e) => events.on(e, fromOrderEvent));
}
module.exports = { recompute, rebuildStore, codBlocked, erase, register };
