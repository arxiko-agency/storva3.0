'use strict';
// Module 14: visitor counting and sales reports.
//
// Visitors are counted WITHOUT cookies or stored IPs: a visitor is HMAC(secret + India day, store + IP + user agent), truncated,
// kept for two days only to make "distinct visitors today" distinct (same approach as privacy-first analytics tools). Bots,
// link previews (WhatsApp/Facebook crawlers), prefetches and the owner's draft previews are not counted.
// Sales are always computed from orders: a sale = an order that is not cancelled and is not an unpaid online order; net = total - refunds.
const crypto = require('crypto');
const mongoose = require('mongoose');
const { StoreStat, VisitMark, SOURCES } = require('../models/StoreStat');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const { analyticsAtLeast } = require('../config/plans');

const TZ = 'Asia/Kolkata', IST_MS = 330 * 60 * 1000, DAY_MS = 864e5;
const istDay = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const dayStart = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST_MS); // India midnight as a UTC instant
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);

// ---------------- tracking ----------------
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|discordbot|preview|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch|go-http|java\//i;
const secret = () => process.env.ANALYTICS_SECRET || process.env.JWT_SECRET || 'storva-dev-analytics';
const visitorHash = (store, req, day) => crypto.createHmac('sha256', secret() + ':' + day).update(`${store._id}|${req.ip}|${req.get('user-agent') || ''}`).digest('base64url').slice(0, 22);

function classifySource(req) {
  const utm = typeof req.query.utm_source === 'string' ? req.query.utm_source.toLowerCase() : typeof req.query.ref === 'string' ? req.query.ref.toLowerCase() : '';
  const pick = (s) => (/whatsapp|^wa$/.test(s) ? 'whatsapp' : /insta|^ig$/.test(s) ? 'instagram' : /facebook|^fb$|meta/.test(s) ? 'facebook' : /google/.test(s) ? 'google' : /youtube|youtu\.be/.test(s) ? 'youtube' : /twitter|^x$|t\.co|x\.com/.test(s) ? 'x' : /^qr$/.test(s) ? 'qr' : null);
  if (utm) return pick(utm) || 'other';
  const ref = req.get('referer');
  if (!ref) return 'direct';
  let host; try { host = new URL(ref).hostname.toLowerCase(); } catch { return 'direct'; }
  if (host === req.hostname) return null; // moving around inside the store: not a new arrival
  return pick(host) || 'other';
}
const shouldCount = (req) => req.method === 'GET' && !BOT.test(req.get('user-agent') || '') && !/prefetch|prerender/i.test(req.get('sec-purpose') || req.get('purpose') || '') && req.query.preview !== 'draft';

// First time this visitor does `step` today? (atomic insert on a unique index)
async function firstTime(store, day, h, step) {
  try { await VisitMark.create({ store: store._id, day, h, step }); return true; } catch (e) { if (e && e.code === 11000) return false; throw e; }
}
// kind: 'page' | 'product' | 'cart_add' | 'checkout'
async function track(store, req, kind, productId) {
  if (kind !== 'cart_add' && !shouldCount(req)) return;
  if (kind === 'cart_add' && BOT.test(req.get('user-agent') || '')) return;
  const day = istDay(), h = visitorHash(store, req, day), inc = {};
  if (kind === 'page' || kind === 'product' || kind === 'checkout') inc.pageViews = 1;
  if (await firstTime(store, day, h, 'visit')) { inc.visitors = 1; const src = classifySource(req) || 'direct'; inc['sources.' + src] = 1; }
  if (kind === 'product') { inc.productViews = 1; if (productId && mongoose.isValidObjectId(String(productId))) inc['products.' + String(productId)] = 1; if (await firstTime(store, day, h, 'product')) inc.productVisitors = 1; }
  if (kind === 'cart_add') { inc.cartAdds = 1; if (await firstTime(store, day, h, 'cart')) inc.cartVisitors = 1; }
  if (kind === 'checkout' && await firstTime(store, day, h, 'checkout')) inc.checkoutVisitors = 1;
  await StoreStat.updateOne({ store: store._id, day }, { $inc: inc }, { upsert: true }).catch((e) => { if (!(e && e.code === 11000)) throw e; return StoreStat.updateOne({ store: store._id, day }, { $inc: inc }); });
}
// Never let analytics break a page.
const trackQuietly = (store, req, kind, productId) => { track(store, req, kind, productId).catch((e) => console.error('[analytics] track failed:', e.message)); };

