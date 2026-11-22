'use strict';
// Platform-wide map: (plan, cycle, price) -> the Razorpay Plan id created for it (not tenant data). A changed price in config/plans.js
// simply creates a new Razorpay plan; existing subscriptions keep charging the price they were created with.
const mongoose = require('mongoose');
const gatewayPlanSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  razorpayPlanId: { type: String, required: true },
  plan: { type: String, required: true }, cycle: { type: String, required: true }, amountPaise: { type: Number, required: true },
}, { timestamps: true });
module.exports = mongoose.models.GatewayPlan || mongoose.model('GatewayPlan', gatewayPlanSchema);
