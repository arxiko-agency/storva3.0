'use strict';
const router = require('express').Router();
const Store = require('../models/Store');
const asyncHandler = require('../utils/asyncHandler');

// Public gallery of stores whose owners opted in. Exposes only name, slug, tagline and logo.
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
  const stores = await Store.find({ showcase: true, status: 'active' }).sort({ createdAt: -1 }).limit(limit);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ stores: stores.map((s) => s.toPublicJSON()) });
}));

module.exports = router;