// ---------------- reports ----------------
function readRange(q, level, now = new Date()) {
  const today = istDay(now), re = /^\d{4}-\d{2}-\d{2}$/;
  let days = [7, 30, 90, 365].includes(Number(q.days)) ? Number(q.days) : null;
  let from, to;
  if (!days && re.test(q.from || '') && re.test(q.to || '')) { from = q.from; to = q.to; }
  else { days = days || 30; to = today; from = addDays(today, -(days - 1)); }
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) throw new AppError('Choose a valid date range.', 400, 'validation_failed', { fields: { from: 'Start must be on or before the end.' } });
  if (to > today) to = today;
  const span = daysBetween(from, to) + 1;
  if (span > 366) throw new AppError('Choose up to one year at a time.', 400, 'validation_failed', { fields: { from: 'Up to 366 days.' } });
  // Free (overview): the last 7 or 30 days only.
  if (level === 'overview' && (to !== today || span > 30)) throw new AppError('Custom date ranges and longer history are available on the Pro plan.', 402, 'upgrade_required', { details: { feature: 'analytics:basic' } });
  return { from, to, span, start: dayStart(from), end: dayStart(addDays(to, 1)) };
}

const SALE = { status: { $ne: 'cancelled' }, $nor: [{ paymentMethod: 'razorpay', paymentStatus: { $in: ['pending', 'failed'] } }] };
const r = (p) => Math.round(p || 0) / 100;

async function kpis(sid, start, end) {
  const [o] = await Order.aggregate([{ $match: { store: sid, createdAt: { $gte: start, $lt: end }, ...SALE } },
    { $group: { _id: null, orders: { $sum: 1 }, gross: { $sum: '$totalPaise' }, refunds: { $sum: '$refundedPaise' }, tax: { $sum: '$taxPaise' }, shipping: { $sum: { $add: ['$shippingPaise', { $ifNull: ['$codFeePaise', 0] }] } }, discounts: { $sum: '$discountPaise' }, items: { $sum: { $sum: '$items.qty' } } } }]);
  const x = o || { orders: 0, gross: 0, refunds: 0, tax: 0, shipping: 0, discounts: 0, items: 0 };
  return { orders: x.orders, grossSales: r(x.gross), refunds: r(x.refunds), netSales: r(x.gross - x.refunds), averageOrder: x.orders ? r(x.gross / x.orders) : 0, itemsSold: x.items, gst: r(x.tax), shippingCollected: r(x.shipping), discounts: r(x.discounts) };
}
async function visits(sid, from, to) {
  const rows = await StoreStat.find({ store: sid, day: { $gte: from, $lte: to } }).lean();
  const sum = (k) => rows.reduce((a, b) => a + (b[k] || 0), 0);
  const sources = {}; for (const row of rows) for (const [k, v] of Object.entries(row.sources || {})) sources[k] = (sources[k] || 0) + v;
  const products = {}; for (const row of rows) for (const [k, v] of Object.entries(row.products || {})) products[k] = (products[k] || 0) + v;
  return { rows, visitors: sum('visitors'), pageViews: sum('pageViews'), productViews: sum('productViews'), productVisitors: sum('productVisitors'), cartAdds: sum('cartAdds'), cartVisitors: sum('cartVisitors'), checkoutVisitors: sum('checkoutVisitors'), sources, products };
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const change = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : now ? null : 0); // null = "new" (nothing before)

