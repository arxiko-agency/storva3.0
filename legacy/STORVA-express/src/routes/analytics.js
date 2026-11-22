'use strict';
// Module 14: reports for the store owner, mounted at /api/stores/:storeId/analytics.
//   GET /?days=7|30|90|365 or ?from=YYYY-MM-DD&to=YYYY-MM-DD   report; sections above the plan come back in `locked`
//   GET /export/orders.csv | /export/products.csv              (Pro+: exports)
//   GET /gst  and  /gst/:part.csv (b2b | b2c | hsn)            (Advanced: GST filing summary)
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const A = require('../services/analytics');
const { requireFeature, requireAnalytics } = require('../middleware/plan');
const { sendCsv } = require('../utils/csv');

router.get('/', asyncHandler(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await A.report(req.store, req.query)); }));

router.get('/export/:kind(orders|products).csv', requireFeature('exports'), asyncHandler(async (req, res) => {
  const { range, header, rows } = req.params.kind === 'orders' ? await A.ordersCsvRows(req.store, req.query) : await A.productsCsvRows(req.store, req.query);
  sendCsv(res, `${req.params.kind}-${req.store.slug}-${range.from}-to-${range.to}.csv`, header, rows);
}));

router.get('/gst', requireAnalytics('advanced'), asyncHandler(async (req, res) => res.json(await A.gstReport(req.store, req.query))));
router.get('/gst/:part(b2b|b2c|hsn).csv', requireAnalytics('advanced'), asyncHandler(async (req, res) => {
  const g = await A.gstReport(req.store, req.query), p = req.params.part;
  const T = {
    b2b: [['Invoice number', 'Invoice date', 'Buyer GSTIN', 'Buyer name', 'Place of supply', 'Invoice value', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST'], g.b2b.map((x) => [x.invoice, x.date, x.gstin, x.name, x.placeOfSupply, x.invoiceValue, x.rate, x.taxable, x.igst, x.cgst, x.sgst])],
    b2c: [['Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST'], g.b2c.map((x) => [x.placeOfSupply, x.rate, x.taxable, x.igst, x.cgst, x.sgst])],
    hsn: [['HSN/SAC', 'Description', 'Rate %', 'Quantity', 'Taxable value', 'Total tax', 'IGST', 'CGST', 'SGST'], g.hsn.map((x) => [x.hsn, x.description, x.rate, x.qty, x.taxable, x.tax, x.igst, x.cgst, x.sgst])],
  }[p];
  sendCsv(res, `gst-${p}-${req.store.slug}-${g.range.from}-to-${g.range.to}.csv`, T[0], T[1]);
}));
module.exports = router;
