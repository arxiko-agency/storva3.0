'use strict';
// Module 8 (plans + billing) unit tests: entitlement, grace period, proration and the price list. No database.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/config/plans');
const { computePeriod, addMonths } = require('../src/services/billing');
const DAY = 864e5;

test('prices match the public pricing page: Pro ₹299 / ₹239 yearly, Advanced ₹599 / ₹479 yearly, Free ₹0', () => {
  assert.equal(P.priceFor('pro', 'monthly'), 29900); assert.equal(P.priceFor('pro', 'yearly'), 239 * 12 * 100);
  assert.equal(P.priceFor('advanced', 'monthly'), 59900); assert.equal(P.priceFor('advanced', 'yearly'), 479 * 12 * 100);
  assert.equal(P.priceFor('free', 'monthly'), 0); assert.equal(P.priceFor('pro', 'weekly'), null);
  assert.equal(P.PLANS.free.limits.activeProducts, 10, 'Free = 10 active products as advertised');
});

test('effective plan: paid plan counts until the end of the grace period, then it is Free; unknown plans are Free; "starter" = Pro', () => {
  const now = new Date('2026-06-10T00:00:00Z');
  assert.equal(P.effectivePlanId({ plan: 'pro', planExpiresAt: new Date(now.getTime() + DAY) }, now), 'pro');
  assert.equal(P.effectivePlanId({ plan: 'pro', planExpiresAt: new Date(now.getTime() - 2 * DAY) }, now), 'pro', 'inside the 3-day grace');
  assert.equal(P.inGrace({ plan: 'pro', planExpiresAt: new Date(now.getTime() - 2 * DAY) }, now), true);
  assert.equal(P.effectivePlanId({ plan: 'pro', planExpiresAt: new Date(now.getTime() - 4 * DAY) }, now), 'free');
  assert.equal(P.effectivePlanId({ plan: 'enterprise' }, now), 'free');
  assert.equal(P.effectivePlanId({ plan: 'starter', planExpiresAt: null }, now), 'pro');
  assert.equal(P.effectivePlanId(null), 'free');
});

test('feature gates follow the plan table', () => {
  const free = { plan: 'free' }, pro = { plan: 'pro' }, adv = { plan: 'advanced' };
  assert.equal(P.hasFeature(free, 'coupons'), false); assert.equal(P.hasFeature(pro, 'coupons'), true);
  assert.equal(P.hasFeature(pro, 'removeBranding'), false); assert.equal(P.hasFeature(adv, 'removeBranding'), true);
  assert.equal(P.analyticsAtLeast(free, 'basic'), false); assert.equal(P.analyticsAtLeast(pro, 'basic'), true); assert.equal(P.analyticsAtLeast(pro, 'advanced'), false);
  assert.equal(P.cheapestPlanWith('ai').id, 'pro'); assert.equal(P.cheapestPlanWith('customDomain').id, 'advanced'); assert.equal(P.cheapestPlanWith('analytics:advanced').id, 'advanced');
});

test('period: new purchase starts now; renewal starts at the current end; monthly adds one calendar month (31 Jan -> 28/29 Feb)', () => {
  const now = new Date('2026-01-31T10:00:00Z');
  const fresh = computePeriod({ plan: 'free' }, 'pro', 'monthly', now);
  assert.equal(fresh.start.getTime(), now.getTime()); assert.equal(fresh.end.getUTCMonth(), 1); assert.ok(fresh.end.getUTCDate() >= 28);
  const end = new Date('2026-02-15T00:00:00Z');
  const renew = computePeriod({ plan: 'pro', planExpiresAt: end }, 'pro', 'yearly', now);
  assert.equal(renew.renewal, true); assert.equal(renew.start.getTime(), end.getTime()); assert.equal(renew.end.getTime(), addMonths(end, 12).getTime());
});

test('upgrade converts unused days at the price ratio; buying a LOWER plan while a higher one runs is refused', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const up = computePeriod({ plan: 'pro', planExpiresAt: new Date(now.getTime() + 20 * DAY) }, 'advanced', 'monthly', now);
  assert.equal(up.upgrade, true); assert.equal(up.creditDays, Math.floor(20 * 29900 / 59900)); // 9 days
  assert.equal(up.end.getTime(), addMonths(now, 1).getTime() + up.creditDays * DAY);
  const down = computePeriod({ plan: 'advanced', planExpiresAt: new Date(now.getTime() + 5 * DAY) }, 'pro', 'monthly', now);
  assert.ok(down.problem);
});
