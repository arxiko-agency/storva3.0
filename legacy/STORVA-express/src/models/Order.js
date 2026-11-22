'use strict';
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { STATUSES } = require('../utils/orderStatus');
const { Schema } = mongoose;

// Line items are SNAPSHOTS (title, price, option label): later edits or deletion of a product never change an old order.
const itemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  title: { type: String, required: true },
  variantLabel: { type: String, default: '' },
  sku: { type: String, default: '' },
  image: { type: String, default: '' },
  unitPricePaise: { type: Number, required: true, min: 0 },
  qty: { type: Number, required: true, min: 1 },
  lineTotalPaise: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, default: 0 },          // Module 12: GST snapshot per line
  taxPaise: { type: Number, default: 0 },
  taxablePaise: { type: Number, default: 0 },
  hsn: { type: String, default: '' },
}, { _id: false });

const orderSchema = new Schema({
  orderNumber: { type: Number, required: true },                 // per store, starts at 1001
  publicToken: { type: String, required: true },                 // lets the buyer open their confirmation page; never listed to other shoppers
  idempotencyKey: { type: String },
  status: { type: String, enum: STATUSES, default: 'pending' },
  statusHistory: [{ _id: false, status: String, at: Date }],
  paymentMethod: { type: String, enum: ['cod', 'razorpay'], default: 'cod' },
  // cod: unpaid -> paid (owner confirms cash). razorpay: pending -> paid (only after server-side signature check); failed / refunded are set by the gateway webhook step.
  paymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed', 'refunded'], default: 'unpaid' },
  paidAt: { type: Date, default: null },
  razorpayOrderId: { type: String, default: null },
  razorpayPaymentId: { type: String, default: null },
  // Module 6 step 3 (webhooks): refund ledger, last gateway failure text, and a revision counter used for compare-and-set updates
  // Module 6 step 4: entries started from the dashboard carry key/reason/error. 'pending' = reserved locally, Razorpay has not confirmed it yet. Entries from webhooks only have the first five fields.
  refunds: { type: [new Schema({ refundId: { type: String, default: null }, amountPaise: Number, status: { type: String, enum: ['pending', 'created', 'processed', 'failed'] }, createdAt: Date, updatedAt: Date,
    idempotencyKey: { type: String, default: null }, reason: { type: String, default: '', maxlength: 200 }, source: { type: String, enum: ['dashboard', 'gateway', 'auto'], default: 'gateway' }, requestedBy: { type: Schema.Types.ObjectId, default: null }, error: { type: String, default: '', maxlength: 200 } }, { _id: false })], default: [] },
  refundedPaise: { type: Number, default: 0, min: 0 },
  // Automatic refund of a cancelled paid online order: set once every allowed attempt failed, so the background sweep stops retrying and a human takes over (a manual refund still works).
  autoRefundExhausted: { type: Boolean, default: false },
  paymentError: { type: String, default: '', maxlength: 200 },
  paymentRev: { type: Number, default: 0 },
  // Module 6 step 4 part 2: when reconciliation last asked Razorpay about this order. Only a scheduling hint: it is NOT payment state and never bumps paymentRev.
  reconcileCheckedAt: { type: Date, default: null },
  customer: { name: { type: String, required: true }, phone: { type: String, required: true }, email: { type: String, default: '' } },
  shipping: { line1: String, line2: { type: String, default: '' }, city: String, state: String, pincode: String },
  note: { type: String, default: '', maxlength: 300 },
  items: { type: [itemSchema], validate: (v) => v.length > 0 },
  subtotalPaise: { type: Number, required: true, min: 0 },
  discountPaise: { type: Number, default: 0, min: 0 },
  shippingPaise: { type: Number, default: 0, min: 0 },
  codFeePaise: { type: Number, default: 0, min: 0 },              // Module 12
  taxPaise: { type: Number, default: 0, min: 0 },                 // GST: included in prices (taxInclusive) or added on top
  taxInclusive: { type: Boolean, default: true },
  tax: { cgst: { type: Number, default: 0 }, sgst: { type: Number, default: 0 }, igst: { type: Number, default: 0 }, chargesTaxPaise: { type: Number, default: 0 }, chargesTaxRate: { type: Number, default: 0 } },
  shippingZone: { type: String, default: '' },
  buyerGstin: { type: String, default: '' },                       // business purchases: printed on the invoice
  seller: { legalName: String, gstin: String, state: String, address: String }, // snapshot for the invoice
  invoiceNumber: { type: String, default: null },
  invoiceDate: { type: Date, default: null },
  totalPaise: { type: Number, required: true, min: 0 },
  couponCode: { type: String, default: null },
  coupon: { type: Schema.Types.ObjectId, default: null },
  inventoryReleased: { type: Boolean, default: false },
  // Module 12: courier + tracking, set when the owner marks the order shipped (dashboard or WhatsApp "SHIP 1042 <tracking>").
  shipment: { carrier: { type: String, default: '', maxlength: 60 }, trackingNumber: { type: String, default: '', maxlength: 60 }, trackingUrl: { type: String, default: '', maxlength: 300 }, shippedAt: { type: Date, default: null } },
  ownerNote: { type: String, default: '', maxlength: 1000 },   // private, never shown to the buyer
}, { timestamps: true });
orderSchema.plugin(tenantScoped);
orderSchema.index({ store: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ store: 1, createdAt: -1 });
// Webhooks find an order from the gateway ids alone (no store yet), so these are globally unique when present.
orderSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } });
orderSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } });
orderSchema.index({ store: 1, status: 1, createdAt: -1 });
// Reconciliation scans across stores for unsettled online orders / in-flight refunds.
orderSchema.index({ paymentMethod: 1, paymentStatus: 1, createdAt: 1 });
orderSchema.index({ paymentStatus: 1, 'refunds.status': 1 });
// Background sweeps and the owner Payments list (added in the security/performance pass).
orderSchema.index({ status: 1, paymentMethod: 1, paymentStatus: 1, updatedAt: 1 }); // auto-refund sweep
orderSchema.index({ paymentStatus: 1, inventoryReleased: 1, updatedAt: 1 });        // refunded-stock repair pass
orderSchema.index({ store: 1, paymentMethod: 1, paymentStatus: 1, createdAt: -1 }); // Payments tab list
orderSchema.index({ store: 1, invoiceNumber: 1 }, { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } });
orderSchema.index({ store: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

const r = (p) => (p == null ? null : p / 100);
const itemApi = (i) => ({ productId: String(i.product), variantId: i.variantId ? String(i.variantId) : null, title: i.title, variantLabel: i.variantLabel, sku: i.sku, image: i.image, unitPrice: r(i.unitPricePaise), qty: i.qty, lineTotal: r(i.lineTotalPaise), taxRate: i.taxRate || 0, tax: r(i.taxPaise || 0), hsn: i.hsn || '' });
const totals = (o) => ({ subtotal: r(o.subtotalPaise), discount: r(o.discountPaise), shipping: r(o.shippingPaise), codFee: r(o.codFeePaise || 0), tax: r(o.taxPaise || 0), taxInclusive: o.taxInclusive !== false, taxBreakdown: o.taxPaise ? { cgst: r(o.tax.cgst), sgst: r(o.tax.sgst), igst: r(o.tax.igst) } : null, total: r(o.totalPaise) });

orderSchema.methods.toOwnerApi = function () {
  return {
    id: String(this._id), orderNumber: this.orderNumber, status: this.status, statusHistory: this.statusHistory, paymentMethod: this.paymentMethod, paymentStatus: this.paymentStatus, paidAt: this.paidAt, razorpayOrderId: this.razorpayOrderId, razorpayPaymentId: this.razorpayPaymentId,
    refundedAmount: r(this.refundedPaise), refunds: (this.refunds || []).map((x) => ({ refundId: x.refundId || null, amount: r(x.amountPaise), status: x.status, reason: x.reason || '', source: x.source || 'gateway', error: x.error || '', idempotencyKey: x.idempotencyKey || null, createdAt: x.createdAt || null, updatedAt: x.updatedAt || null })), paymentError: this.paymentError,
    customer: { name: this.customer.name, phone: this.customer.phone, email: this.customer.email }, shippingAddress: this.shipping && { line1: this.shipping.line1, line2: this.shipping.line2, city: this.shipping.city, state: this.shipping.state, pincode: this.shipping.pincode },
    note: this.note, items: this.items.map(itemApi), ...totals(this), couponCode: this.couponCode, createdAt: this.createdAt, updatedAt: this.updatedAt,
    shipment: this.shipment && (this.shipment.trackingNumber || this.shipment.carrier || this.shipment.trackingUrl) ? { carrier: this.shipment.carrier, trackingNumber: this.shipment.trackingNumber, trackingUrl: this.shipment.trackingUrl, shippedAt: this.shipment.shippedAt } : null,
    ownerNote: this.ownerNote || '', invoiceNumber: this.invoiceNumber && !this.invoiceNumber.startsWith('PENDING-') ? this.invoiceNumber : null, invoiceDate: this.invoiceNumber && !this.invoiceNumber.startsWith('PENDING-') ? this.invoiceDate : null, buyerGstin: this.buyerGstin || '', shippingZone: this.shippingZone || '',
  };
};
// What the buyer sees on their confirmation page (they hold the token).
const { buyerRefundState } = require('../utils/refundMath');
orderSchema.methods.toBuyerApi = function () {
  const o = this.toOwnerApi(); delete o.id; delete o.statusHistory; delete o.razorpayOrderId; delete o.razorpayPaymentId; delete o.refunds; delete o.refundedAmount; o.refundState = buyerRefundState(this); delete o.paymentError; delete o.ownerNote; return o;
};
module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
