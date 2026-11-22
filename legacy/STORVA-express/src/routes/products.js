'use strict';
// Mounted at /api/stores/:storeId/products (owner-only; req.store is already the caller's own store).
// EVERY query below carries { store: req.store._id } (enforced by the tenantScoped plugin).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router({ mergeParams: true });
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { env } = require('../config/env');
const { slugify } = require('../utils/slug');
const { badRequest } = require('../utils/validate');
const { readProduct, toPaise, toInt, sniffImage, escapeRegex, text } = require('../utils/productInput');
const { registerCascade } = require('../middleware/tenant');
const { strictLimiter } = require('../middleware/rateLimit');
const { limitOf, planFor } = require('../config/plans');

const MAX_IMAGES = 8;
const uploadLimiter = strictLimiter(15 * 60 * 1000, 60, 'Too many uploads. Please try again later.');
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const NOT_FOUND = (what = 'Product') => new AppError(`${what} not found.`, 404, 'not_found');
const oid = (id, what) => { if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw NOT_FOUND(what); return id; };
const sid = (req) => req.store._id;

// Deleting a store removes its products, collections and image files.
registerCascade(async (storeId) => {
  await Product.deleteMany({ store: storeId });
  await Collection.deleteMany({ store: storeId });
  await fs.promises.rm(path.join(env.uploadDir, String(storeId)), { recursive: true, force: true });
});

async function uniqueSlug(Model, storeId, base) {
  base = base || 'item';
  const rows = await Model.find({ store: storeId, slug: new RegExp(`^${escapeRegex(base)}(-\\d+)?$`) }).select('slug').lean();
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}
async function createWithSlug(Model, storeId, base, data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt ? `${base}-${crypto.randomBytes(3).toString('hex')}` : await uniqueSlug(Model, storeId, base);
    try { return await Model.create({ ...data, slug, store: storeId }); } catch (e) { if (!(e && e.code === 11000)) throw e; }
  }
  throw new AppError('Could not create a unique address. Please try again.', 409, 'slug_taken');
}

// Collections given by the client must belong to THIS store.
async function validCollectionIds(storeId, ids) {
  if (!Array.isArray(ids) || ids.length > 50 || ids.some((i) => typeof i !== 'string' || !/^[a-f0-9]{24}$/i.test(i))) throw badRequest({ collections: 'Invalid collections.' });
  const found = await Collection.find({ store: storeId, _id: { $in: ids } }).select('_id').lean();
  if (found.length !== new Set(ids).size) throw badRequest({ collections: 'One or more collections do not exist.' });
  return found.map((c) => c._id);
}

