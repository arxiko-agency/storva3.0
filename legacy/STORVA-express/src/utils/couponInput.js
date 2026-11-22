'use strict';
// Validation of owner coupon input (no DB). API speaks rupees; the database stores paise.
const { normalizeCouponCode } = require('./pricing');
const { toPaise, toInt, text } = require('./productInput');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function date(v) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// partial = PATCH. `existing` (a plain coupon) lets PATCH cross-check values against stored ones.
function readCoupon(input, { partial = false, existing = null } = {}) {
  const data = {}, fields = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { data, fields: { code: 'Invalid request.' } };

  if (!partial) {
    const code = normalizeCouponCode(input.code);
    if (!code) fields.code = 'Code must be 3 to 20 characters: letters, numbers, - or _.'; else data.code = code;
  } else if (has(input, 'code') && existing && normalizeCouponCode(input.code) !== existing.code) fields.code = 'A coupon code cannot be changed. Create a new coupon instead.';

  const type = has(input, 'type') ? input.type : existing && existing.type;
  if (has(input, 'type') || !partial) {
    if (!['percent', 'fixed'].includes(input.type)) fields.type = 'Choose percent or fixed.'; else data.type = input.type;
  }
  if (has(input, 'value') || !partial) {
    if (type === 'percent') { const n = toInt(input.value, 1, 100); if (n === null) fields.value = 'Percent must be a whole number from 1 to 100.'; else data.value = n; }
    else if (type === 'fixed') { const p = toPaise(input.value); if (p === null || p < 100) fields.value = 'Enter an amount of at least ₹1 (up to 2 decimals).'; else data.value = p; }
    else if (!fields.type) fields.value = 'Choose percent or fixed first.';
  }
  if (has(input, 'minOrder')) {
    if (input.minOrder === null || input.minOrder === '') data.minOrderPaise = 0;
    else { const p = toPaise(input.minOrder); if (p === null) fields.minOrder = 'Enter a valid amount in rupees.'; else data.minOrderPaise = p; }
  }
  if (has(input, 'maxDiscount')) {
    if (input.maxDiscount === null || input.maxDiscount === '') data.maxDiscountPaise = null;
    else { const p = toPaise(input.maxDiscount); if (p === null || p < 100) fields.maxDiscount = 'Enter at least ₹1, or leave empty for no cap.'; else data.maxDiscountPaise = p; }
  }
  if (has(input, 'usageLimit')) {
    if (input.usageLimit === null || input.usageLimit === '') data.usageLimit = null;
    else { const n = toInt(input.usageLimit, 1, 1000000); if (n === null) fields.usageLimit = 'Enter a whole number (1 or more), or leave empty for unlimited.'; else data.usageLimit = n; }
  }
  for (const k of ['startsAt', 'expiresAt']) {
    if (has(input, k)) { const d = date(input[k]); if (d === undefined) fields[k] = 'Enter a valid date.'; else data[k] = d; }
  }
  if (has(input, 'description')) { const t = text(input.description); if (t === null || t.length > 200) fields.description = 'Description must be up to 200 characters.'; else data.description = t; }
  if (has(input, 'active')) { if (typeof input.active !== 'boolean') fields.active = 'Must be true or false.'; else data.active = input.active; }

  const s = data.startsAt !== undefined ? data.startsAt : existing && existing.startsAt;
  const e = data.expiresAt !== undefined ? data.expiresAt : existing && existing.expiresAt;
  if (s && e && new Date(e) <= new Date(s) && !fields.expiresAt) fields.expiresAt = 'Expiry must be after the start date.';
  const limit = data.usageLimit !== undefined ? data.usageLimit : existing && existing.usageLimit;
  if (existing && limit != null && limit < (existing.usedCount || 0) && !fields.usageLimit) fields.usageLimit = `This coupon was already used ${existing.usedCount} times.`;
  return { data, fields };
}

module.exports = { readCoupon };
