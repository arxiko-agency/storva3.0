'use strict';
const Store = require('../models/Store');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const NOT_FOUND = () => new AppError('Store not found.', 404, 'store_not_found');

// Resolves /api/stores/:storeId/... for the LOGGED-IN OWNER ONLY. The lookup is { _id, owner } in a single
// query, so another user's store is indistinguishable from a store that does not exist (always 404, never 403),
// which also prevents probing for valid ids. Must run after requireAuth.
const loadOwnedStore = asyncHandler(async (req, res, next) => {
  const id = req.params.storeId;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw NOT_FOUND();
  const store = await Store.findOne({ _id: id, owner: req.user._id });
  if (!store) throw NOT_FOUND();
  if (store.status === 'suspended' && !['GET', 'HEAD'].includes(req.method)) {
    throw new AppError('This store is suspended. Contact support.', 403, 'store_suspended');
  }
  req.store = store;
  next();
});

// Cleanup hooks so deleting a store removes its data. Each later module registers one:
//   registerCascade((storeId) => Product.deleteMany({ store: storeId }).setOptions({ skipTenant: true }))
const cascades = [];
const registerCascade = (fn) => { cascades.push(fn); };
const runCascades = async (storeId) => { for (const fn of cascades) await fn(storeId); };

module.exports = { loadOwnedStore, registerCascade, runCascades };
