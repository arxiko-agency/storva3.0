'use strict';
const mongoose = require('mongoose');
const tenantScoped = require('./tenantScoped');

const collectionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  slug: { type: String, required: true },
  description: { type: String, default: '', maxlength: 500 },
}, { timestamps: true });
collectionSchema.plugin(tenantScoped);
collectionSchema.index({ store: 1, slug: 1 }, { unique: true });

collectionSchema.methods.toApi = function (productCount) {
  const o = { id: String(this._id), name: this.name, slug: this.slug, description: this.description, createdAt: this.createdAt };
  if (productCount !== undefined) o.productCount = productCount;
  return o;
};
module.exports = mongoose.models.Collection || mongoose.model('Collection', collectionSchema);
