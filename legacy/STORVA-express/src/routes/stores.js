'use strict';
const router = require('express').Router();
const Store = require('../models/Store');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { env } = require('../config/env');
const { slugify, slugProblem } = require('../utils/slug');
const { normalizePhone, normalizeEmail, badRequest } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedStore, runCascades } = require('../middleware/tenant');
const { strictLimiter } = require('../middleware/rateLimit');

const slugCheckLimiter = strictLimiter(60 * 1000, 30, 'Too many checks. Please slow down.');
const createLimiter = strictLimiter(60 * 60 * 1000, 10, 'Too many store creations. Please try again later.');

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
// Free-text: must be a string (blocks {"$ne":..} objects), control characters removed, length enforced by caller.
const text = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : null);

// Is this slug usable? Old slugs of any store stay reserved so nobody can hijack a renamed store's old link.
async function slugState(slug, exceptStoreId) {
  const problem = slugProblem(slug);
  if (problem) return { available: false, reason: problem };
  const clash = await Store.findOne({ $or: [{ slug }, { previousSlugs: slug }], ...(exceptStoreId ? { _id: { $ne: exceptStoreId } } : {}) }).select('_id').lean();
  return clash ? { available: false, taken: true, reason: 'This address is already taken.' } : { available: true };
}

// ---- Public: live slug availability + showcase ---------------------------------------------------
router.get('/slug-check', slugCheckLimiter, asyncHandler(async (req, res) => {
  const slug = typeof req.query.slug === 'string' ? req.query.slug.trim().toLowerCase() : '';
  res.json({ slug, ...(await slugState(slug)) });
}));

// ---- Everything below needs a logged-in, verified user -------------------------------------------
router.use(requireAuth);

// Validates the editable fields. `partial` = PATCH (only provided keys are checked).
function readFields(input, partial) {
  const out = {}, fields = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  const str = (k, label, min, max, required) => {
    if (!has(k)) { if (!partial && required) fields[k] = `Enter ${label}.`; return; }
    const v = text(input[k]);
    if (v === null || v.length > max || v.length < min) fields[k] = `${label[0].toUpperCase() + label.slice(1)} must be ${min ? `${min} to ` : 'up to '}${max} characters.`;
    else out[k] = v;
  };
  str('name', 'a store name', 2, 60, true);
  str('tagline', 'a tagline', 0, 120);
  str('description', 'a description', 0, 1000);
  str('address', 'an address', 0, 300);
  if (has('whatsappNumber')) {
    if (input.whatsappNumber === '' ) out.whatsappNumber = '';
    else { const p = normalizePhone(input.whatsappNumber); if (!p) fields.whatsappNumber = 'Enter a valid 10-digit Indian WhatsApp number.'; else out.whatsappNumber = p; }
  } else if (!partial) fields.whatsappNumber = 'Enter your WhatsApp number.';
  if (has('contactEmail')) {
    if (input.contactEmail === '') out.contactEmail = '';
    else { const e = normalizeEmail(input.contactEmail); if (!e) fields.contactEmail = 'Enter a valid email address.'; else out.contactEmail = e; }
  }
  if (has('showcase')) { if (typeof input.showcase !== 'boolean') fields.showcase = 'Must be true or false.'; else out.showcase = input.showcase; }
  return { out, fields };
}

// Create
router.post('/', createLimiter, asyncHandler(async (req, res) => {
  if (!req.user.verified) throw new AppError('Please verify your email or mobile number before creating a store.', 403, 'not_verified');
  const input = body(req);
  const { out, fields } = readFields(input, false);
  const hasSlug = Object.prototype.hasOwnProperty.call(input, 'slug') && input.slug !== '' && input.slug != null;
  // A slug that is sent must be a string. Objects such as {"$ne":"x"} are rejected instead of silently falling back to the name.
  let slug = hasSlug ? (typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : null) : slugify(out.name || '');
  if (slugProblem(slug)) fields.slug = slugProblem(slug);
  if (Object.keys(fields).length) throw badRequest(fields);

  const owned = await Store.countDocuments({ owner: req.user._id });
  const maxStores = await require('../services/billing').maxStoresFor(req.user._id); // Module 8: the Advanced plan allows more stores
  if (owned >= maxStores) {
    throw new AppError(`Your plan allows ${maxStores} store${maxStores === 1 ? '' : 's'}.${maxStores < 3 ? ' The Advanced plan allows up to 3.' : ''}`, 403, 'store_limit');
  }
  const state = await slugState(slug);
  if (!state.available) throw new AppError(state.reason, 409, 'slug_taken', { fields: { slug: state.reason } });

  let store;
  try {
    // owner comes from the session, never from the request body; status/plan/logo are never client-settable.
    store = await Store.create({ ...out, slug, owner: req.user._id });
  } catch (e) {
    if (e && e.code === 11000) throw new AppError('This address is already taken.', 409, 'slug_taken', { fields: { slug: 'This address is already taken.' } });
    throw e;
  }
  res.status(201).json({ store: store.toOwnerJSON() });
}));

