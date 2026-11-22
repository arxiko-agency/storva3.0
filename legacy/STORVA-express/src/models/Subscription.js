'use strict';
// Auto-renewing STORVA plan for one store (Razorpay Subscriptions). The plan period itself still lives on the Store (planExpiresAt) and every
// charge is a BillingPayment row (source 'subscription'), so prepaid and auto-renew purchases share one invoice/period path.
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { registerCascade } = require('../middleware/tenant');

const STATUSES = ['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'paused'];
const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: String, enum: ['pro', 'advanced'], required: true },
  cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
  amountPaise: { type: Number, required: true, min: 100 },              // what Razorpay charges every cycle (fixed when the subscription was created)
  razorpaySubscriptionId: { type: String, required: true },
  razorpayPlanId: { type: String, default: null },
  status: { type: String, enum: STATUSES, default: 'created' },
  startsAt: { type: Date, default: null },                                // first charge is scheduled for this time (renewal); null = charged at checkout
  paidCount: { type: Number, default: 0 },
  currentEnd: { type: Date, default: null },                              // Razorpay's end of the current billing cycle = next charge
  lastChargedAt: { type: Date, default: null },
  lastEventAt: { type: Date, default: null },                             // newest webhook applied (older ones are ignored)
  cancelAtCycleEnd: { type: Boolean, default: false },
}, { timestamps: true });
subscriptionSchema.plugin(tenantScoped);
subscriptionSchema.index({ razorpaySubscriptionId: 1 }, { unique: true });
subscriptionSchema.index({ store: 1, status: 1 });

subscriptionSchema.methods.toApi = function () {
  return { id: String(this._id), plan: this.plan, cycle: this.cycle, amount: this.amountPaise / 100, status: this.status, paidCount: this.paidCount, startsAt: this.startsAt, nextChargeAt: this.currentEnd || this.startsAt || null, cancelAtCycleEnd: this.cancelAtCycleEnd, lastChargedAt: this.lastChargedAt };
};
const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
registerCascade(async (storeId) => { await Subscription.deleteMany({ store: storeId }); });
module.exports = Subscription;
module.exports.STATUSES = STATUSES;