async function report(store, query = {}, now = new Date()) {
  const level = require('../config/plans').planFor(store).features.analytics;
  const rg = readRange(query, level, now), sid = store._id;
  const prevTo = addDays(rg.from, -1), prevFrom = addDays(rg.from, -rg.span);
  const [cur, prev, v, pv, series] = await Promise.all([
    kpis(sid, rg.start, rg.end), kpis(sid, dayStart(prevFrom), rg.start), visits(sid, rg.from, rg.to), visits(sid, prevFrom, prevTo),
    Order.aggregate([{ $match: { store: sid, createdAt: { $gte: rg.start, $lt: rg.end }, ...SALE } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, orders: { $sum: 1 }, net: { $sum: { $subtract: ['$totalPaise', '$refundedPaise'] } } } }]),
  ]);
  const byDay = new Map(series.map((s) => [s._id, s])), vByDay = new Map(v.rows.map((x) => [x.day, x]));
  const daily = []; for (let d = rg.from; d <= rg.to; d = addDays(d, 1)) { const s = byDay.get(d), w = vByDay.get(d); daily.push({ day: d, orders: s ? s.orders : 0, netSales: s ? r(s.net) : 0, visitors: w ? w.visitors : 0 }); }
  const out = {
    level, range: { from: rg.from, to: rg.to, days: rg.span, previousFrom: prevFrom, previousTo: prevTo },
    summary: { ...cur, visitors: v.visitors, pageViews: v.pageViews, conversionRate: pct(cur.orders, v.visitors) },
    previous: { orders: prev.orders, netSales: prev.netSales, averageOrder: prev.averageOrder, visitors: pv.visitors, conversionRate: pct(prev.orders, pv.visitors) },
    change: { orders: change(cur.orders, prev.orders), netSales: change(cur.netSales, prev.netSales), averageOrder: change(cur.averageOrder, prev.averageOrder), visitors: change(v.visitors, pv.visitors) },
    daily, locked: [],
  };
  const range = { store: sid, createdAt: { $gte: rg.start, $lt: rg.end } };
  if (analyticsAtLeast(store, 'basic')) {
    const [top, pay, status, coupons, weekday, buyers] = await Promise.all([
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $unwind: '$items' }, { $group: { _id: '$items.product', title: { $last: '$items.title' }, units: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotalPaise' }, orders: { $sum: 1 } } }, { $sort: { revenue: -1 } }, { $limit: 10 }]),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $group: { _id: '$paymentMethod', orders: { $sum: 1 }, sales: { $sum: '$totalPaise' } } }]),
      Order.aggregate([{ $match: range }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { ...range, ...SALE, couponCode: { $type: 'string' } } }, { $group: { _id: '$couponCode', uses: { $sum: 1 }, discount: { $sum: '$discountPaise' }, sales: { $sum: '$totalPaise' } } }, { $sort: { uses: -1 } }, { $limit: 10 }]),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $group: { _id: { $dayOfWeek: { date: '$createdAt', timezone: TZ } }, orders: { $sum: 1 }, sales: { $sum: '$totalPaise' } } }]),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $group: { _id: '$customer.phone', orders: { $sum: 1 }, sales: { $sum: '$totalPaise' } } }]),
    ]);
    // New vs returning: a buyer is "returning" if their first ever (non-cancelled) order is before this range.
    const phones = buyers.map((b) => b._id).filter(Boolean);
    const before = phones.length ? new Set(await Order.distinct('customer.phone', { store: sid, 'customer.phone': { $in: phones }, createdAt: { $lt: rg.start }, ...SALE })) : new Set();
    const nv = { new: { customers: 0, sales: 0 }, returning: { customers: 0, sales: 0 } };
    for (const b of buyers) { const k = before.has(b._id) ? 'returning' : 'new'; nv[k].customers++; nv[k].sales += b.sales; }
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    Object.assign(out, {
      topProducts: top.map((t) => ({ productId: String(t._id), title: t.title, units: t.units, revenue: r(t.revenue), orders: t.orders })),
      payments: ['cod', 'razorpay'].map((m) => { const p = pay.find((x) => x._id === m) || { orders: 0, sales: 0 }; return { method: m, orders: p.orders, sales: r(p.sales), share: pct(p.orders, cur.orders) }; }),
      statuses: Object.fromEntries(status.map((s) => [s._id, s.n])),
      coupons: coupons.map((c) => ({ code: c._id, uses: c.uses, discount: r(c.discount), sales: r(c.sales) })),
      weekdays: DOW.map((d, i) => { const w = weekday.find((x) => x._id === i + 1) || { orders: 0, sales: 0 }; return { day: d, orders: w.orders, sales: r(w.sales) }; }),
      customers: { new: { customers: nv.new.customers, sales: r(nv.new.sales) }, returning: { customers: nv.returning.customers, sales: r(nv.returning.sales) }, repeatRate: pct(nv.returning.customers, buyers.length) },
    });
  } else out.locked.push('basic');
  if (analyticsAtLeast(store, 'advanced')) {
    const [paid, states, hours, gst] = await Promise.all([
      Order.countDocuments({ ...range, ...SALE, $or: [{ paymentStatus: 'paid' }, { status: 'delivered' }] }),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $group: { _id: '$shipping.state', orders: { $sum: 1 }, sales: { $sum: '$totalPaise' } } }, { $sort: { sales: -1 } }, { $limit: 15 }]),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $group: { _id: { d: { $dayOfWeek: { date: '$createdAt', timezone: TZ } }, h: { $hour: { date: '$createdAt', timezone: TZ } } }, n: { $sum: 1 } } }]),
      Order.aggregate([{ $match: { ...range, ...SALE, taxPaise: { $gt: 0 } } }, { $group: { _id: null, cgst: { $sum: '$tax.cgst' }, sgst: { $sum: '$tax.sgst' }, igst: { $sum: '$tax.igst' }, tax: { $sum: '$taxPaise' } } }]),
    ]);
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0)); hours.forEach((x) => { heat[x._id.d - 1][x._id.h] = x.n; });
    const viewed = Object.entries(v.products).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const ids = viewed.map(([id]) => id);
    const [titles, unitsSold] = ids.length ? await Promise.all([
      require('../models/Product').find({ store: sid, _id: { $in: ids } }).select('title').lean(),
      Order.aggregate([{ $match: { ...range, ...SALE } }, { $unwind: '$items' }, { $match: { 'items.product': { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) } } }, { $group: { _id: '$items.product', orders: { $sum: 1 }, units: { $sum: '$items.qty' } } }]),
    ]) : [[], []];
    const g = gst[0] || { cgst: 0, sgst: 0, igst: 0, tax: 0 };
    Object.assign(out, {
      funnel: [
        { step: 'Visited the store', count: v.visitors }, { step: 'Viewed a product', count: v.productVisitors }, { step: 'Added to cart', count: v.cartVisitors },
        { step: 'Reached checkout', count: v.checkoutVisitors }, { step: 'Placed an order', count: cur.orders }, { step: 'Paid or delivered', count: paid },
      ].map((s, i, a) => ({ ...s, ofPrevious: i ? pct(s.count, a[i - 1].count) : 100, ofVisitors: pct(s.count, v.visitors) })),
      sources: SOURCES.map((s) => ({ source: s, visitors: v.sources[s] || 0, share: pct(v.sources[s] || 0, v.visitors) })).filter((s) => s.visitors).sort((a, b) => b.visitors - a.visitors),
      states: states.map((s) => ({ state: s._id || 'Unknown', orders: s.orders, sales: r(s.sales) })),
      hours: heat,
      productConversion: viewed.map(([id, views]) => { const t = titles.find((x) => String(x._id) === id), u = unitsSold.find((x) => String(x._id) === id); return { productId: id, title: t ? t.title : 'Deleted product', views, orders: u ? u.orders : 0, units: u ? u.units : 0, conversion: pct(u ? u.orders : 0, views) }; }),
      tax: { total: r(g.tax), cgst: r(g.cgst), sgst: r(g.sgst), igst: r(g.igst) },
    });
  } else out.locked.push('advanced');
  return out;
}

