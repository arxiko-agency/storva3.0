'use strict';
const mongoose = require('mongoose');

// One commission per paid plan payment. `billingPayment` is unique, which is what makes crediting exactly-once even if the event is re-emitted or a repair sweep runs.
// Lifecycle: pending (held until availableAt, the refund window) -> paid (admin recorded a payout) | void (reversed, e.g. refunded or fraud).
// "Payable" is derived: status pending AND availableAt <= now.
const commissionSchema = new mongoose.Schema({
  affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate', required: true },
  referral: { type: mongoose.Schema.Types.ObjectId, ref: 'Referral', required: true },
  billingPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingPayment', required: true, unique: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  plan: { type: String, default: '' },
  cycle: { type: String, default: '' },
  basePaise: { type: Number, required: true, min: 1 },          // what the customer paid
  rateBps: { type: Number, required: true, min: 1 },
  amountPaise: { type: Number, required: true, min: 1 },        // commission earned
  status: { type: String, enum: ['pending', 'paid', 'void'], default: 'pending' },
  availableAt: { type: Date, required: true },
  paidAt: { type: Date, default: null },
  payoutRef: { type: String, default: '', maxlength: 120 },     // UPI reference / note entered by the admin
  voidReason: { type: String, default: '', maxlength: 200 },
}, { timestamps: true });
commissionSchema.index({ affiliate: 1, status: 1, availableAt: 1 });
commissionSchema.index({ affiliate: 1, createdAt: -1 });

commissionSchema.methods.toApi = function (now = new Date()) {
  return {
    id: String(this._id), plan: this.plan, cycle: this.cycle, base: this.basePaise / 100, ratePercent: this.rateBps / 100, amount: this.amountPaise / 100,
    status: this.status === 'pending' && this.availableAt <= now ? 'payable' : this.status, availableAt: this.availableAt, paidAt: this.paidAt, createdAt: this.createdAt,
  };
};
module.exports = mongoose.models.Commission || mongoose.model('Commission', commissionSchema);
