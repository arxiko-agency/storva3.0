'use strict';
// Module 7: store designer API, mounted at /api/stores/:storeId/design (owner only; req.store is the caller's own store, a foreign store is 404).
// Every write goes through services/designs.js, which validates against allow-lists (hex colours, approved fonts, known sections,
// /uploads/ image paths only). No free-form HTML or CSS is ever stored or rendered.
const express = require('express');
const designs = require('../services/designs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { strictLimiter } = require('../middleware/rateLimit');
const { hasFeature, limitOf } = require('../config/plans');
const { upgradeError } = require('../middleware/plan');
const { THEME_PRESETS, cloneJson } = require('../utils/themes');
const { saveStoreImage } = require('../utils/uploads');

const designWriteLimit = strictLimiter(60 * 1000, Number(process.env.DESIGN_RATE_LIMIT) || 60, 'Too many design updates. Please slow down.');
const uploadLimit = strictLimiter(15 * 60 * 1000, 40, 'Too many uploads. Please try again later.');
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

// Free plan: presets, layout and sections are editable; hand-picked colours and fonts need a paid plan (Module 8).
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function isPresetLook(draft) {
  const p = THEME_PRESETS[draft.themePreset];
  if (!p) return false;
  const norm = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v).toLowerCase()]));
  return sameJson(norm(p.colors), norm(draft.colors)) && sameJson(cloneJson(p.typography), draft.typography);
}
async function guardCustomLook(req, input) {
  if (hasFeature(req.store, 'customDesign')) return;
  const { design } = await designs.getOwnerDesignPayload(req.store);
  const cur = design.draft;
  const touchesColors = input.colors !== undefined && !sameJson({ ...cur.colors, ...input.colors }, cur.colors);
  const touchesType = input.typography !== undefined && !sameJson({ ...cur.typography, ...input.typography }, cur.typography);
  const touchesPreset = input.themePreset !== undefined && input.themePreset !== cur.themePreset;
  if (touchesColors || touchesType || touchesPreset) throw upgradeError(req.store, 'customDesign');
}

function createDesignRouter(service = designs) {
  const router = express.Router({ mergeParams: true });

  router.get('/', asyncHandler(async (req, res) => {
    const payload = await service.getOwnerDesignPayload(req.store);
    res.json({ ...payload, plan: { customDesign: hasFeature(req.store, 'customDesign'), removeBranding: hasFeature(req.store, 'removeBranding'), versions: limitOf(req.store, 'designVersions') } });
  }));

  const saveDraft = asyncHandler(async (req, res) => {
    await guardCustomLook(req, body(req));
    res.json(await service.updateDraft(req.store, body(req)));
  });
  router.put('/draft', designWriteLimit, saveDraft);
  router.patch('/draft', designWriteLimit, saveDraft);

  router.post('/preset', designWriteLimit, asyncHandler(async (req, res) => {
    const b = body(req);
    res.json(await service.applyPreset(req.store, { presetId: b.presetId, replaceSections: b.replaceSections === true }));
  }));

  router.post('/publish', designWriteLimit, asyncHandler(async (req, res) => {
    if (!hasFeature(req.store, 'customDesign')) {
      const { design } = await service.getOwnerDesignPayload(req.store);
      if (!isPresetLook(design.draft)) throw new AppError('Your draft uses custom colours or fonts, which need the Pro plan. Pick a theme preset or upgrade, then publish again. Your live store was not changed.', 402, 'upgrade_required', { details: { feature: 'customDesign', requiredPlan: 'pro' } });
    }
    res.json(await service.publishDraft(req.store, { userId: req.user ? req.user._id : null, label: body(req).label, maxHistory: limitOf(req.store, 'designVersions') }));
  }));

  router.post('/discard', designWriteLimit, asyncHandler(async (req, res) => res.json(await service.discardDraft(req.store))));
  router.post('/reset', designWriteLimit, asyncHandler(async (req, res) => res.json(await service.resetDraftToDefault(req.store))));
  router.post('/restore', designWriteLimit, asyncHandler(async (req, res) => {
    const b = body(req);
    if (b.versionId !== undefined && typeof b.versionId !== 'string') throw new AppError('Choose a saved version.', 400, 'invalid_version');
    res.json(await service.restoreVersion(req.store, { versionId: b.versionId, publishNow: b.publishNow === true && hasFeature(req.store, 'customDesign'), userId: req.user ? req.user._id : null, maxHistory: limitOf(req.store, 'designVersions') }));
  }));

  // Banner / story images for sections. Returns a /uploads/<store>/... path that the section settings accept.
  router.post('/images', uploadLimit, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), asyncHandler(async (req, res) => {
    const saved = await saveStoreImage(req.store._id, req.body, { prefix: 'design' });
    res.status(201).json({ url: saved.url });
  }));

  return router;
}

module.exports = createDesignRouter();
module.exports.createDesignRouter = createDesignRouter;
module.exports.isPresetLook = isPresetLook;
