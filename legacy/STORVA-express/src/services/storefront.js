'use strict';
// Shared by the public JSON API (routes/public.js) and the server-rendered pages (routes/storefrontPages.js),
// so both always show the same data and apply the same rules.
// SECURITY: every query below carries { store: store._id } (enforced by the tenantScoped plugin). A shopper can only
// ever reach rows of the store whose slug is in the URL; ids from the cart are re-checked against that store.
const crypto = require('crypto');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const AppError = require('../utils/AppError');
const { escapeRegex, toInt } = require('../utils/productInput');
const { readCartItems, readCheckout, MAX_QTY } = require('../utils/checkoutInput');
const { normalizeCouponCode, couponProblem, discountFor } = require('../utils/pricing');
const { badRequest } = require('../utils/validate');
const { env } = require('../config/env');
const { MIN_ONLINE_PAISE } = require('../utils/razorpay');

const r = (p) => (p == null ? null : p / 100);
const ORDER_START = 1000; // first order number is 1001

// ---- Store ---------------------------------------------------------------------------------------
// -> { store } | { redirectSlug } (old address of a renamed store) | {} (unknown or suspended)
async function findPublicStore(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,30}$/.test(slug)) return {};
  const s = await Store.findOne({ slug });
  if (s) return s.status === 'active' ? { store: s } : {};
  const old = await Store.findOne({ previousSlugs: slug }).select('slug status');
  return old && old.status === 'active' ? { redirectSlug: old.slug } : {};
}
const publicStore = (s) => ({ name: s.name, slug: s.slug, tagline: s.tagline, description: s.description, logoUrl: s.logoUrl, whatsappNumber: s.whatsappNumber, contactEmail: s.contactEmail, address: s.address, currency: s.currency });

async function publicCollections(store) {
  const [cols, counts] = await Promise.all([
    Collection.find({ store: store._id }).sort({ createdAt: 1 }),
    Product.aggregate([{ $match: { store: store._id, status: 'active' } }, { $unwind: '$collections' }, { $group: { _id: '$collections', n: { $sum: 1 } } }]),
  ]);
  const m = new Map(counts.map((c) => [String(c._id), c.n]));
  return cols.map((c) => ({ name: c.name, slug: c.slug, description: c.description, productCount: m.get(String(c._id)) || 0 })).filter((c) => c.productCount > 0);
}

// ---- Products ------------------------------------------------------------------------------------
const maxQtyFor = (p, stock) => (p.trackInventory ? Math.max(0, Math.min(MAX_QTY, stock)) : MAX_QTY);
function publicProduct(p) {
  const has = p.variants.length > 0;
  const variants = p.variants.map((v) => ({
    id: String(v._id), key: v.key, options: v.options.map((o) => ({ name: o.name, value: o.value })),
    price: r(v.pricePaise == null ? p.pricePaise : v.pricePaise), maxQty: maxQtyFor(p, v.stock), inStock: maxQtyFor(p, v.stock) > 0,
  }));
  const prices = has ? variants.map((v) => v.price) : [r(p.pricePaise)];
  return {
    id: String(p._id), title: p.title, slug: p.slug, description: p.description, category: p.category,
    price: r(p.pricePaise), priceFrom: Math.min(...prices), compareAtPrice: r(p.compareAtPricePaise),
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })), options: p.options.map((o) => ({ name: o.name, values: o.values })),
    variants, hasVariants: has, maxQty: has ? Math.max(...variants.map((v) => v.maxQty)) : maxQtyFor(p, p.stock),
    inStock: has ? variants.some((v) => v.inStock) : maxQtyFor(p, p.stock) > 0,
  };
}
const SORTS = { newest: { createdAt: -1 }, price_asc: { pricePaise: 1 }, price_desc: { pricePaise: -1 }, title: { title: 1 } };

