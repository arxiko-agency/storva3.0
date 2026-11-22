'use strict';
// Pure validation/normalisation for product input (no DB access, fully unit-tested).
// Money: the API speaks rupees (number, max 2 decimals); the database stores integer paise.
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const text = (v) => (typeof v === 'string' ? v.replace(CTRL, '').trim() : null);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function toPaise(v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000000) return null;
  const p = Math.round(v * 100);
  return Math.abs(p / 100 - v) < 1e-9 ? p : null; // reject 10.999
}
function toInt(v, min, max) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return Number.isInteger(v) && v >= min && v <= max ? v : null;
}
const STATUSES = ['draft', 'active', 'archived'];
const variantKey = (names, optionsObj) => names.map((n) => optionsObj[n]).join('|');

function readOptions(raw, fields) {
  if (!Array.isArray(raw) || raw.length > 3) { fields.options = 'Use up to 3 options (for example Size, Color).'; return null; }
  const out = [], seen = new Set();
  for (const o of raw) {
    const name = o && text(o.name);
    if (!name || name.length > 30 || seen.has(name.toLowerCase())) { fields.options = 'Each option needs a unique name (1 to 30 characters).'; return null; }
    seen.add(name.toLowerCase());
    if (!Array.isArray(o.values) || !o.values.length || o.values.length > 20) { fields.options = `Option "${name}" needs 1 to 20 values.`; return null; }
    const vals = [], vs = new Set();
    for (const v of o.values) {
      const t = text(v);
      if (!t || t.length > 30 || t.includes('|') || vs.has(t.toLowerCase())) { fields.options = `Option "${name}" has an empty, duplicate or invalid value.`; return null; }
      vs.add(t.toLowerCase()); vals.push(t);
    }
    out.push({ name, values: vals });
  }
  return out;
}

function readVariants(raw, options, existing, fields) {
  if (!Array.isArray(raw) || raw.length > 100) { fields.variants = 'Provide up to 100 variants.'; return null; }
  if (!options.length) { if (raw.length) fields.variants = 'Add options (size, color...) before adding variants.'; return []; }
  const names = options.map((o) => o.name), keys = new Set(), idByKey = new Map((existing || []).map((v) => [v.key, v._id]));
  const out = [];
  for (const v of raw) {
    const o = v && v.options && typeof v.options === 'object' && !Array.isArray(v.options) ? v.options : null;
    if (!o || Object.keys(o).length !== names.length) { fields.variants = 'Every variant must choose a value for each option.'; return null; }
    const chosen = {};
    for (const op of options) {
      const val = text(o[op.name]);
      if (!val || !op.values.includes(val)) { fields.variants = `"${op.name}" must be one of: ${op.values.join(', ')}.`; return null; }
      chosen[op.name] = val;
    }
    const key = variantKey(names, chosen);
    if (keys.has(key)) { fields.variants = 'Two variants have the same combination.'; return null; }
    keys.add(key);
    let pricePaise = null;
    if (v.price !== undefined && v.price !== null && v.price !== '') { pricePaise = toPaise(v.price); if (pricePaise === null) { fields.variants = 'Variant price must be a valid amount in rupees.'; return null; } }
    const stock = v.stock === undefined ? 0 : toInt(v.stock, 0, 1000000);
    if (stock === null) { fields.variants = 'Variant stock must be a whole number (0 to 1,000,000).'; return null; }
    const sku = v.sku === undefined ? '' : text(v.sku);
    if (sku === null || sku.length > 64) { fields.variants = 'Variant SKU must be up to 64 characters.'; return null; }
    const row = { key, options: names.map((n) => ({ name: n, value: chosen[n] })), sku, pricePaise, stock };
    if (idByKey.has(key)) row._id = idByKey.get(key); // keep ids stable so carts/orders keep pointing at the same variant
    out.push(row);
  }
  return out;
}

// partial=false → create (title and price required). Returns { data, fields }.
function readProduct(input, { partial = false, existingVariants = [] } = {}) {
  const data = {}, fields = {};
  const str = (k, label, min, max, req) => {
    if (!has(input, k)) { if (!partial && req) fields[k] = `Enter ${label}.`; return; }
    const v = text(input[k]);
    if (v === null || v.length < min || v.length > max) fields[k] = `${label[0].toUpperCase() + label.slice(1)} must be ${min ? `${min} to ` : 'up to '}${max} characters.`; else data[k] = v;
  };
  str('title', 'a product title', 2, 120, true); str('description', 'a description', 0, 5000);
  str('sku', 'a SKU', 0, 64); str('category', 'a category', 0, 60);
  if (has(input, 'status')) { if (!STATUSES.includes(input.status)) fields.status = 'Status must be draft, active or archived.'; else data.status = input.status; }
  if (has(input, 'price')) { const p = toPaise(input.price); if (p === null) fields.price = 'Enter a valid price in rupees.'; else data.pricePaise = p; }
  else if (!partial) fields.price = 'Enter a price.';
  if (has(input, 'compareAtPrice')) {
    if (input.compareAtPrice === null || input.compareAtPrice === '') data.compareAtPricePaise = null;
    else { const p = toPaise(input.compareAtPrice); if (p === null) fields.compareAtPrice = 'Enter a valid amount in rupees.'; else data.compareAtPricePaise = p; }
  }
  if (has(input, 'gstRate')) { // Module 12
    if (input.gstRate === null || input.gstRate === '') data.gstRate = null;
    else { const r = Number(input.gstRate); if (!require('./india').GST_RATES.includes(r)) fields.gstRate = 'Choose a GST rate: 0, 0.25, 3, 5, 12, 18, 28 or 40%.'; else data.gstRate = r; }
  }
  if (has(input, 'hsn')) { const h = typeof input.hsn === 'string' ? input.hsn.trim() : input.hsn == null ? '' : String(input.hsn); if (h && !require('./india').validHsn(h)) fields.hsn = 'HSN codes are 4, 6 or 8 digits.'; else data.hsn = h; }
  if (has(input, 'trackInventory')) { if (typeof input.trackInventory !== 'boolean') fields.trackInventory = 'Must be true or false.'; else data.trackInventory = input.trackInventory; }
  if (has(input, 'stock')) { const n = toInt(input.stock, 0, 1000000); if (n === null) fields.stock = 'Stock must be a whole number (0 to 1,000,000).'; else data.stock = n; }
  if (has(input, 'tags')) {
    if (!Array.isArray(input.tags) || input.tags.length > 20) fields.tags = 'Use up to 20 tags.';
    else { const t = input.tags.map(text); if (t.some((x) => !x || x.length > 30)) fields.tags = 'Each tag must be 1 to 30 characters.'; else data.tags = [...new Set(t.map((x) => x.toLowerCase()))]; }
  }
  if (has(input, 'options') || has(input, 'variants')) {
    if (has(input, 'options') !== has(input, 'variants')) fields.variants = 'Send options and variants together.';
    else {
      const options = readOptions(input.options, fields);
      if (options) { const variants = readVariants(input.variants, options, existingVariants, fields); if (variants) { data.options = options; data.variants = variants; } }
    }
  }
  if (data.compareAtPricePaise != null && data.pricePaise != null && data.compareAtPricePaise < data.pricePaise) fields.compareAtPrice = 'Compare-at price must be at least the price.';
  return { data, fields };
}

// Image type by magic bytes, never by the client-declared Content-Type or file name.
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { toPaise, toInt, readProduct, readOptions, readVariants, sniffImage, escapeRegex, text, STATUSES, variantKey };
