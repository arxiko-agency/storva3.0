'use strict';
// Module 12: shipping + COD + GST settings (validation and plain views), charges for a cart, and GST invoice numbers.
const crypto = require('crypto');
const Store = require('../models/Store');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const AppError = require('../utils/AppError');
const { badRequest } = require('../utils/validate');
const I = require('../utils/india');
const { computeCharges, DEFAULT_SHIPPING, DEFAULT_TAX } = require('../utils/charges');

const plain = (x) => (x && typeof x.toObject === 'function' ? x.toObject() : x) || {};
function shippingOf(store) { const s = plain(store.shippingSettings); return { ...DEFAULT_SHIPPING, ...s, cod: { ...DEFAULT_SHIPPING.cod, ...plain(s.cod) }, zones: (s.zones || []).map(plain), blockedPincodes: s.blockedPincodes || [] }; }
function taxOf(store) { const t = plain(store.taxSettings); return { ...DEFAULT_TAX, invoicePrefix: 'INV', gstin: '', legalName: '', address: '', ...t }; }

const rupees = (p) => (p == null ? null : p / 100);
function view(store) {
  const s = shippingOf(store), t = taxOf(store);
  return {
    shipping: { mode: s.mode, flatRate: rupees(s.flatRatePaise), freeAbove: rupees(s.freeAbovePaise), blockedPincodes: s.blockedPincodes,
      zones: s.zones.map((z) => ({ id: z.id, name: z.name, states: z.states || [], rate: rupees(z.ratePaise), freeAbove: rupees(z.freeAbovePaise), etaDays: z.etaDays || '', codAvailable: z.codAvailable !== false })),
      cod: { enabled: s.cod.enabled !== false, fee: rupees(s.cod.feePaise || 0), maxOrder: rupees(s.cod.maxOrderPaise) } },
    tax: { enabled: Boolean(t.enabled), gstin: t.gstin, legalName: t.legalName, state: t.state, address: t.address, pricesIncludeTax: t.pricesIncludeTax !== false, defaultRate: t.defaultRate, shippingTaxable: t.shippingTaxable !== false, invoicePrefix: t.invoicePrefix || 'INV' },
    states: I.STATES.map((x) => x.name), gstRates: I.GST_RATES,
  };
}

