'use strict';
// Owner-side order changes, shared by the dashboard (routes/orders.js) and WhatsApp commands (services/waCommands.js), so both
// follow exactly the same rules: allowed status transitions, compare-and-set against concurrent changes, inventory release on
// cancel, COD paid/unpaid only, tracking details on shipping, and the domain events that drive notifications.
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const events = require('./events');
const { badRequest } = require('../utils/validate');
const { STATUSES, canTransition, releasesInventory } = require('../utils/orderStatus');
const { releaseOrderInventory } = require('./storefront');

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

async function updateOrder(storeId, o, b) {
  const fields = {}, set = {}, push = {};
  let newStatus = null, markedPaid = false;
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) fields.status = 'Unknown status.';
    else if (b.status !== o.status && !canTransition(o.status, b.status)) fields.status = `An order that is ${o.status} cannot become ${b.status}.`;
    else if (b.status !== o.status) { set.status = newStatus = b.status; push.statusHistory = { status: b.status, at: new Date() }; }
  }
  if (b.paymentStatus !== undefined) {
    if (o.paymentMethod !== 'cod') fields.paymentStatus = 'Online payments are confirmed by the payment gateway and cannot be changed by hand.';
    else if (!['paid', 'unpaid'].includes(b.paymentStatus)) fields.paymentStatus = 'Must be paid or unpaid.';
    else if (o.status === 'cancelled' || newStatus === 'cancelled') fields.paymentStatus = 'A cancelled order cannot be changed.';
    else if (b.paymentStatus !== o.paymentStatus) { set.paymentStatus = b.paymentStatus; set.paidAt = b.paymentStatus === 'paid' ? new Date() : null; markedPaid = b.paymentStatus === 'paid'; }
  }
  if (b.shipment !== undefined && b.shipment !== null) {
    const sh = typeof b.shipment === 'object' && !Array.isArray(b.shipment) ? b.shipment : {};
    const carrier = str(sh.carrier, 60), tn = str(sh.trackingNumber, 60), url = str(sh.trackingUrl, 300);
    if (url && !/^https?:\/\/[^\s<>"]+$/i.test(url)) fields['shipment.trackingUrl'] = 'Enter a full link starting with https://';
    if (tn !== undefined && tn && !/^[A-Za-z0-9\-_/. ]{3,60}$/.test(tn)) fields['shipment.trackingNumber'] = 'Tracking numbers use letters, digits, - _ / . only.';
    if (carrier !== undefined) set['shipment.carrier'] = carrier;
    if (tn !== undefined) set['shipment.trackingNumber'] = tn;
    if (url !== undefined) set['shipment.trackingUrl'] = url;
  }
  if (newStatus === 'shipped') set['shipment.shippedAt'] = new Date();
  if (b.ownerNote !== undefined) { if (typeof b.ownerNote !== 'string' || b.ownerNote.length > 1000) fields.ownerNote = 'Notes are text up to 1000 characters.'; else set.ownerNote = b.ownerNote.trim(); }
  if (Object.keys(fields).length) throw badRequest(fields);
  if (!Object.keys(set).length) return { order: o, changed: false };
  // Compare-and-set on the current status: two owners clicking at once cannot both cancel or both ship.
  const filter = { _id: o._id, store: storeId };
  if (set.status || set.paymentStatus) { filter.status = o.status; filter.paymentStatus = o.paymentStatus; }
  const upd = await Order.updateOne(filter, { $set: set, ...(push.statusHistory ? { $push: push } : {}) });
  if (!upd.matchedCount) throw new AppError('This order was just changed. Reload and try again.', 409, 'conflict');
  if (newStatus && releasesInventory(newStatus)) await releaseOrderInventory(storeId, o);
  if ((newStatus === 'shipped' || newStatus === 'delivered') && !o.invoiceNumber) await require('./shippingTax').assignInvoice(storeId, o).catch((e) => console.error('[invoice] could not assign:', e.message)); // Module 12
  const fresh = await Order.findOne({ _id: o._id, store: storeId });
  if (newStatus) events.emit('order.status_changed', { storeId, orderId: o._id, from: o.status, to: newStatus });
  if (markedPaid) events.emit('order.paid', { storeId, orderId: o._id });
  return { order: fresh, changed: true, newStatus, markedPaid };
}

module.exports = { updateOrder };
