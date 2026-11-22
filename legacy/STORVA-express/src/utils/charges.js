'use strict';
// Module 12: shipping, cash-on-delivery fee and GST for a cart – ONE pure function used by the cart quote, the checkout page and
// order placement, so what the shopper sees is exactly what the order stores. All amounts are integer paise.
//
// Shipping settings: { mode: 'free'|'flat'|'zones', flatRatePaise, freeAbovePaise, zones: [{ id, name, states: [names] (empty = rest of
//   India), ratePaise, freeAbovePaise, etaDays, codAvailable }], blockedPincodes: ['6820', '110001', ...] (prefixes),
//   cod: { enabled, feePaise, maxOrderPaise } }
// Tax settings: { enabled, state, pricesIncludeTax, defaultRate, shippingTaxable }
const { canonicalState } = require('./india');

const DEFAULT_SHIPPING = Object.freeze({ mode: 'free', flatRatePaise: 0, freeAbovePaise: null, zones: [], blockedPincodes: [], cod: { enabled: true, feePaise: 0, maxOrderPaise: null } });
const DEFAULT_TAX = Object.freeze({ enabled: false, state: '', pricesIncludeTax: true, defaultRate: 0, shippingTaxable: true });

// Splits `amount` across `weights` in proportion, exactly (largest remainder), so the parts always add up to the amount.
function allocate(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!amount || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total), base = raw.map(Math.floor);
  let left = amount - base.reduce((s, x) => s + x, 0);
  raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  return base;
}
const taxOf = (base, rate, inclusive) => (rate > 0 && base > 0 ? Math.round(inclusive ? (base * rate) / (100 + rate) : (base * rate) / 100) : 0);

function resolveZone(S, state) {
  const zones = Array.isArray(S.zones) ? S.zones : [];
  if (!zones.length) return { zone: null };
  if (!state) return { zone: null, needsAddress: true };
  const st = canonicalState(state).toLowerCase();
  const z = zones.find((x) => (x.states || []).some((s) => canonicalState(s).toLowerCase() === st)) || zones.find((x) => !x.states || !x.states.length);
  return z ? { zone: z } : { zone: null, unserviceable: `Sorry, this shop does not deliver to ${canonicalState(state)} yet.` };
}

function computeCharges({ items, discountPaise = 0, address = null, paymentMethod = null, shipping, tax }) {
  const S = { ...DEFAULT_SHIPPING, ...(shipping || {}), cod: { ...DEFAULT_SHIPPING.cod, ...((shipping && shipping.cod) || {}) } };
  const T = { ...DEFAULT_TAX, ...(tax || {}) };
  const subtotal = items.reduce((s, i) => s + i.lineTotalPaise, 0);
  const afterDiscount = Math.max(0, subtotal - discountPaise);
  const out = { subtotalPaise: subtotal, discountPaise, shippingPaise: 0, shippingFromPaise: null, codFeePaise: 0, taxPaise: 0, taxInclusive: Boolean(T.pricesIncludeTax), tax: { cgst: 0, sgst: 0, igst: 0 }, lines: [], zone: null, etaDays: '', needsAddress: false, serviceable: true, problem: null, cod: { available: Boolean(S.cod.enabled), reason: S.cod.enabled ? '' : 'Cash on delivery is not offered by this shop.', feePaise: S.cod.feePaise || 0 }, totalPaise: 0 };

  // ---- serviceability + shipping ----
  const pin = address && address.pincode ? String(address.pincode) : '';
  if (pin && (S.blockedPincodes || []).some((p) => p && pin.startsWith(String(p)))) { out.serviceable = false; out.problem = `Sorry, this shop does not deliver to PIN code ${pin}.`; }
  let rate = 0, freeAbove = S.freeAbovePaise;
  if (S.mode === 'flat') rate = S.flatRatePaise || 0;
  else if (S.mode === 'zones') {
    const r = resolveZone(S, address && address.state);
    if (r.needsAddress) { out.needsAddress = true; const rates = S.zones.map((z) => (z.freeAbovePaise != null && afterDiscount >= z.freeAbovePaise ? 0 : z.ratePaise || 0)); out.shippingFromPaise = rates.length ? Math.min(...rates) : 0; }
    else if (r.unserviceable) { out.serviceable = false; out.problem = out.problem || r.unserviceable; }
    else if (r.zone) {
      out.zone = { id: r.zone.id, name: r.zone.name }; out.etaDays = r.zone.etaDays || ''; rate = r.zone.ratePaise || 0;
      if (r.zone.freeAbovePaise != null) freeAbove = r.zone.freeAbovePaise;
      if (r.zone.codAvailable === false && out.cod.available) { out.cod.available = false; out.cod.reason = `Cash on delivery is not available for ${r.zone.name}.`; }
    }
  }
  if (freeAbove != null && afterDiscount >= freeAbove) rate = 0;
  out.shippingPaise = out.needsAddress ? 0 : rate;
  out.freeShippingAbovePaise = freeAbove != null && rate > 0 ? freeAbove : null;

  // ---- cash on delivery ----
  const preTotal = afterDiscount + out.shippingPaise;
  if (out.cod.available && S.cod.maxOrderPaise != null && preTotal > S.cod.maxOrderPaise) { out.cod.available = false; out.cod.reason = `Cash on delivery is available for orders up to ₹${S.cod.maxOrderPaise / 100}.`; }
  if (paymentMethod === 'cod' && out.cod.available) out.codFeePaise = S.cod.feePaise || 0;

  // ---- GST ----
  if (T.enabled) {
    const inclusive = Boolean(T.pricesIncludeTax);
    const disc = allocate(Math.min(discountPaise, subtotal), items.map((i) => i.lineTotalPaise));
    let maxRate = 0, total = 0;
    out.lines = items.map((i, k) => {
      const r = i.gstRate == null ? Number(T.defaultRate) || 0 : i.gstRate; maxRate = Math.max(maxRate, r);
      const base = i.lineTotalPaise - disc[k], t = taxOf(base, r, inclusive); total += t;
      return { rate: r, taxPaise: t, taxablePaise: inclusive ? base - t : base, hsn: i.hsn || '' };
    });
    const extras = out.shippingPaise + out.codFeePaise;
    out.chargesTaxPaise = T.shippingTaxable === false ? 0 : taxOf(extras, maxRate, inclusive); // shipping follows the main item's rate
    out.chargesTaxRate = T.shippingTaxable === false ? 0 : maxRate;
    total += out.chargesTaxPaise;
    out.taxPaise = total;
    const intra = !address || !address.state || !T.state || canonicalState(address.state).toLowerCase() === canonicalState(T.state).toLowerCase();
    if (intra) { out.tax.cgst = Math.floor(total / 2); out.tax.sgst = total - out.tax.cgst; } else out.tax.igst = total;
    out.intraState = intra;
  }
  out.totalPaise = afterDiscount + out.shippingPaise + out.codFeePaise + (T.enabled && !T.pricesIncludeTax ? out.taxPaise : 0);
  return out;
}

// Splits each row's GST into CGST/SGST so the row CGSTs add up EXACTLY to the order's CGST (invoice rows and the GST
// summary then always match the totals). taxes: per-row tax in paise. Returns [{ cgst, sgst }].
function splitIntra(cgstTotal, taxes) {
  const c = allocate(cgstTotal, taxes.map((t) => Math.max(0, t)));
  return taxes.map((t, i) => ({ cgst: c[i], sgst: t - c[i] }));
}
module.exports = { splitIntra, computeCharges, allocate, taxOf, resolveZone, DEFAULT_SHIPPING, DEFAULT_TAX };
