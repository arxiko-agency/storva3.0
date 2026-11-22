'use strict';
// Module 8: the single source of truth for what each plan includes. Prices match the public landing page (public/js/app.js CONFIG.plans).
// Change a number here and every check (product limits, AI credits, feature gates, billing amounts, the dashboard Plan tab) follows.
// Limits: null = unlimited. Prices are in paise. Yearly prices are charged up front for 12 months.
const PLANS = Object.freeze({
  free: Object.freeze({
    id: 'free', name: 'Free', rank: 0, tagline: 'Launch your first store at no cost.',
    price: { monthly: 0, yearly: 0 },
    limits: { activeProducts: 10, totalProducts: 100, stores: 1, aiCreditsPerMonth: 0, designVersions: 3 },
    features: { customDesign: false, coupons: false, ai: false, whatsappCommands: false, whatsappProductUpload: true, whatsappNotifications: false, analytics: 'overview', exports: false, removeBranding: false, customDomain: false, prioritySupport: false },
    highlights: ['10 active products', 'Hosted storefront', 'WhatsApp product upload', 'Basic order management', 'QR code'],
  }),
  pro: Object.freeze({
    id: 'pro', name: 'Pro', rank: 1, popular: true, tagline: 'AI-assisted creation and WhatsApp commands.',
    price: { monthly: 29900, yearly: 239 * 12 * 100 },
    limits: { activeProducts: 500, totalProducts: 2000, stores: 1, aiCreditsPerMonth: 200, designVersions: 15 },
    features: { customDesign: true, coupons: true, ai: true, whatsappCommands: true, whatsappProductUpload: true, whatsappNotifications: true, analytics: 'basic', exports: true, removeBranding: false, customDomain: false, prioritySupport: false },
    highlights: ['Everything in Free', '500 active products', 'AI product creation (200 credits / month)', 'WhatsApp commands & order alerts', 'Coupons and custom store design', 'Basic analytics & CSV exports'],
  }),
  advanced: Object.freeze({
    id: 'advanced', name: 'Advanced', rank: 2, tagline: 'Deeper analytics and higher AI usage.',
    price: { monthly: 59900, yearly: 479 * 12 * 100 },
    limits: { activeProducts: 5000, totalProducts: 10000, stores: 3, aiCreditsPerMonth: 1000, designVersions: 15 },
    features: { customDesign: true, coupons: true, ai: true, whatsappCommands: true, whatsappProductUpload: true, whatsappNotifications: true, analytics: 'advanced', exports: true, removeBranding: true, customDomain: true, prioritySupport: true },
    highlights: ['Everything in Pro', '5,000 active products, up to 3 stores', 'Higher AI usage (1,000 credits / month)', 'Advanced analytics, funnel & GST reports', 'Remove "Powered by STORVA"', 'Custom domain & priority support'],
  }),
});
const PLAN_IDS = Object.keys(PLANS);
const CYCLES = Object.freeze({ monthly: { months: 1, label: 'Monthly' }, yearly: { months: 12, label: 'Yearly' } });
const ANALYTICS_RANK = { overview: 0, basic: 1, advanced: 2 };

// 'starter' was the placeholder name in the Module 3 schema; it is treated as Pro so no existing store loses features.
const normalizePlanId = (id) => (id === 'starter' ? 'pro' : PLAN_IDS.includes(id) ? id : 'free');

// After the paid period ends the store keeps its features for a short grace period (renewal reminders keep coming), then counts as Free.
const graceMs = () => Math.min(14, Math.max(0, Number(process.env.PLAN_GRACE_DAYS ?? 3))) * 864e5;

// The plan a store is entitled to RIGHT NOW. A paid plan past its grace period counts as Free even before the expiry job runs.
function effectivePlanId(store, now = new Date()) {
  if (!store) return 'free';
  const id = normalizePlanId(store.plan);
  if (id === 'free') return 'free';
  if (store.planExpiresAt && new Date(store.planExpiresAt).getTime() + graceMs() <= now.getTime()) return 'free';
  return id;
}
const inGrace = (store, now = new Date()) => Boolean(store && store.planExpiresAt && normalizePlanId(store.plan) !== 'free' && new Date(store.planExpiresAt) <= now && effectivePlanId(store, now) !== 'free');
const planFor = (store, now) => PLANS[effectivePlanId(store, now)];
const hasFeature = (store, feature, now) => {
  const f = planFor(store, now).features[feature];
  if (feature === 'analytics') return f;
  return f === true;
};
const analyticsAtLeast = (store, level) => ANALYTICS_RANK[planFor(store).features.analytics] >= ANALYTICS_RANK[level];
const limitOf = (store, key, now) => planFor(store, now).limits[key];
const cheapestPlanWith = (feature) => Object.values(PLANS).find((p) => p.features[feature] === true || (feature.startsWith('analytics:') && ANALYTICS_RANK[p.features.analytics] >= ANALYTICS_RANK[feature.split(':')[1]])) || PLANS.advanced;
const priceFor = (planId, cycle) => (PLANS[planId] && CYCLES[cycle] ? PLANS[planId].price[cycle] : null);

function publicPlans() {
  return PLAN_IDS.map((id) => {
    const p = PLANS[id];
    return { id, name: p.name, tagline: p.tagline, popular: Boolean(p.popular), rank: p.rank, price: { monthly: p.price.monthly / 100, yearly: p.price.yearly / 100, yearlyPerMonth: Math.round(p.price.yearly / 12) / 100 }, limits: { ...p.limits }, features: { ...p.features }, highlights: [...p.highlights] };
  });
}

module.exports = { PLANS, PLAN_IDS, CYCLES, graceMs, inGrace, normalizePlanId, effectivePlanId, planFor, hasFeature, analyticsAtLeast, limitOf, cheapestPlanWith, priceFor, publicPlans };
