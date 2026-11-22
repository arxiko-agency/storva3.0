'use strict';
// Module 8 plan gating for owner routes (req.store is already the caller's own store).
const AppError = require('../utils/AppError');
const { hasFeature, cheapestPlanWith, planFor, analyticsAtLeast } = require('../config/plans');

const FEATURE_TEXT = {
  customDesign: 'Custom colours and fonts', coupons: 'Coupons', ai: 'AI product tools', whatsappCommands: 'WhatsApp commands',
  whatsappNotifications: 'WhatsApp order alerts', exports: 'CSV exports', 'analytics:basic': 'Detailed reports', 'analytics:advanced': 'Advanced analytics and GST reports', removeBranding: 'Removing STORVA branding', customDomain: 'Custom domains',
};

// 402 with machine-readable details so the dashboard can show an "Upgrade" button instead of a plain error.
function upgradeError(store, feature) {
  const needed = cheapestPlanWith(feature);
  const label = FEATURE_TEXT[feature] || 'This feature';
  return new AppError(`${label} ${label.endsWith('s') ? 'are' : 'is'} available on the ${needed.name} plan. Upgrade to use ${label.endsWith('s') ? 'them' : 'it'}.`, 402, 'upgrade_required',
    { details: { feature, currentPlan: planFor(store).id, requiredPlan: needed.id } });
}

const requireFeature = (feature) => (req, res, next) => (hasFeature(req.store, feature) ? next() : next(upgradeError(req.store, feature)));
const requireAnalytics = (level) => (req, res, next) => (analyticsAtLeast(req.store, level) ? next() : next(upgradeError(req.store, 'analytics:' + level)));

module.exports = { requireFeature, requireAnalytics, upgradeError, FEATURE_TEXT };
