'use strict';
// Pure coupon + price rules (no DB, no framework). Money is always integer paise.
const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;

// "  diwali-10 " -> "DIWALI-10"; anything that is not a short plain code -> null.
function normalizeCouponCode(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return COUPON_CODE_RE.test(c) ? c : null;
}

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Returns null when the coupon can be used for this subtotal right now, otherwise a message for the shopper.
// `c` is a plain object: { active, startsAt, expiresAt, usageLimit, usedCount, minOrderPaise }.
function couponProblem(c, subtotalPaise, now = new Date()) {
  if (!c || !c.active) return 'This coupon is not valid.';
  if (c.startsAt && now < new Date(c.startsAt)) return 'This coupon is not active yet.';
  if (c.expiresAt && now >= new Date(c.expiresAt)) return 'This coupon has expired.';
  if (c.usageLimit != null && (c.usedCount || 0) >= c.usageLimit) return 'This coupon has been fully used.';
  if (c.minOrderPaise && subtotalPaise < c.minOrderPaise) return `Add items worth ${rupees(c.minOrderPaise - subtotalPaise)} more to use this coupon (minimum order ${rupees(c.minOrderPaise)}).`;
  return null;
}

// Discount in paise. percent: floor(subtotal * value / 100), optionally capped; fixed: value. Never more than the subtotal, never negative.
function discountFor(c, subtotalPaise) {
  if (!c || !(subtotalPaise > 0)) return 0;
  let d = c.type === 'percent' ? Math.floor((subtotalPaise * c.value) / 100) : c.value;
  if (c.type === 'percent' && c.maxDiscountPaise) d = Math.min(d, c.maxDiscountPaise);
  return Math.max(0, Math.min(d, subtotalPaise));
}

module.exports = { COUPON_CODE_RE, normalizeCouponCode, couponProblem, discountFor, rupees };
