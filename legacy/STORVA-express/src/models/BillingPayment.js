'use strict';
// Module 8: one row per plan purchase attempt (STORVA charging the store owner). Amounts in paise.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');

const billingPaymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['pro', 'advanced'], required: true },
  cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
  amountPaise: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
  source: { type: String, enum: ['razorpay', 'dev', 'admin', 'subscription'], default: 'razorpay' },
  razorpayOrderId: { type: String, default: null },
  razorpayPaymentId: { type: String, default: null },
  razorpaySubscriptionId: { type: String, default: null },   // set for auto-renew charges (source 'subscription')
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  creditDays: { type: Number, default: 0 },             // unused days of a lower plan converted on upgrade
  invoiceNumber: { type: String, default: null },
  paidAt: { type: Date, default: null },
  error: { type: String, default: '', maxlength: 200 },
}, { timestamps: true });
billingPaymentSchema.plugin(tenantScoped);
billingPaymentSchema.index({ store: 1, createdAt: -1 });
billingPaymentSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } });

// One row per Razorpay payment of an auto-renew charge: a duplicate webhook or a browser verify racing a webhook can never create a second period.
billingPaymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, partialFilterExpression: { source: 'subscription', razorpayPaymentId: { $type: 'string' } } });

billingPaymentSchema.methods.toApi = function () {
  return { id: String(this._id), plan: this.plan, cycle: this.cycle, amount: this.amountPaise / 100, status: this.status, source: this.source, periodStart: this.periodStart, periodEnd: this.periodEnd, creditDays: this.creditDays, invoiceNumber: this.invoiceNumber, paidAt: this.paidAt, razorpayPaymentId: this.razorpayPaymentId, createdAt: this.createdAt };
};
const BillingPayment = mongoose.models.BillingPayment || mongoose.model('BillingPayment', billingPaymentSchema);
// Billing rows are financial records of the platform, but they belong to the store: deleting the store removes them too.
registerCascade(async (storeId) => { await BillingPayment.deleteMany({ store: storeId }); });
module.exports = BillingPayment;
