'use strict';
// Mongoose plugin for EVERY tenant-owned collection (products, variants, collections, orders, customers,
// coupons, ...). It adds a required `store` reference and a guard that makes a query without an explicit
// `store` filter fail loudly instead of silently reading or writing another tenant's rows.
//
//   productSchema.plugin(tenantScoped);
//   Product.find({ store: req.store._id, ... })        // OK
//   Product.findById(id)                                // THROWS (no store filter)
//   Product.find({ store: { $ne: x } })                 // THROWS (operator objects are not allowed)
//   Product.find({}).setOptions({ skipTenant: true })   // explicit, greppable opt-out (platform admin / jobs only)
const mongoose = require('mongoose');

const QUERY_OPS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne',
  'countDocuments', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'distinct'];

function storeFilterProblem(filter) {
  if (!filter || filter.store === undefined || filter.store === null) return 'is missing the "store" filter';
  const s = filter.store;
  const plain = s instanceof mongoose.Types.ObjectId || (typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s));
  return plain ? null : 'must filter on a single store id (no operators or objects)';
}

// opts.uniqueStore: at most one document per store (designs, WhatsApp connections). Declared on the field so there is a single index.
function tenantScoped(schema, opts = {}) {
  schema.add({ store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, ...(opts.uniqueStore ? { unique: true } : { index: true }) } });

  QUERY_OPS.forEach((op) => {
    schema.pre(op, function (next) {
      if (this.getOptions().skipTenant) return next();
      const problem = storeFilterProblem(this.getFilter());
      if (problem) return next(new Error(`Tenant guard: ${op} on ${this.model.modelName} ${problem}`));
      next();
    });
  });

  schema.pre('aggregate', function (next) {
    if (this.options && this.options.skipTenant) return next();
    const first = this.pipeline()[0];
    const problem = first && first.$match ? storeFilterProblem(first.$match) : 'must start with a $match on "store"';
    if (problem) return next(new Error(`Tenant guard: aggregate on ${this.model().modelName} ${problem}`));
    next();
  });

  // A document can never be moved to another store after creation.
  schema.pre('save', function (next) {
    if (!this.isNew && this.isModified('store')) return next(new Error('Tenant guard: "store" cannot be changed'));
    next();
  });
}

module.exports = tenantScoped;
module.exports.storeFilterProblem = storeFilterProblem;