// Rupee input -> paise (null/'' allowed when `nullable`).
function money(v, field, fields, { nullable = false, max = 10000000 } = {}) {
  if (nullable && (v === null || v === '' || v === undefined)) return null;
  const n = typeof v === 'string' ? Number(v.replace(/[₹,\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max || Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) { fields[field] = 'Enter an amount in rupees.'; return undefined; }
  return Math.round(n * 100);
}

function readShipping(b, fields) {
  const out = {};
  if (b.mode !== undefined) { if (!['free', 'flat', 'zones'].includes(b.mode)) fields['shipping.mode'] = 'Choose free, flat rate or by region.'; else out.mode = b.mode; }
  if (b.flatRate !== undefined) { const p = money(b.flatRate, 'shipping.flatRate', fields, { max: 100000 }); if (p !== undefined) out.flatRatePaise = p; }
  if (b.freeAbove !== undefined) { const p = money(b.freeAbove, 'shipping.freeAbove', fields, { nullable: true }); if (p !== undefined) out.freeAbovePaise = p; }
  if (b.zones !== undefined) {
    if (!Array.isArray(b.zones) || b.zones.length > 12) fields['shipping.zones'] = 'Use up to 12 regions.';
    else {
      const seen = new Set(); let defaults = 0;
      out.zones = b.zones.map((z, i) => {
        const k = `shipping.zones.${i}`;
        if (!z || typeof z !== 'object') { fields[k] = 'Invalid region.'; return null; }
        const name = typeof z.name === 'string' ? z.name.trim().slice(0, 40) : '';
        if (name.length < 2) fields[k + '.name'] = 'Give the region a name.';
        const states = Array.isArray(z.states) ? z.states.map((s) => I.stateByName(s)).filter(Boolean).map((s) => s.name) : [];
        if (Array.isArray(z.states) && states.length !== z.states.length) fields[k + '.states'] = 'Choose states from the list.';
        if (!states.length) defaults++;
        for (const s of states) { if (seen.has(s)) fields[k + '.states'] = `${s} is in two regions.`; seen.add(s); }
        const rate = money(z.rate, k + '.rate', fields, { max: 100000 }), free = money(z.freeAbove, k + '.freeAbove', fields, { nullable: true });
        const eta = typeof z.etaDays === 'string' ? z.etaDays.trim().slice(0, 20) : '';
        if (eta && !/^\d{1,2}(\s*[-–]\s*\d{1,2})?$/.test(eta)) fields[k + '.etaDays'] = 'Delivery days like 2-4.';
        return { id: typeof z.id === 'string' && /^[a-z0-9]{1,16}$/.test(z.id) ? z.id : crypto.randomBytes(4).toString('hex'), name, states, ratePaise: rate || 0, freeAbovePaise: free === undefined ? null : free, etaDays: eta, codAvailable: z.codAvailable !== false };
      }).filter(Boolean);
      if (defaults > 1) fields['shipping.zones'] = 'Only one region can be "rest of India" (no states selected).';
    }
  }
  if (b.blockedPincodes !== undefined) {
    const list = Array.isArray(b.blockedPincodes) ? b.blockedPincodes : typeof b.blockedPincodes === 'string' ? b.blockedPincodes.split(/[\s,]+/) : null;
    const clean = list ? [...new Set(list.map((x) => String(x).trim()).filter(Boolean))] : null;
    if (!clean || clean.length > 500 || !clean.every((x) => /^[1-9]\d{1,5}$/.test(x))) fields['shipping.blockedPincodes'] = 'PIN codes or their first digits (2 to 6 digits), separated by commas.';
    else out.blockedPincodes = clean;
  }
  if (b.cod !== undefined) {
    const c = b.cod && typeof b.cod === 'object' ? b.cod : {};
    if (c.enabled !== undefined) { if (typeof c.enabled !== 'boolean') fields['shipping.cod.enabled'] = 'Must be true or false.'; else out['cod.enabled'] = c.enabled; }
    if (c.fee !== undefined) { const p = money(c.fee, 'shipping.cod.fee', fields, { max: 50000 }); if (p !== undefined) out['cod.feePaise'] = p; }
    if (c.maxOrder !== undefined) { const p = money(c.maxOrder, 'shipping.cod.maxOrder', fields, { nullable: true }); if (p !== undefined) out['cod.maxOrderPaise'] = p; }
  }
  return out;
}

function readTax(b, fields) {
  const out = {};
  const bool = (k) => { if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fields['tax.' + k] = 'Must be true or false.'; else out[k] = b[k]; } };
  ['enabled', 'pricesIncludeTax', 'shippingTaxable'].forEach(bool);
  if (b.gstin !== undefined) {
    const g = I.normalizeGstin(b.gstin);
    if (g) { const p = I.gstinProblem(g); if (p) fields['tax.gstin'] = p; else { out.gstin = g; const st = I.stateByCode(g.slice(0, 2)); if (st) out.state = st.name; } } else out.gstin = '';
  }
  if (b.legalName !== undefined) { if (typeof b.legalName !== 'string' || b.legalName.length > 120) fields['tax.legalName'] = 'Up to 120 characters.'; else out.legalName = b.legalName.trim(); }
  if (b.address !== undefined) { if (typeof b.address !== 'string' || b.address.length > 300) fields['tax.address'] = 'Up to 300 characters.'; else out.address = b.address.trim(); }
  if (b.state !== undefined && out.state === undefined) { const st = b.state ? I.stateByName(b.state) : null; if (b.state && !st) fields['tax.state'] = 'Choose a state from the list.'; else out.state = st ? st.name : ''; }
  if (b.defaultRate !== undefined) { const r = Number(b.defaultRate); if (!I.GST_RATES.includes(r)) fields['tax.defaultRate'] = 'Choose a GST rate.'; else out.defaultRate = r; }
  if (b.invoicePrefix !== undefined) { const p = typeof b.invoicePrefix === 'string' ? b.invoicePrefix.trim().toUpperCase() : ''; if (!/^[A-Z0-9]{1,6}$/.test(p)) fields['tax.invoicePrefix'] = '1 to 6 letters or digits.'; else out.invoicePrefix = p; }
  return out;
}

async function update(store, body) {
  const b = body && typeof body === 'object' ? body : {}, fields = {}, set = {};
  if (b.shipping !== undefined) for (const [k, v] of Object.entries(readShipping(b.shipping || {}, fields))) set['shippingSettings.' + k] = v;
  if (b.tax !== undefined) for (const [k, v] of Object.entries(readTax(b.tax || {}, fields))) set['taxSettings.' + k] = v;
  // GST on: a valid GSTIN and a legal name are required (they are printed on every tax invoice).
  const nextTax = { ...taxOf(store), ...Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('taxSettings.')).map(([k, v]) => [k.slice(12), v])) };
  if (nextTax.enabled && !nextTax.gstin) fields['tax.gstin'] = 'Enter your GSTIN to charge GST.';
  if (nextTax.enabled && !nextTax.legalName) fields['tax.legalName'] = 'Enter the legal business name on your GST registration.';
  const nextMode = set['shippingSettings.mode'] || shippingOf(store).mode, nextZones = set['shippingSettings.zones'] || shippingOf(store).zones;
  if (nextMode === 'zones' && !nextZones.length) fields['shipping.zones'] = 'Add at least one region.';
  if (Object.keys(fields).length) throw badRequest(fields);
  if (Object.keys(set).length) await Store.updateOne({ _id: store._id }, { $set: set });
  return view(await Store.findById(store._id));
}

