'use strict';
const router = require('express').Router({ mergeParams: true });
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { slugify } = require('../utils/slug');
const { badRequest } = require('../utils/validate');
const { text } = require('../utils/productInput');
const { createWithSlug, oid, body } = require('./products').helpers;

const sid = (req) => req.store._id;
const NF = () => new AppError('Collection not found.', 404, 'not_found');
const MAX_COLLECTIONS = 100;

function read(input, partial) {
  const data = {}, fields = {};
  if (input.name !== undefined || !partial) { const v = text(input.name); if (!v || v.length < 2 || v.length > 60) fields.name = 'Name must be 2 to 60 characters.'; else data.name = v; }
  if (input.description !== undefined) { const v = text(input.description); if (v === null || v.length > 500) fields.description = 'Description must be up to 500 characters.'; else data.description = v; }
  return { data, fields };
}
async function load(req) { const c = await Collection.findOne({ _id: oid(req.params.collectionId, 'Collection'), store: sid(req) }); if (!c) throw NF(); return c; }

router.get('/', asyncHandler(async (req, res) => {
  const [cols, counts] = await Promise.all([
    Collection.find({ store: sid(req) }).sort({ createdAt: 1 }),
    Product.aggregate([{ $match: { store: sid(req) } }, { $unwind: '$collections' }, { $group: { _id: '$collections', n: { $sum: 1 } } }]),
  ]);
  const m = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ collections: cols.map((c) => c.toApi(m.get(String(c._id)) || 0)) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { data, fields } = read(body(req), false);
  if (Object.keys(fields).length) throw badRequest(fields);
  if (await Collection.countDocuments({ store: sid(req) }) >= MAX_COLLECTIONS) throw new AppError('Collection limit reached.', 403, 'collection_limit');
  const c = await createWithSlug(Collection, sid(req), slugify(data.name) || 'collection', data);
  res.status(201).json({ collection: c.toApi(0) });
}));

router.get('/:collectionId', asyncHandler(async (req, res) => {
  const c = await load(req);
  const n = await Product.countDocuments({ store: sid(req), collections: c._id });
  res.json({ collection: c.toApi(n) });
}));

router.patch('/:collectionId', asyncHandler(async (req, res) => {
  const c = await load(req), { data, fields } = read(body(req), true);
  if (Object.keys(fields).length) throw badRequest(fields);
  c.set(data); await c.save(); res.json({ collection: c.toApi() });
}));

// Replace the membership of a collection. Only products of THIS store can be added.
router.put('/:collectionId/products', asyncHandler(async (req, res) => {
  const c = await load(req), ids = body(req).productIds;
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some((i) => typeof i !== 'string' || !/^[a-f0-9]{24}$/i.test(i))) throw badRequest({ productIds: 'Invalid product list.' });
  const unique = [...new Set(ids)];
  const found = await Product.find({ store: sid(req), _id: { $in: unique } }).select('_id').lean();
  if (found.length !== unique.length) throw badRequest({ productIds: 'One or more products do not exist.' });
  await Product.updateMany({ store: sid(req), collections: c._id, _id: { $nin: unique } }, { $pull: { collections: c._id } });
  await Product.updateMany({ store: sid(req), _id: { $in: unique } }, { $addToSet: { collections: c._id } });
  res.json({ collection: c.toApi(unique.length) });
}));

router.delete('/:collectionId', asyncHandler(async (req, res) => {
  const c = await load(req);
  await Product.updateMany({ store: sid(req), collections: c._id }, { $pull: { collections: c._id } });
  await Collection.deleteOne({ _id: c._id, store: sid(req) });
  res.json({ ok: true });
}));

module.exports = router;
