'use strict';
// Module 8: plan + billing API, mounted at /api/stores/:storeId/billing (owner only).
const router = require('express').Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { strictLimiter } = require('../middleware/rateLimit');
const billing = require('../services/billing');
const BillingPayment = require('../models/BillingPayment');
const { env } = require('../config/env');
const { PLANS, CYCLES } = require('../config/plans');

const payLimiter = strictLimiter(10 * 60 * 1000, Number(process.env.BILLING_RATE_LIMIT) || 30, 'Too many payment attempts. Please try again in a few minutes.');
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.get('/', asyncHandler(async (req, res) => res.json(await billing.getBilling(req.store))));
router.post('/quote', asyncHandler(async (req, res) => res.json({ quote: await billing.quote(req.store, body(req)) })));
router.post('/checkout', payLimiter, asyncHandler(async (req, res) => res.json({ checkout: await billing.startCheckout(req.store, req.user, body(req)) })));
router.post('/verify', payLimiter, asyncHandler(async (req, res) => res.json(await billing.verifyCheckout(req.store, body(req)))));
// Auto-renew (Razorpay Subscriptions; RAZORPAY_SUBSCRIPTIONS_ENABLED=true). Prepaid checkout above keeps working unchanged.
router.post('/subscribe', payLimiter, asyncHandler(async (req, res) => res.json({ checkout: await billing.startSubscription(req.store, req.user, body(req)) })));
router.post('/subscription/verify', payLimiter, asyncHandler(async (req, res) => res.json(await billing.verifySubscriptionCheckout(req.store, body(req)))));
router.post('/subscription/cancel', payLimiter, asyncHandler(async (req, res) => res.json(await billing.cancelAutoRenew(req.store))));
router.post('/dev-activate', payLimiter, asyncHandler(async (req, res) => res.json(await billing.devActivate(req.store, req.user, body(req)))));

// Printable tax invoice for a paid plan purchase (HTML; "Print / Save as PDF" in the browser).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
router.get('/payments/:paymentId/invoice', asyncHandler(async (req, res) => {
  const id = req.params.paymentId;
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new AppError('Invoice not found.', 404, 'not_found');
  const p = await BillingPayment.findOne({ _id: id, store: req.store._id, status: 'paid' });
  if (!p || p.source === 'dev') throw new AppError('Invoice not found.', 404, 'not_found');
  const gstin = process.env.PLATFORM_GSTIN || '';
  const taxable = gstin ? Math.round(p.amountPaise / 1.18) : p.amountPaise, gst = p.amountPaise - taxable;
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(p.invoiceNumber)}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/invoice.css"></head><body><main class="inv">
<header><div><h1>${esc(process.env.PLATFORM_LEGAL_NAME || env.brandName)}</h1><p>${esc(process.env.PLATFORM_ADDRESS || '')}</p>${gstin ? `<p>GSTIN: ${esc(gstin)}</p>` : ''}</div><div class="r"><h2>${gstin ? 'Tax invoice' : 'Invoice'}</h2><p><b>${esc(p.invoiceNumber)}</b></p><p>${esc(new Date(p.paidAt).toLocaleDateString('en-IN', { dateStyle: 'long' }))}</p></div></header>
<section><h3>Billed to</h3><p><b>${esc(req.store.name)}</b><br>${esc(req.user.name)} · ${esc(req.user.email)}</p></section>
<table><thead><tr><th>Description</th><th>Period</th><th class="r">Amount</th></tr></thead><tbody>
<tr><td>${esc(env.brandName)} ${esc(PLANS[p.plan].name)} plan · ${esc(CYCLES[p.cycle].label)}${p.creditDays ? ` (+${p.creditDays} days credit from previous plan)` : ''}</td><td>${esc(new Date(p.periodStart).toLocaleDateString('en-IN'))} – ${esc(new Date(p.periodEnd).toLocaleDateString('en-IN'))}</td><td class="r">${money(taxable)}</td></tr>
${gstin ? `<tr><td colspan="2" class="r">GST 18% (included in the price)</td><td class="r">${money(gst)}</td></tr>` : ''}
</tbody><tfoot><tr><td colspan="2" class="r"><b>Total paid</b></td><td class="r"><b>${money(p.amountPaise)}</b></td></tr></tfoot></table>
<p class="muted">Paid online via Razorpay${p.razorpayPaymentId ? ` · payment ${esc(p.razorpayPaymentId)}` : ''}. SAC 998314.</p>
<p class="no-print"><button type="button" data-print>Print / Save as PDF</button></p></main><script src="/js/print.js"></script></body></html>`);
}));

module.exports = router;
