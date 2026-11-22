'use strict';
const mongoose = require('mongoose');

// Tenant root. Every other tenant-owned collection (products, orders, ...) carries a `store` reference and
// uses the tenantScoped plugin. A store belongs to exactly ONE owner and the owner is never taken from client input.
const storeSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  previousSlugs: { type: [String], default: [], index: true }, // old addresses stay reserved (storefront redirects in Module 5)
  tagline: { type: String, trim: true, maxlength: 120, default: '' },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  whatsappNumber: { type: String, default: '' },          // digits with country code, e.g. 919876543210
  contactEmail: { type: String, lowercase: true, trim: true, maxlength: 254, default: '' },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  logoUrl: { type: String, default: '' },                  // set by the upload module (Module 4)
  status: { type: String, enum: ['active', 'suspended'], default: 'active' }, // suspended only by platform admin
  showcase: { type: Boolean, default: false },             // owner opt-in to the public showcase gallery
  plan: { type: String, enum: ['free', 'starter', 'pro', 'advanced'], default: 'free' },   // Module 8: see src/config/plans.js ('starter' = legacy name for Pro)
  planCycle: { type: String, enum: ['monthly', 'yearly', null], default: null },
  planExpiresAt: { type: Date, default: null },            // end of the paid period; null on Free (or a complimentary plan set by an admin)
  planRenewalReminderAt: { type: Date, default: null },    // last "your plan ends soon" reminder (Module 13)
  // Module 12: delivery charges, cash-on-delivery rules and GST (validated by services/shippingTax.js; used by utils/charges.js).
  shippingSettings: {
    mode: { type: String, enum: ['free', 'flat', 'zones'], default: 'free' },
    flatRatePaise: { type: Number, default: 0, min: 0 },
    freeAbovePaise: { type: Number, default: null, min: 0 },
    zones: { type: [new mongoose.Schema({ id: String, name: String, states: [String], ratePaise: Number, freeAbovePaise: { type: Number, default: null }, etaDays: { type: String, default: '' }, codAvailable: { type: Boolean, default: true } }, { _id: false })], default: [] },
    blockedPincodes: { type: [String], default: [] },
    cod: { enabled: { type: Boolean, default: true }, feePaise: { type: Number, default: 0, min: 0 }, maxOrderPaise: { type: Number, default: null, min: 0 } },
  },
  taxSettings: {
    enabled: { type: Boolean, default: false },
    gstin: { type: String, default: '' },
    legalName: { type: String, default: '', maxlength: 120 },
    state: { type: String, default: '' },                   // place of business (from the GSTIN); decides CGST+SGST vs IGST
    address: { type: String, default: '', maxlength: 300 },   // printed on invoices
    pricesIncludeTax: { type: Boolean, default: true },       // Indian retail prices are normally GST-inclusive (MRP)
    defaultRate: { type: Number, default: 5 },
    shippingTaxable: { type: Boolean, default: true },
    invoicePrefix: { type: String, default: 'INV', maxlength: 6 },
  },
  // Module 13: who gets told what. Owner alerts go to contactEmail (or the owner's login email) and whatsappNumber (or the owner's phone).
  notifications: {
    ownerEmail: { newOrder: { type: Boolean, default: true }, paymentFailed: { type: Boolean, default: false }, refund: { type: Boolean, default: true }, lowStock: { type: Boolean, default: true }, plan: { type: Boolean, default: true }, issues: { type: Boolean, default: true }, dailySummary: { type: Boolean, default: false } },
    ownerWhatsapp: { newOrder: { type: Boolean, default: true }, lowStock: { type: Boolean, default: false } },
    buyerEmail: { type: Boolean, default: true },
    buyerWhatsapp: { type: Boolean, default: true },
    lowStockThreshold: { type: Number, default: 3, min: 0, max: 1000 },
  },
}, { timestamps: true });

storeSchema.index({ owner: 1, createdAt: 1 });
storeSchema.index({ showcase: 1, status: 1, createdAt: -1 });

// Fields the owner sees.
storeSchema.methods.toOwnerJSON = function () {
  return {
    id: String(this._id), name: this.name, slug: this.slug, tagline: this.tagline, description: this.description,
    whatsappNumber: this.whatsappNumber, contactEmail: this.contactEmail, address: this.address, currency: this.currency,
    logoUrl: this.logoUrl, status: this.status, showcase: this.showcase, plan: require('../config/plans').effectivePlanId(this), planCycle: this.planCycle || null, planExpiresAt: this.planExpiresAt || null,
    createdAt: this.createdAt, updatedAt: this.updatedAt,
  };
};

// Fields anyone may see. No owner, no contact details, no ids of the owner.
storeSchema.methods.toPublicJSON = function () {
  return { name: this.name, slug: this.slug, tagline: this.tagline, logoUrl: this.logoUrl, cover: this.logoUrl, url: `/store/${this.slug}` }; // url/cover are what the landing gallery renders; /store/:slug is served in Module 5
};

module.exports = mongoose.models.Store || mongoose.model('Store', storeSchema);