async function listProducts(store, q = {}) {
  const where = { store: store._id, status: 'active' };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (str(q.collection)) {
    const c = /^[a-z0-9-]{1,80}$/.test(str(q.collection)) ? await Collection.findOne({ store: store._id, slug: str(q.collection) }).select('_id') : null;
    if (!c) return { products: [], total: 0, page: 1, pages: 1, unknownCollection: true };
    where.collections = c._id;
  }
  if (str(q.q)) { const re = new RegExp(escapeRegex(str(q.q).slice(0, 80)), 'i'); where.$or = [{ title: re }, { tags: re }, { category: re }]; }
  if (str(q.category)) where.category = str(q.category).slice(0, 60);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 12, 1), 48), page = Math.max(parseInt(q.page, 10) || 1, 1);
  const [total, rows] = await Promise.all([
    Product.countDocuments(where),
    Product.find(where).sort(SORTS[q.sort] || SORTS.newest).skip((page - 1) * limit).limit(limit),
  ]);
  return { products: rows.map(publicProduct), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
async function getProduct(store, slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,140}$/.test(slug)) return null;
  const p = await Product.findOne({ store: store._id, slug, status: 'active' });
  return p ? publicProduct(p) : null;
}
// Module 7 "Featured products" section: products tagged "featured" first, then the newest, without duplicates.
async function featuredProducts(store, limit = 4) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 4, 2), 16);
  const tagged = await Product.find({ store: store._id, status: 'active', tags: 'featured' }).sort({ updatedAt: -1 }).limit(n);
  if (tagged.length >= n) return tagged.map(publicProduct);
  const rest = await Product.find({ store: store._id, status: 'active', _id: { $nin: tagged.map((p) => p._id) } }).sort({ createdAt: -1 }).limit(n - tagged.length);
  return [...tagged, ...rest].map(publicProduct);
}
async function relatedProducts(store, productId, limit = 4) {
  const rows = await Product.find({ store: store._id, status: 'active', _id: { $ne: productId } }).sort({ createdAt: -1 }).limit(limit);
  return rows.map(publicProduct);
}

