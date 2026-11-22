'use strict';
const router = require('express').Router();
const { loadSession } = require('../middleware/auth');

router.use(require('./system'));
router.use(loadSession); // populates req.user / req.session when a valid cookie is present
router.use('/auth', require('./auth'));
router.use('/affiliate', require('./affiliate'));  // Affiliate & referral program: registration, dashboard, admin payouts
router.use('/stores', require('./stores'));      // Module 3: stores + tenant-scoped sub-routes
router.use(['/showcase', '/public/showcase'], require('./showcase')); // /public/showcase is what the landing page calls  // Module 3: public gallery
router.use('/public/stores/:slug', require('./public')); // Module 5: public storefront API (no login)
// Later modules mount inside routes/stores.js (scoped) or here for public routes.

module.exports = router;
