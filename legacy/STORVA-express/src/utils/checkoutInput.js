'use strict';
// Validation of shopper input: cart lines and checkout form (no DB).
const { normalizePhone, normalizeEmail } = require('./validate');
const { normalizeCouponCode } = require('./pricing');
const { toInt, text } = require('./productInput');

const OID = /^[a-f0-9]{24}$/i;
const MAX_LINES = 30, MAX_QTY = 20;

// raw: [{ productId, variantId?, qty }] -> merged, validated lines or a message.
function readCartItems(raw) {
  if (!Array.isArray(raw)) return { problem: 'Your cart is invalid.' };
  if (!raw.length) return { problem: 'Your cart is empty.' };
  if (raw.length > MAX_LINES * 2) return { problem: 'Your cart has too many items.' };
  const merged = new Map();
  for (const it of raw) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { problem: 'Your cart is invalid.' };
    if (typeof it.productId !== 'string' || !OID.test(it.productId)) return { problem: 'Your cart contains an invalid product.' };
    const variantId = it.variantId == null || it.variantId === '' ? null : it.variantId;
    if (variantId !== null && (typeof variantId !== 'string' || !OID.test(variantId))) return { problem: 'Your cart contains an invalid option.' };
    const qty = toInt(it.qty, 1, MAX_QTY);
    if (qty === null) return { problem: `Quantity must be a whole number from 1 to ${MAX_QTY}.` };
    const key = `${it.productId.toLowerCase()}:${variantId ? variantId.toLowerCase() : ''}`;
    const prev = merged.get(key);
    merged.set(key, { productId: it.productId.toLowerCase(), variantId: variantId ? variantId.toLowerCase() : null, qty: Math.min(MAX_QTY, (prev ? prev.qty : 0) + qty) });
  }
  if (merged.size > MAX_LINES) return { problem: 'Your cart has too many items.' };
  return { items: [...merged.values()] };
}

// Checkout form. Returns { data, fields } like the other readers.
function readCheckout(input) {
  const data = {}, fields = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { data, fields: { name: 'Invalid request.' } };
  const str = (v, min, max) => { const t = text(v); return t !== null && t.length >= min && t.length <= max ? t : null; };

  const name = str(input.name, 2, 80); if (!name) fields.name = 'Enter your name (2 to 80 characters).'; else data.name = name;
  const phone = normalizePhone(input.phone); if (!phone) fields.phone = 'Enter a valid 10-digit Indian mobile number.'; else data.phone = phone;
  if (input.email !== undefined && input.email !== null && input.email !== '') { const e = normalizeEmail(input.email); if (!e) fields.email = 'Enter a valid email address.'; else data.email = e; } else data.email = '';

  const a = input.address && typeof input.address === 'object' && !Array.isArray(input.address) ? input.address : {};
  const line1 = str(a.line1, 3, 200); if (!line1) fields.line1 = 'Enter your address (3 to 200 characters).';
  let line2 = '';
  if (a.line2 !== undefined && a.line2 !== null && a.line2 !== '') { line2 = str(a.line2, 1, 200); if (!line2) { fields.line2 = 'Address line 2 can be up to 200 characters.'; line2 = ''; } }
  const city = str(a.city, 2, 60); if (!city) fields.city = 'Enter your city.';
  const state = str(a.state, 2, 60); if (!state) fields.state = 'Enter your state.'; else if (!require('./india').stateByName(state)) fields.state = 'Choose your state or union territory from the list.'; // Module 12: delivery region + GST place of supply need a real state
  const pincode = typeof a.pincode === 'string' || typeof a.pincode === 'number' ? String(a.pincode).trim() : '';
  if (!/^[1-9]\d{5}$/.test(pincode)) fields.pincode = 'Enter a valid 6-digit PIN code.';
  data.shipping = { line1, line2, city, state: state ? require('./india').canonicalState(state) : state, pincode };
  // Module 12: optional GSTIN for business purchases (printed on the GST invoice).
  if (input.gstin !== undefined && input.gstin !== null && input.gstin !== '') { const I = require('./india'), g = I.normalizeGstin(input.gstin), pr = I.gstinProblem(g); if (pr) fields.gstin = pr; else data.gstin = g; } else data.gstin = '';

  if (input.note !== undefined && input.note !== null && input.note !== '') { const n = str(input.note, 1, 300); if (!n) fields.note = 'Note can be up to 300 characters.'; else data.note = n; } else data.note = '';

  if (input.couponCode !== undefined && input.couponCode !== null && input.couponCode !== '') {
    const c = normalizeCouponCode(input.couponCode); if (!c) fields.couponCode = 'Enter a valid coupon code.'; else data.couponCode = c;
  } else data.couponCode = null;

  // Payment method (Module 6): cash on delivery stays the default, so Module 5 clients that send nothing keep working.
  if (input.paymentMethod === undefined || input.paymentMethod === null || input.paymentMethod === '') data.paymentMethod = 'cod';
  else if (input.paymentMethod === 'cod' || input.paymentMethod === 'razorpay') data.paymentMethod = input.paymentMethod;
  else fields.paymentMethod = 'Choose cash on delivery or online payment.';

  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null && input.idempotencyKey !== '') {
    if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(input.idempotencyKey)) fields.idempotencyKey = 'Invalid request key.'; else data.idempotencyKey = input.idempotencyKey;
  }
  return { data, fields };
}

module.exports = { readCartItems, readCheckout, MAX_QTY, MAX_LINES };