// ---------------- exports ----------------
async function ordersCsvRows(store, query) {
  const rg = readRange(query, 'advanced');
  const rows = await Order.find({ store: store._id, createdAt: { $gte: rg.start, $lt: rg.end } }).sort({ createdAt: 1 }).limit(50000).lean();
  const ist = (d) => (d ? new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 16) : '');
  return { range: rg, header: ['Order', 'Date (IST)', 'Status', 'Payment method', 'Payment status', 'Customer', 'Phone', 'Email', 'City', 'State', 'PIN code', 'Items', 'Units', 'Subtotal', 'Discount', 'Coupon', 'Shipping', 'COD fee', 'GST', 'CGST', 'SGST', 'IGST', 'Total', 'Refunded', 'Net', 'Invoice', 'Buyer GSTIN', 'Tracking'],
    rows: rows.map((o) => { const t = o.tax || {}; const inv = o.invoiceNumber && !String(o.invoiceNumber).startsWith('PENDING-') ? o.invoiceNumber : '';
      return [o.orderNumber, ist(o.createdAt), o.status, o.paymentMethod === 'cod' ? 'COD' : 'Online', o.paymentStatus, o.customer.name, o.customer.phone ? '+' + o.customer.phone : '', o.customer.email, o.shipping && o.shipping.city, o.shipping && o.shipping.state, o.shipping && o.shipping.pincode,
        o.items.map((i) => `${i.title}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''} x${i.qty}`).join('; '), o.items.reduce((a, i) => a + i.qty, 0), r(o.subtotalPaise), r(o.discountPaise), o.couponCode || '', r(o.shippingPaise), r(o.codFeePaise), r(o.taxPaise), r(t.cgst), r(t.sgst), r(t.igst), r(o.totalPaise), r(o.refundedPaise), r(o.totalPaise - (o.refundedPaise || 0)), inv, o.buyerGstin || '', (o.shipment && o.shipment.trackingNumber) || ''];
    }) };
}
async function productsCsvRows(store, query) {
  const rg = readRange(query, 'advanced');
  const rows = await Order.aggregate([{ $match: { store: store._id, createdAt: { $gte: rg.start, $lt: rg.end }, ...SALE } }, { $unwind: '$items' },
    { $group: { _id: { p: '$items.product', v: '$items.variantLabel' }, title: { $last: '$items.title' }, sku: { $last: '$items.sku' }, units: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotalPaise' }, tax: { $sum: { $ifNull: ['$items.taxPaise', 0] } }, orders: { $sum: 1 } } }, { $sort: { revenue: -1 } }]);
  return { range: rg, header: ['Product', 'Variant', 'SKU', 'Orders', 'Units sold', 'Revenue', 'GST in revenue', 'Average price'], rows: rows.map((x) => [x.title, x._id.v || '', x.sku || '', x.orders, x.units, r(x.revenue), r(x.tax), x.units ? r(x.revenue / x.units) : 0]) };
}

// GST summary for filing (GSTR-1 style): invoices issued in the range (by invoice date). B2B = buyer gave a GSTIN.
async function gstReport(store, query) {
  const rg = readRange(query, 'advanced');
  const I = require('../utils/india');
  const orders = await Order.find({ store: store._id, invoiceDate: { $gte: rg.start, $lt: rg.end }, invoiceNumber: { $type: 'string', $not: /^PENDING-/ } }).sort({ invoiceDate: 1 }).limit(50000).lean();
  const live = orders.filter((o) => o.status !== 'cancelled');
  const b2b = [], b2c = new Map(), hsn = new Map();
  for (const o of live) {
    const intra = !(o.tax && o.tax.igst), pos = I.stateByName(o.shipping && o.shipping.state), posText = pos ? `${pos.code}-${pos.name}` : (o.shipping && o.shipping.state) || '';
    const lines = o.items.map((i) => ({ rate: i.taxRate || 0, taxable: i.taxablePaise || 0, tax: i.taxPaise || 0, hsn: i.hsn || '', qty: i.qty, desc: i.title }));
    const extras = (o.shippingPaise || 0) + (o.codFeePaise || 0);
    if (extras && o.tax && o.tax.chargesTaxPaise) lines.push({ rate: o.tax.chargesTaxRate || 0, taxable: o.taxInclusive === false ? extras : extras - o.tax.chargesTaxPaise, tax: o.tax.chargesTaxPaise, hsn: '996812', qty: 1, desc: 'Shipping' });
    else if (extras) lines.push({ rate: 0, taxable: extras, tax: 0, hsn: '996812', qty: 1, desc: 'Shipping' });
    const sp = intra ? require('../utils/charges').splitIntra((o.tax && o.tax.cgst) || 0, lines.map((l) => l.tax)) : lines.map((l) => ({ cgst: 0, sgst: 0, igst: l.tax }));
    lines.forEach((l, i) => { l.cgst = sp[i].cgst; l.sgst = sp[i].sgst; l.igst = intra ? 0 : l.tax; });
    const byRate = new Map(); for (const l of lines) { const e = byRate.get(l.rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 }; e.taxable += l.taxable; e.cgst += l.cgst; e.sgst += l.sgst; e.igst += l.igst; byRate.set(l.rate, e); }
    for (const [rate, e] of byRate) {
      if (o.buyerGstin) b2b.push({ invoice: o.invoiceNumber, date: istDay(new Date(o.invoiceDate)), gstin: o.buyerGstin, name: o.customer.name, placeOfSupply: posText, invoiceValue: r(o.totalPaise), rate, taxable: r(e.taxable), cgst: r(e.cgst), sgst: r(e.sgst), igst: r(e.igst) });
      else { const k = posText + '|' + rate; const x = b2c.get(k) || { placeOfSupply: posText, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }; x.taxable += e.taxable; x.cgst += e.cgst; x.sgst += e.sgst; x.igst += e.igst; b2c.set(k, x); }
    }
    for (const l of lines) { const k = (l.hsn || '—') + '|' + l.rate; const x = hsn.get(k) || { hsn: l.hsn || '', description: l.desc, rate: l.rate, qty: 0, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 }; x.qty += l.qty; x.taxable += l.taxable; x.tax += l.tax; x.cgst += l.cgst; x.sgst += l.sgst; x.igst += l.igst; hsn.set(k, x); }
  }
  const money = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ['taxable', 'tax', 'cgst', 'sgst', 'igst'].includes(k) ? r(v) : v]));
  const nums = orders.map((o) => o.invoiceNumber);
  return { range: { from: rg.from, to: rg.to }, gstin: (store.taxSettings && store.taxSettings.gstin) || '',
    documents: { issued: orders.length, cancelled: orders.length - live.length, first: nums[0] || null, last: nums[nums.length - 1] || null },
    b2b, b2c: [...b2c.values()].map(money).sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate), hsn: [...hsn.values()].map(money).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate) };
}

module.exports = { track, trackQuietly, report, readRange, ordersCsvRows, productsCsvRows, gstReport, classifySource, istDay, addDays, dayStart, BOT };