// ---- List / search / filter ---------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query, where = { store: sid(req) };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (str(q.q)) { const re = new RegExp(escapeRegex(str(q.q).slice(0, 80)), 'i'); where.$or = [{ title: re }, { sku: re }, { tags: re }, { 'variants.sku': re }]; }
  if (['draft', 'active', 'archived'].includes(q.status)) where.status = q.status;
  if (str(q.category)) where.category = str(q.category);
  if (str(q.collection)) where.collections = oid(str(q.collection), 'Collection');
  const lo = q.minPrice !== undefined ? toPaise(q.minPrice) : undefined, hi = q.maxPrice !== undefined ? toPaise(q.maxPrice) : undefined;
  if (lo === null || hi === null) throw badRequest({ price: 'Invalid price filter.' });
  if (lo !== undefined || hi !== undefined) where.pricePaise = { ...(lo !== undefined ? { $gte: lo } : {}), ...(hi !== undefined ? { $lte: hi } : {}) };
  if (q.inStock === '1') where.$and = [{ $or: [{ trackInventory: false }, { stock: { $gt: 0 } }, { 'variants.stock': { $gt: 0 } }] }];
  if (q.inStock === '0') Object.assign(where, { trackInventory: true, stock: { $lte: 0 }, variants: { $not: { $elemMatch: { stock: { $gt: 0 } } } } });
  const sort = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, price_asc: { pricePaise: 1 }, price_desc: { pricePaise: -1 }, title: { title: 1 } }[q.sort] || { createdAt: -1 };
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [total, rows] = await Promise.all([Product.countDocuments(where), Product.find(where).sort(sort).skip((page - 1) * limit).limit(limit)]);
  res.json({ products: rows.map((p) => p.toApi()), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// ---- Categories (derived from products) ---------------------------------------------------------
router.get('/categories', asyncHandler(async (req, res) => {
  const rows = await Product.aggregate([{ $match: { store: sid(req), category: { $ne: '' } } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  res.json({ categories: rows.map((r) => ({ name: r._id, count: r.count })) });
}));
router.post('/categories/rename', asyncHandler(async (req, res) => {
  const from = text(body(req).from), to = text(body(req).to);
  if (!from || !to || to.length > 60) throw badRequest({ to: 'Enter a category name (1 to 60 characters).' });
  const r = await Product.updateMany({ store: sid(req), category: from }, { category: to });
  res.json({ updated: r.modifiedCount });
}));

// ---- Create -------------------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const input = body(req);
  const { data, fields } = readProduct(input, { partial: false });
  if (Object.keys(fields).length) throw badRequest(fields);
  const total = Math.min(env.maxProductsPerStore, limitOf(req.store, 'totalProducts'));
  if (await Product.countDocuments({ store: sid(req) }) >= total) {
    throw new AppError(`Your plan allows up to ${total} products in total. Delete old drafts or upgrade your plan.`, 403, 'product_limit', { details: { limit: total, plan: planFor(req.store).id } });
  }
  if ((data.status || 'draft') === 'active') await assertActiveRoom(req, null);
  if (input.collections !== undefined) data.collections = await validCollectionIds(sid(req), input.collections);
  const p = await createWithSlug(Product, sid(req), slugify(data.title) || 'product', data); // images only via the upload endpoint
  res.status(201).json({ product: p.toApi() });
}));

// Module 8: plans limit how many products can be ACTIVE (visible) at once; drafts don't count. Free = 10, as on the pricing page.
async function assertActiveRoom(req, exceptId) {
  const max = limitOf(req.store, 'activeProducts');
  if (max == null) return;
  const n = await Product.countDocuments({ store: sid(req), status: 'active', ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (n >= max) throw new AppError(`Your ${planFor(req.store).name} plan allows ${max} active products. Save this one as a draft, hide another product, or upgrade.`, 402, 'upgrade_required', { details: { feature: 'activeProducts', limit: max, currentPlan: planFor(req.store).id, requiredPlan: planFor(req.store).id === 'free' ? 'pro' : 'advanced' } });
}

async function loadProduct(req) {
  const p = await Product.findOne({ _id: oid(req.params.productId), store: sid(req) });
  if (!p) throw NOT_FOUND();
  return p;
}
router.get('/:productId', asyncHandler(async (req, res) => res.json({ product: (await loadProduct(req)).toApi() })));

// ---- Update -------------------------------------------------------------------------------------
router.patch('/:productId', asyncHandler(async (req, res) => {
  const p = await loadProduct(req), input = body(req);
  const { data, fields } = readProduct(input, { partial: true, existingVariants: p.variants.map((v) => ({ key: v.key, _id: v._id })) });
  if (data.pricePaise === undefined && data.compareAtPricePaise != null && data.compareAtPricePaise < p.pricePaise) fields.compareAtPrice = 'Compare-at price must be at least the price.';
  if (data.pricePaise != null && data.compareAtPricePaise === undefined && p.compareAtPricePaise != null && p.compareAtPricePaise < data.pricePaise) fields.compareAtPrice = 'Compare-at price must be at least the price.';
  if (Object.keys(fields).length) throw badRequest(fields);
  if (data.status === 'active' && p.status !== 'active') await assertActiveRoom(req, p._id);
  if (input.collections !== undefined) data.collections = await validCollectionIds(sid(req), input.collections);
  p.set(data); await p.save();
  res.json({ product: p.toApi() });
}));

// ---- Delete -------------------------------------------------------------------------------------
router.delete('/:productId', asyncHandler(async (req, res) => {
  const p = await loadProduct(req);
  await Product.deleteOne({ _id: p._id, store: sid(req) });
  await Promise.all(p.images.map((i) => removeFile(req.store._id, i.url)));
  res.json({ ok: true });
}));

// ---- Inventory: atomic set / adjust (never read-modify-write) -----------------------------------
router.patch('/:productId/stock', asyncHandler(async (req, res) => {
  const b = body(req), p = await loadProduct(req);
  const hasSet = b.stock !== undefined, hasDelta = b.delta !== undefined;
  if (hasSet === hasDelta) throw badRequest({ stock: 'Send either "stock" or "delta".' });
  const n = hasSet ? toInt(b.stock, 0, 1000000) : toInt(b.delta, -1000000, 1000000);
  if (n === null) throw badRequest({ stock: 'Enter a whole number.' });
  const filter = { _id: p._id, store: sid(req) };
  let update;
  if (p.variants.length) {
    const v = typeof b.variantId === 'string' ? p.variants.id(b.variantId) : null;
    if (!v) throw badRequest({ variantId: 'Choose a variant.' });
    if (hasDelta && n < 0) filter.variants = { $elemMatch: { _id: v._id, stock: { $gte: -n } } }; // atomic "never below zero"
    else filter.variants = { $elemMatch: { _id: v._id } };
    update = hasSet ? { $set: { 'variants.$.stock': n } } : { $inc: { 'variants.$.stock': n } };
  } else {
    if (hasDelta && n < 0) filter.stock = { $gte: -n };
    update = hasSet ? { $set: { stock: n } } : { $inc: { stock: n } };
  }
  const r = await Product.updateOne(filter, update);
  if (!r.matchedCount) throw new AppError('Not enough stock for that adjustment.', 409, 'insufficient_stock');
  res.json({ product: (await loadProduct(req)).toApi() });
}));

// ---- Images -------------------------------------------------------------------------------------
async function removeFile(storeId, url) {
  const prefix = `/uploads/${storeId}/`;
  if (typeof url !== 'string' || !url.startsWith(prefix)) return;
  const name = path.basename(url);                                  // basename only: no path traversal possible
  await fs.promises.rm(path.join(env.uploadDir, String(storeId), name), { force: true }).catch(() => {});
}
router.post('/:productId/images', uploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  asyncHandler(async (req, res) => {
    const p = await loadProduct(req);
    if (p.images.length >= MAX_IMAGES) throw new AppError(`A product can have up to ${MAX_IMAGES} images.`, 400, 'too_many_images');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the image as the raw request body (JPEG, PNG or WebP, max 5 MB).', 415, 'bad_image');
    const kind = sniffImage(req.body);
    if (!kind) throw new AppError('That file is not a valid JPEG, PNG or WebP image.', 415, 'bad_image');
    const dir = path.join(env.uploadDir, String(sid(req)));
    await fs.promises.mkdir(dir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;   // server-chosen name; the client's name is never used
    await fs.promises.writeFile(path.join(dir, name), req.body, { flag: 'wx' });
    const alt = typeof req.query.alt === 'string' ? (text(req.query.alt) || '').slice(0, 120) : '';
    const url = `/uploads/${sid(req)}/${name}`;
    const r = await Product.updateOne({ _id: p._id, store: sid(req), [`images.${MAX_IMAGES - 1}`]: { $exists: false } }, { $push: { images: { url, alt } } });
    if (!r.matchedCount) { await removeFile(sid(req), url); throw new AppError(`A product can have up to ${MAX_IMAGES} images.`, 400, 'too_many_images'); }
    res.status(201).json({ product: (await loadProduct(req)).toApi() });
  }));
router.delete('/:productId/images/:imageId', asyncHandler(async (req, res) => {
  const p = await loadProduct(req), img = p.images.id(oid(req.params.imageId, 'Image'));
  if (!img) throw NOT_FOUND('Image');
  const url = img.url;
  await Product.updateOne({ _id: p._id, store: sid(req) }, { $pull: { images: { _id: img._id } } });
  await removeFile(sid(req), url);
  res.json({ product: (await loadProduct(req)).toApi() });
}));

module.exports = router;
module.exports.helpers = { uniqueSlug, createWithSlug, oid, body };
