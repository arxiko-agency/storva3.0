'use strict';
// Module 9: AI product tools, mounted at /api/stores/:storeId/ai (owner only, Pro and Advanced plans).
const express = require('express');
const router = express.Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { strictLimiter } = require('../middleware/rateLimit');
const { requireFeature } = require('../middleware/plan');
const { limitOf, hasFeature, planFor } = require('../config/plans');
const { env } = require('../config/env');
const ai = require('../services/ai');
const P = require('../utils/aiPrompts');
const Product = require('../models/Product');
const { saveStoreImage, readStoreImage, removeStoreFile } = require('../utils/uploads');
const { slugify } = require('../utils/slug');

const aiLimiter = strictLimiter(60 * 1000, Number(process.env.AI_RATE_LIMIT) || 20, 'Too many AI requests. Please wait a moment.');
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.get('/', asyncHandler(async (req, res) => {
  const used = await ai.creditsUsedThisMonth(req.store._id);
  const limit = limitOf(req.store, 'aiCreditsPerMonth') || 0;
  res.json({ configured: ai.configured(), enabled: hasFeature(req.store, 'ai'), plan: planFor(req.store).id, credits: { used, limit, left: Math.max(0, limit - used) }, costs: P.COSTS,
    languages: Object.entries(P.LANGUAGES).map(([id, label]) => ({ id, label })), tones: Object.entries(P.TONES).map(([id, label]) => ({ id, label })), lengths: Object.keys(P.LENGTHS) });
}));

// One endpoint per tool. "photo" also accepts { productId, imageId } to analyse an image already uploaded to that product.
router.post('/:tool(describe|improve|titles|tags|translate|caption|photo)', requireFeature('ai'), aiLimiter, asyncHandler(async (req, res) => {
  const tool = req.params.tool, b = body(req), input = ai.readInput(b);
  let image = null;
  if (tool === 'photo') {
    if (typeof b.productId !== 'string' || !/^[a-f0-9]{24}$/i.test(b.productId)) throw new AppError('Choose a product photo.', 400, 'validation_error', { fields: { image: 'Choose a product photo.' } });
    const p = await Product.findOne({ _id: b.productId, store: req.store._id });
    const img = p && (typeof b.imageId === 'string' ? p.images.find((i) => String(i._id) === b.imageId) : p.images[0]);
    const buf = img && await readStoreImage(req.store._id, img.url);
    if (!buf) throw new AppError('That photo could not be found. Upload it to the product first.', 404, 'not_found');
    image = { buffer: buf, mime: img.url.endsWith('.png') ? 'image/png' : img.url.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
    if (!input.title) input.title = p.title;
  } else ai.requireBasics(tool, input);
  res.json(await ai.run(req.store, tool, input, { image }));
}));

// "Send a photo, get a draft": uploads the photo, asks the AI for title/description/category/tags, and creates a DRAFT product.
// The owner then sets the price and stock and activates it. A failed AI call removes the uploaded file and creates nothing.
router.post('/product-from-photo', requireFeature('ai'), aiLimiter, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), asyncHandler(async (req, res) => {
  const total = Math.min(env.maxProductsPerStore, limitOf(req.store, 'totalProducts'));
  if (await Product.countDocuments({ store: req.store._id }) >= total) throw new AppError(`Your plan allows up to ${total} products in total.`, 403, 'product_limit');
  const saved = await saveStoreImage(req.store._id, req.body, { prefix: 'ai' });
  const lang = typeof req.query.language === 'string' && P.LANGUAGES[req.query.language] ? req.query.language : 'en';
  const hint = typeof req.query.hint === 'string' ? P.clean(req.query.hint, 200) : '';
  try {
    const out = await ai.run(req.store, 'photo', { language: lang, keywords: hint, tone: 'friendly', length: 'medium' }, { image: { buffer: req.body, mime: saved.mime } });
    const r = out.result;
    const { createWithSlug } = require('./products').helpers;
    const priceRupees = r.priceHint ? Math.round((r.priceHint.low + r.priceHint.high) / 2) : 0;
    const product = await createWithSlug(Product, req.store._id, slugify(r.title) || 'product', {
      title: r.title && r.title.trim().length >= 2 ? r.title.trim().slice(0, 120) : 'New product', description: [r.description, r.attributes.length ? '\n' + r.attributes.join('\n') : ''].join('').slice(0, 5000),
      category: r.category, tags: r.tags, status: 'draft', pricePaise: priceRupees * 100, stock: 0, images: [{ url: saved.url, alt: r.title.slice(0, 120) }],
    });
    res.status(201).json({ product: product.toApi(), suggestion: r, creditsLeft: out.creditsLeft });
  } catch (e) { await removeStoreFile(req.store._id, saved.url); throw e; }
}));

module.exports = router;
