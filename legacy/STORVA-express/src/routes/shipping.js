'use strict';
// Module 12: delivery charges, cash-on-delivery rules and GST settings, mounted at /api/stores/:storeId/shipping.
//   GET  /          settings + Indian states + GST rates
//   PUT  /          { shipping?: {...}, tax?: {...} } partial update (validated in services/shippingTax.js)
//   POST /preview   { subtotal, state, pincode, paymentMethod } what a shopper would pay (to check the settings)
const express = require('express');
const router = express.Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/shippingTax');
const { computeCharges } = require('../utils/charges');

router.get('/', asyncHandler(async (req, res) => res.json(svc.view(req.store))));
router.put('/', asyncHandler(async (req, res) => res.json(await svc.update(req.store, req.body))));
router.post('/preview', asyncHandler(async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const sub = Math.round(Math.min(Math.max(Number(b.subtotal) || 0, 0), 10000000) * 100);
  const c = computeCharges({ items: [{ lineTotalPaise: sub, gstRate: null }], address: { state: typeof b.state === 'string' ? b.state : '', pincode: typeof b.pincode === 'string' ? b.pincode : '' }, paymentMethod: b.paymentMethod === 'cod' ? 'cod' : 'razorpay', shipping: svc.shippingOf(req.store), tax: svc.taxOf(req.store) });
  const r = (p) => (p == null ? null : p / 100);
  res.json({ shipping: r(c.shippingPaise), codFee: r(c.codFeePaise), tax: r(c.taxPaise), taxInclusive: c.taxInclusive, taxBreakdown: { cgst: r(c.tax.cgst), sgst: r(c.tax.sgst), igst: r(c.tax.igst) }, total: r(c.totalPaise), zone: c.zone ? c.zone.name : null, etaDays: c.etaDays || null, serviceable: c.serviceable, problem: c.problem, cod: c.cod.available, codReason: c.cod.reason || null });
}));
module.exports = router;
