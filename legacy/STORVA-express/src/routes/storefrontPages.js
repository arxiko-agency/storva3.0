'use strict';
// Server-rendered public storefront: /store/:slug, /store/:slug/product/:productSlug, /cart, /checkout, /order/:n.
// Pages read through the same service as the public API. Interactive parts (cart, checkout) are in public/js/storefront.js
// and talk to /api/public/stores/:slug/... .
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/storefront');
const { env } = require('../config/env');
const designs = require('../services/designs');
const { loadSession } = require('../middleware/auth');
const { hasFeature } = require('../config/plans');

const money = (n) => (n == null ? '' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
// JSON for a <script type="application/json"> block: "<" is escaped so data can never close the tag.
// CSS for a <style> block: the generated design CSS never needs "<", so escaping it means the block can never be closed early.
const safeCss = (css) => String(css || '').replace(/</g, '\\3C ');
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const waLink = (store, text) => (store.whatsappNumber ? `https://wa.me/${store.whatsappNumber}${text ? '?text=' + encodeURIComponent(text) : ''}` : '');

function notFound(res) { return res.status(404).render('storefront/notfound', { title: 'Store not found', brand: env.brandName }); }

// Loads the store for every page; renamed stores redirect (301) to the new address, unknown or suspended stores get a 404 page.
router.param('slug', asyncHandler(async (req, res, next) => { // asyncHandler passes (req, res, next) only, so the slug is read from req.params
  const slug = req.params.slug;
  const { store, redirectSlug } = await svc.findPublicStore(slug);
  if (redirectSlug) return res.redirect(301, req.originalUrl.replace(`/store/${slug}`, `/store/${redirectSlug}`));
  if (!store) return notFound(res);
  req.store = store;
  next();
}));

// Module 7: the published design (or, for the logged-in owner only, the unpublished draft via ?preview=draft).
// Anyone else asking for ?preview=draft silently gets the live design, so a draft can never leak.
const loadDesign = asyncHandler(async (req, res, next) => {
  let preview = false;
  if (req.query.preview === 'draft') {
    await new Promise((resolve, reject) => loadSession(req, res, (e) => (e ? reject(e) : resolve())));
    preview = Boolean(req.user && String(req.store.owner) === String(req.user._id));
    res.set('Cache-Control', 'no-store');
  }
  req.design = await designs.getPublicStoreDesign(req.store._id, { previewDraft: preview });
  next();
});

function base(req, extra) {
  const store = svc.publicStore(req.store);
  const d = req.design || null;
  const layout = d ? d.design.layout : {};
  const bodyClass = d ? [`hdr-${layout.headerStyle}`, `hero-${layout.heroStyle}`, `card-${layout.cardStyle}`, layout.showSearch === false ? 'no-search' : '', d.isPreview ? 'is-preview' : ''].filter(Boolean).join(' ') : '';
  return {
    store, money, safeJson, safeCss, waLink: (t) => waLink(store, t), brand: env.brandName, appUrl: env.appUrl, noindex: Boolean(d && d.isPreview), onlinePayments: env.razorpay.enabled,
    design: d ? d.design : null, designCss: d ? d.css : '', fontHref: d ? d.fontHref : null, isPreview: Boolean(d && d.isPreview), bodyClass,
    showWhatsapp: !d || layout.showWhatsapp !== false, showBranding: !hasFeature(req.store, 'removeBranding'), themeColor: d ? d.design.colors.heroBg : '#14122B',
    ...extra,
  };
}

// Module 10: QR code for the store link (print it on bills, packaging, shop counters). Free on every plan.
router.get('/:slug/qr.svg', asyncHandler(async (req, res) => {
  const svg = await require('qrcode').toString(`${env.appUrl}/store/${req.store.slug}?ref=qr`, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#14122B', light: '#FFFFFF' } });
  res.set('Cache-Control', 'public, max-age=3600').type('image/svg+xml');
  if (req.query.download === '1') res.attachment(`${req.store.slug}-qr.svg`);
  res.send(svg);
}));

router.get('/:slug', loadDesign, asyncHandler(async (req, res) => {
  const q = { collection: req.query.collection, q: req.query.q, sort: req.query.sort, page: req.query.page, limit: 12 };
  const sections = req.design.design.sections.filter((x) => x.enabled);
  const featured = sections.find((x) => x.type === 'featured_products');
  const [collections, list, featuredProducts] = await Promise.all([
    svc.publicCollections(req.store), svc.listProducts(req.store, q),
    featured ? svc.featuredProducts(req.store, featured.settings.limit || 4) : Promise.resolve([]),
  ]);
  const active = collections.find((c) => c.slug === req.query.collection) || null;
  const query = { q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '', sort: ['newest', 'price_asc', 'price_desc', 'title'].includes(req.query.sort) ? req.query.sort : 'newest', collection: active ? active.slug : '' };
  // Searching, filtering or paging shows a focused page (collections + catalogue) instead of the full homepage.
  const browsing = Boolean(query.q || query.collection || (Number(req.query.page) > 1));
  const visible = browsing ? sections.filter((x) => x.type === 'collections_bar' || x.type === 'catalog_grid') : sections;
  if (browsing && !visible.some((x) => x.type === 'catalog_grid')) visible.push({ id: 'sec_catalog', type: 'catalog_grid', enabled: true, settings: { title: 'All products', showSort: true } });
  require('../services/analytics').trackQuietly(req.store, req, 'page'); // Module 14
  res.render('storefront/store', base(req, { title: `${req.store.name}${req.store.tagline ? ' – ' + req.store.tagline : ''}`, collections, list, active, query, sections: visible, featuredProducts, browsing, page: 'store' }));
}));

router.get('/:slug/product/:productSlug', loadDesign, asyncHandler(async (req, res) => {
  const product = await svc.getProduct(req.store, req.params.productSlug);
  if (!product) return res.status(404).render('storefront/notfound', { title: 'Product not found', brand: env.brandName, store: svc.publicStore(req.store), backTo: `/store/${req.store.slug}` });
  const related = await svc.relatedProducts(req.store, product.id);
  require('../services/analytics').trackQuietly(req.store, req, 'product', product.id); // Module 14
  res.render('storefront/product', base(req, { title: `${product.title} · ${req.store.name}`, product, related, page: 'product' }));
}));

router.get('/:slug/cart', loadDesign, (req, res) => { res.set('Cache-Control', 'no-store'); res.render('storefront/cart', base(req, { title: `Your cart · ${req.store.name}`, noindex: true, page: 'cart' })); });
router.get('/:slug/checkout', loadDesign, (req, res) => { res.set('Cache-Control', 'no-store'); require('../services/analytics').trackQuietly(req.store, req, 'checkout'); res.render('storefront/checkout', base(req, { title: `Checkout · ${req.store.name}`, noindex: true, page: 'checkout' })); });

// Module 12: the buyer's invoice (same token as the order page; only once the shop has issued it).
router.get('/:slug/order/:orderNumber/invoice', asyncHandler(async (req, res) => {
  const order = await svc.getBuyerOrder(req.store, req.params.orderNumber, req.query.t);
  if (!order || !order.invoiceNumber || order.invoiceNumber.startsWith('PENDING-')) return res.status(404).render('storefront/notfound', { title: 'Invoice not available', brand: env.brandName, store: svc.publicStore(req.store), backTo: `/store/${req.store.slug}`, message: 'The invoice is available once the shop has shipped your order.' });
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).type('html').send(require('../utils/invoiceHtml').renderInvoice({ store: req.store, order }));
}));

router.get('/:slug/order/:orderNumber', loadDesign, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const order = await svc.getBuyerOrder(req.store, req.params.orderNumber, req.query.t);
  if (!order) return res.status(404).render('storefront/notfound', { title: 'Order not found', brand: env.brandName, store: svc.publicStore(req.store), backTo: `/store/${req.store.slug}`, message: 'We could not find this order. Check the link you were given.' });
  res.render('storefront/order', base(req, { title: `Order #${order.orderNumber} · ${req.store.name}`, noindex: true, order: order.toBuyerApi(), token: order.publicToken, page: 'order' }));
}));

module.exports = router;