// List MY stores
router.get('/', asyncHandler(async (req, res) => {
  const stores = await Store.find({ owner: req.user._id }).sort({ createdAt: 1 });
  res.json({ stores: stores.map((s) => s.toOwnerJSON()), limit: await require('../services/billing').maxStoresFor(req.user._id) });
}));

// Single store (owner only)
router.get('/:storeId', loadOwnedStore, (req, res) => res.json({ store: req.store.toOwnerJSON() }));

// Update (owner only, whitelisted fields)
router.patch('/:storeId', loadOwnedStore, asyncHandler(async (req, res) => {
  const input = body(req);
  const { out, fields } = readFields(input, true);
  let newSlug = null;
  if (Object.prototype.hasOwnProperty.call(input, 'slug')) {
    newSlug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
    if (newSlug !== req.store.slug) {
      const state = await slugState(newSlug, req.store._id);
      // Same answer as POST: a taken address is a 409 conflict, a malformed one a 400 field error.
      if (state.taken && !Object.keys(fields).length) throw new AppError(state.reason, 409, 'slug_taken', { fields: { slug: state.reason } });
      if (!state.available) fields.slug = state.reason;
    } else newSlug = null;
  }
  if (Object.keys(fields).length) throw badRequest(fields);

  Object.assign(req.store, out);
  if (newSlug) {
    req.store.previousSlugs = [...req.store.previousSlugs.filter((s) => s !== newSlug), req.store.slug].slice(-5);
    req.store.slug = newSlug;
  }
  try { await req.store.save(); } catch (e) {
    if (e && e.code === 11000) throw new AppError('This address is already taken.', 409, 'slug_taken', { fields: { slug: 'This address is already taken.' } });
    throw e;
  }
  res.json({ store: req.store.toOwnerJSON() });
}));

// Delete (owner only). Must retype the store address to confirm.
router.delete('/:storeId', loadOwnedStore, asyncHandler(async (req, res) => {
  if (body(req).confirmSlug !== req.store.slug) throw new AppError('Type the store address exactly to confirm deletion.', 400, 'confirm_required');
  await runCascades(req.store._id);
  await Store.deleteOne({ _id: req.store._id, owner: req.user._id });
  res.json({ ok: true });
}));

// Everything a store owns lives under /api/stores/:storeId/<module>. Later modules mount here.
const scoped = require('express').Router({ mergeParams: true });
router.use('/:storeId', loadOwnedStore, scoped);
scoped.use('/products', require('./products'));        // Module 4
scoped.use('/collections', require('./collections'));  // Module 4
scoped.use('/orders', require('./orders'));            // Module 5
scoped.use('/coupons', require('./coupons'));          // Module 5
scoped.use('/payments', require('./payments'));      // Module 6 step 4: owner payment dashboard + refunds
scoped.use('/design', require('./design'));           // Module 7: store designer + themes
scoped.use('/billing', require('./billing'));         // Module 8: plans, upgrades, invoices
scoped.use('/ai', require('./ai'));                   // Module 9: Gemini product tools
scoped.use('/customers', require('./customers'));     // Module 11: customer records, segments, notes, CSV
scoped.use('/analytics', require('./analytics'));     // Module 14: reports, exports, GST summary
scoped.use('/shipping', require('./shipping'));       // Module 12: delivery charges, COD rules, GST
scoped.use('/whatsapp', require('./whatsapp'));       // Module 10: WhatsApp Cloud API settings, share kit
scoped.use('/notifications', require('./notifications')); // Module 13: in-app alerts, preferences, delivery log
scoped.get('/overview', (req, res) => res.json({ store: req.store.toOwnerJSON(), counts: {} }));

module.exports = router;
module.exports.scoped = scoped;
