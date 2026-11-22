'use strict';
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');
const { Schema } = mongoose;

const variantSchema = new Schema({
  key: { type: String, required: true },                       // "S|Red": the combination, unique per product
  options: [{ _id: false, name: String, value: String }],
  sku: { type: String, default: '', maxlength: 64 },
  pricePaise: { type: Number, default: null, min: 0 },         // null = use the product price
  stock: { type: Number, default: 0, min: 0 },
});

const productSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  slug: { type: String, required: true },
  description: { type: String, default: '', maxlength: 5000 },
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  pricePaise: { type: Number, required: true, min: 0 },
  compareAtPricePaise: { type: Number, default: null, min: 0 },
  sku: { type: String, default: '', maxlength: 64 },
  category: { type: String, default: '', maxlength: 60, trim: true },
  tags: { type: [String], default: [] },
  trackInventory: { type: Boolean, default: true },
  stock: { type: Number, default: 0, min: 0 },                 // used when the product has no variants
  options: [{ _id: false, name: String, values: [String] }],
  variants: [variantSchema],
  images: [{ url: { type: String, required: true }, alt: { type: String, default: '' } }],
  collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
  gstRate: { type: Number, default: null },                    // Module 12: null = the store's default GST rate
  hsn: { type: String, default: '', maxlength: 8 },            // HSN code printed on GST invoices
}, { timestamps: true });

productSchema.plugin(tenantScoped);
productSchema.index({ store: 1, slug: 1 }, { unique: true });
productSchema.index({ store: 1, status: 1, createdAt: -1 });
productSchema.index({ store: 1, category: 1 });
productSchema.index({ store: 1, collections: 1 });

productSchema.virtual('totalStock').get(function () {
  return this.variants && this.variants.length ? this.variants.reduce((n, v) => n + v.stock, 0) : this.stock;
});

const rupees = (p) => (p == null ? null : p / 100);
productSchema.methods.toApi = function () {
  return {
    id: String(this._id), title: this.title, slug: this.slug, description: this.description, status: this.status,
    price: rupees(this.pricePaise), compareAtPrice: rupees(this.compareAtPricePaise), sku: this.sku, gstRate: this.gstRate, hsn: this.hsn, category: this.category, tags: this.tags,
    trackInventory: this.trackInventory, stock: this.stock, totalStock: this.totalStock,
    options: this.options.map((o) => ({ name: o.name, values: o.values })),
    variants: this.variants.map((v) => ({ id: String(v._id), key: v.key, options: v.options.map((o) => ({ name: o.name, value: o.value })), sku: v.sku, price: rupees(v.pricePaise), stock: v.stock })),
    images: this.images.map((i) => ({ id: String(i._id), url: i.url, alt: i.alt })),
    collections: this.collections.map(String), createdAt: this.createdAt, updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