// Shared by quote + placeOrder. lines come from storefront.priceCart (with _p = product).
function chargesFor(store, lines, { discountPaise = 0, address = null, paymentMethod = null } = {}) {
  return computeCharges({
    items: lines.map((l) => ({ lineTotalPaise: l.lineTotalPaise, gstRate: l._p && l._p.gstRate != null ? l._p.gstRate : null, hsn: (l._p && l._p.hsn) || '' })),
    discountPaise, address, paymentMethod, shipping: shippingOf(store), tax: taxOf(store),
  });
}

// Sequential GST invoice number per store and financial year, e.g. INV/26-27/00042. The order is CLAIMED first (compare-and-set),
// and only the winner takes a number from the counter, so concurrent requests never burn a number and the series has no gaps.
async function assignInvoice(storeId, order, now = new Date()) {
  const ready = (n) => n && !String(n).startsWith('PENDING-');
  if (ready(order.invoiceNumber)) return order.invoiceNumber;
  const claimKey = 'PENDING-' + crypto.randomBytes(6).toString('hex');
  const stale = new Date(now.getTime() - 60 * 1000); // a claim left by a crashed request is taken over after a minute
  const claim = await Order.updateOne({ _id: order._id, store: storeId, $or: [{ invoiceNumber: null }, { invoiceNumber: /^PENDING-/, invoiceDate: { $lt: stale } }] }, { $set: { invoiceNumber: claimKey, invoiceDate: now } });
  if (!claim.modifiedCount) {
    for (let i = 0; i < 20; i++) { const o = await Order.findOne({ _id: order._id, store: storeId }).select('invoiceNumber'); if (ready(o.invoiceNumber)) return o.invoiceNumber; await new Promise((r) => setTimeout(r, 100)); }
    throw new AppError('The invoice is being created. Try again in a moment.', 409, 'busy');
  }
  try {
    const store = await Store.findById(storeId).select('taxSettings');
    const fy = I.financialYear(now), prefix = (store && store.taxSettings && store.taxSettings.invoicePrefix) || 'INV';
    let c;
    for (let i = 0; i < 3 && !c; i++) { try { c = await Counter.findOneAndUpdate({ store: storeId, key: 'invoice:' + fy }, { $inc: { seq: 1 } }, { new: true, upsert: true }); } catch (e) { if (!(e && e.code === 11000)) throw e; } }
    if (!c) throw new AppError('Could not create the invoice number. Please try again.', 503, 'busy');
    const number = `${prefix}/${fy}/${String(c.seq).padStart(5, '0')}`;
    await Order.updateOne({ _id: order._id, store: storeId, invoiceNumber: claimKey }, { $set: { invoiceNumber: number, invoiceDate: now } });
    return number;
  } catch (e) { await Order.updateOne({ _id: order._id, store: storeId, invoiceNumber: claimKey }, { $set: { invoiceNumber: null, invoiceDate: null } }).catch(() => {}); throw e; }
}

module.exports = { view, update, shippingOf, taxOf, chargesFor, assignInvoice, readShipping, readTax };