// ---- Cart pricing --------------------------------------------------------------------------------
// The browser only stores ids + quantities. Prices, names, stock and coupons are ALWAYS taken from the database here.
async function priceCart(store, rawItems) {
  const read = readCartItems(rawItems);
  if (read.problem) throw new AppError(read.problem, 400, 'bad_cart');
  const ids = [...new Set(read.items.map((i) => i.productId))];
  const products = await Product.find({ store: store._id, _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = read.items.map((it) => {
    const p = byId.get(it.productId);
    const line = { productId: it.productId, variantId: it.variantId, qty: it.qty, ok: true, problem: null, title: p ? p.title : 'Unavailable item', slug: p ? p.slug : null, image: p && p.images[0] ? p.images[0].url : '', variantLabel: '', unitPricePaise: 0, lineTotalPaise: 0, maxQty: 0, _p: p, _v: null };
    if (!p || p.status !== 'active') { line.ok = false; line.problem = 'This product is no longer available.'; return line; }
    let v = null;
    if (p.variants.length) {
      v = it.variantId ? p.variants.id(it.variantId) : null;
      if (!v) { line.ok = false; line.problem = 'Please choose an option again.'; return line; }
      line.variantLabel = v.options.map((o) => `${o.name}: ${o.value}`).join(', ');
    } else if (it.variantId) { line.ok = false; line.problem = 'This option is no longer available.'; return line; }
    line._v = v;
    line.unitPricePaise = v && v.pricePaise != null ? v.pricePaise : p.pricePaise;
    line.maxQty = maxQtyFor(p, v ? v.stock : p.stock);
    if (it.qty > line.maxQty) { line.ok = false; line.problem = line.maxQty === 0 ? 'Out of stock.' : `Only ${line.maxQty} left.`; return line; }
    line.lineTotalPaise = line.unitPricePaise * it.qty;
    return line;
  });
  const subtotalPaise = lines.filter((l) => l.ok).reduce((n, l) => n + l.lineTotalPaise, 0);
  return { lines, subtotalPaise };
}

async function resolveCoupon(store, code, subtotalPaise) {
  const norm = normalizeCouponCode(code);
  if (!norm) return { error: 'Enter a valid coupon code.' };
  const c = await Coupon.findOne({ store: store._id, code: norm });
  if (!c) return { error: 'This coupon code is not valid.' };
  const problem = couponProblem(c, subtotalPaise);
  if (problem) return { error: problem };
  return { coupon: c, discountPaise: discountFor(c, subtotalPaise) };
}

const lineApi = (l) => ({ productId: l.productId, variantId: l.variantId, title: l.title, slug: l.slug, image: l.image, variantLabel: l.variantLabel, unitPrice: r(l.unitPricePaise), qty: l.qty, lineTotal: r(l.lineTotalPaise), maxQty: l.maxQty, ok: l.ok, problem: l.problem });

// Module 12: optional address { state, pincode } and paymentMethod give exact shipping, COD fee and GST (checkout page).
function readQuoteAddress(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const state = typeof a.state === 'string' ? a.state.trim().slice(0, 60) : '', pincode = typeof a.pincode === 'string' || typeof a.pincode === 'number' ? String(a.pincode).trim() : '';
  return state || /^[1-9]\d{5}$/.test(pincode) ? { state, pincode: /^[1-9]\d{5}$/.test(pincode) ? pincode : '' } : null;
}
function chargesApi(c) {
  return { shipping: r(c.shippingPaise), shippingFrom: c.needsAddress ? r(c.shippingFromPaise) : null, needsAddress: c.needsAddress, freeShippingAbove: r(c.freeShippingAbovePaise), codFee: r(c.codFeePaise),
    tax: r(c.taxPaise), taxInclusive: c.taxInclusive, taxBreakdown: c.taxPaise ? { cgst: r(c.tax.cgst), sgst: r(c.tax.sgst), igst: r(c.tax.igst) } : null,
    zone: c.zone ? c.zone.name : null, etaDays: c.etaDays || null, serviceable: c.serviceable, problem: c.problem,
    cod: { available: c.cod.available, reason: c.cod.reason || null, fee: r(c.cod.feePaise) } };
}

async function quote(store, rawItems, couponCode, opts = {}) {
  const { lines, subtotalPaise } = await priceCart(store, rawItems);
  let discountPaise = 0, coupon = null;
  if (couponCode !== undefined && couponCode !== null && couponCode !== '') {
    const res = await resolveCoupon(store, couponCode, subtotalPaise);
    if (res.error) coupon = { code: String(couponCode).toString().trim().toUpperCase().slice(0, 20), valid: false, message: res.error };
    else { discountPaise = res.discountPaise; coupon = { code: res.coupon.code, valid: true, message: `Coupon applied: you save ₹${discountPaise / 100}.`, description: res.coupon.description }; }
  }
  const okLines = lines.filter((l) => l.ok);
  const c = require('./shippingTax').chargesFor(store, okLines, { discountPaise, address: readQuoteAddress(opts.address), paymentMethod: opts.paymentMethod === 'cod' || opts.paymentMethod === 'razorpay' ? opts.paymentMethod : null });
  return { lines: lines.map(lineApi), subtotal: r(subtotalPaise), discount: r(discountPaise), ...chargesApi(c), total: r(c.totalPaise), coupon, canCheckout: lines.length > 0 && lines.every((l) => l.ok) && c.serviceable };
}

// ---- Orders --------------------------------------------------------------------------------------
async function reserveStock(storeId, lines) {
  const done = [];
  for (const l of lines) {
    if (!l._p.trackInventory) continue;
    const filter = { _id: l._p._id, store: storeId, status: 'active' };
    let update;
    if (l._v) { filter.variants = { $elemMatch: { _id: l._v._id, stock: { $gte: l.qty } } }; update = { $inc: { 'variants.$.stock': -l.qty } }; }
    else { filter.stock = { $gte: l.qty }; update = { $inc: { stock: -l.qty } }; }
    const res = await Product.updateOne(filter, update); // atomic: never goes below zero, even with parallel orders
    if (!res.matchedCount) {
      await releaseStock(storeId, done);
      throw new AppError(`"${l.title}" just went out of stock or has fewer units left. Please review your cart.`, 409, 'insufficient_stock', { details: { productId: l.productId } });
    }
    done.push(l);
  }
  return done;
}
async function releaseStock(storeId, lines) {
  for (const l of lines) {
    const pid = l._p ? l._p._id : l.product;
    const vid = l._v ? l._v._id : l.variantId;
    if (vid) await Product.updateOne({ _id: pid, store: storeId, variants: { $elemMatch: { _id: vid } } }, { $inc: { 'variants.$.stock': l.qty } });
    else await Product.updateOne({ _id: pid, store: storeId, trackInventory: true }, { $inc: { stock: l.qty } });
  }
}
async function reserveCoupon(storeId, couponId) {
  const res = await Coupon.updateOne({ _id: couponId, store: storeId, active: true, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }, { $inc: { usedCount: 1 } });
  return res.matchedCount === 1;
}
const releaseCoupon = (storeId, couponId) => Coupon.updateOne({ _id: couponId, store: storeId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });

async function nextOrderNumber(storeId) {
  for (let i = 0; i < 3; i++) {
    try { const c = await Counter.findOneAndUpdate({ store: storeId, key: 'order' }, { $inc: { seq: 1 } }, { new: true, upsert: true }); return ORDER_START + c.seq; }
    catch (e) { if (!(e && e.code === 11000)) throw e; } // two first orders raced to create the counter: retry
  }
  throw new AppError('Could not create the order. Please try again.', 503, 'busy');
}

// -> { order, token, replayed }
async function placeOrder(store, input) {
  const { data, fields } = readCheckout(input);
  if (Object.keys(fields).length) throw badRequest(fields);
  const sid = store._id;

  if (data.idempotencyKey) { // the same checkout submitted twice returns the same order instead of creating a duplicate
    const prior = await Order.findOne({ store: sid, idempotencyKey: data.idempotencyKey });
    if (prior) return { order: prior, replayed: true };
  }
  const { lines, subtotalPaise } = await priceCart(store, input.items);
  const bad = lines.filter((l) => !l.ok);
  if (bad.length) throw new AppError('Some items in your cart changed. Please review your cart.', 409, 'cart_changed', { details: { lines: lines.map(lineApi) } });

  let coupon = null, discountPaise = 0;
  if (data.couponCode) {
    const res = await resolveCoupon(store, data.couponCode, subtotalPaise);
    if (res.error) throw badRequest({ couponCode: res.error });
    coupon = res.coupon; discountPaise = res.discountPaise;
  }
  const online = data.paymentMethod === 'razorpay';
  // Module 12: shipping zone, COD rules and GST – the same calculation the checkout page showed.
  const charges = require('./shippingTax').chargesFor(store, lines, { discountPaise, address: { state: data.shipping.state, pincode: data.shipping.pincode }, paymentMethod: data.paymentMethod });
  if (!charges.serviceable) throw badRequest({ pincode: charges.problem || 'This shop does not deliver to this address.' });
  if (!online && !charges.cod.available) throw badRequest({ paymentMethod: charges.cod.reason || 'Cash on delivery is not available for this order.' });
  const { shippingPaise, totalPaise } = { shippingPaise: charges.shippingPaise, totalPaise: charges.totalPaise };
  const taxCfg = require('./shippingTax').taxOf(store);
  if (online && !env.razorpay.enabled) throw badRequest({ paymentMethod: 'Online payment is not available right now. Please choose cash on delivery.' });
  if (online && totalPaise < MIN_ONLINE_PAISE) throw badRequest({ paymentMethod: 'Orders below 1 rupee can only be paid by cash on delivery.' });
  if (!online && await require('./customers').codBlocked(sid, data.phone)) throw badRequest({ paymentMethod: env.razorpay.enabled ? 'Cash on delivery is not available for this number. Please pay online.' : 'This shop cannot accept a cash on delivery order from this number. Please contact the shop.' }); // Module 11

  let reserved = [], couponReserved = false;
  const rollback = async () => { await releaseStock(sid, reserved).catch(() => {}); if (couponReserved) await releaseCoupon(sid, coupon._id).catch(() => {}); };
  try {
    reserved = await reserveStock(sid, lines);
    if (coupon) {
      couponReserved = await reserveCoupon(sid, coupon._id);
      if (!couponReserved) throw badRequest({ couponCode: 'This coupon has just been fully used.' });
    }
    const now = new Date();
    const order = await Order.create({
      store: sid, orderNumber: await nextOrderNumber(sid), publicToken: crypto.randomBytes(16).toString('hex'),
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
      status: 'pending', statusHistory: [{ status: 'pending', at: now }], paymentMethod: online ? 'razorpay' : 'cod', paymentStatus: online ? 'pending' : 'unpaid',
      customer: { name: data.name, phone: data.phone, email: data.email }, shipping: data.shipping, note: data.note,
      items: lines.map((l, k) => ({ product: l._p._id, variantId: l._v ? l._v._id : null, title: l._p.title, variantLabel: l.variantLabel, sku: (l._v && l._v.sku) || l._p.sku || '', image: l.image, unitPricePaise: l.unitPricePaise, qty: l.qty, lineTotalPaise: l.lineTotalPaise,
        ...(charges.lines[k] ? { taxRate: charges.lines[k].rate, taxPaise: charges.lines[k].taxPaise, taxablePaise: charges.lines[k].taxablePaise, hsn: charges.lines[k].hsn } : {}) })),
      subtotalPaise, discountPaise, shippingPaise, totalPaise, couponCode: coupon ? coupon.code : null, coupon: coupon ? coupon._id : null,
      codFeePaise: charges.codFeePaise, taxPaise: charges.taxPaise, taxInclusive: charges.taxInclusive, tax: { ...charges.tax, chargesTaxPaise: charges.chargesTaxPaise || 0, chargesTaxRate: charges.chargesTaxRate || 0 }, shippingZone: charges.zone ? charges.zone.name : '',
      buyerGstin: data.gstin || '', ...(taxCfg.enabled ? { seller: { legalName: taxCfg.legalName, gstin: taxCfg.gstin, state: taxCfg.state, address: taxCfg.address } } : {}),
    });
    return { order, replayed: false };
  } catch (e) {
    await rollback();
    if (e && e.code === 11000 && data.idempotencyKey) { // a parallel request with the same key won the race
      const prior = await Order.findOne({ store: sid, idempotencyKey: data.idempotencyKey });
      if (prior) return { order: prior, replayed: true };
    }
    throw e;
  }
}

async function getBuyerOrder(store, orderNumber, token) {
  const n = toInt(orderNumber, 1001, 1e9);
  if (n === null || typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
  return Order.findOne({ store: store._id, orderNumber: n, publicToken: token });
}

// Called by the owner order routes when an order is cancelled: return stock and the coupon use, exactly once.
async function releaseOrderInventory(storeId, order) {
  const claimed = await Order.updateOne({ _id: order._id, store: storeId, inventoryReleased: false }, { inventoryReleased: true });
  if (!claimed.matchedCount) return false;
  const tracked = await Product.find({ store: storeId, _id: { $in: order.items.map((i) => i.product) } }).select('trackInventory');
  const trackedIds = new Set(tracked.filter((p) => p.trackInventory).map((p) => String(p._id)));
  await releaseStock(storeId, order.items.filter((i) => trackedIds.has(String(i.product))).map((i) => ({ product: i.product, variantId: i.variantId, qty: i.qty })));
  if (order.coupon) await releaseCoupon(storeId, order.coupon);
  return true;
}

module.exports = { findPublicStore, publicStore, publicCollections, publicProduct, listProducts, getProduct, relatedProducts, featuredProducts, quote, priceCart, resolveCoupon, placeOrder, getBuyerOrder, releaseOrderInventory };
