'use strict';
// Module 10: what happens when someone messages STORVA on WhatsApp.
//  * Store owners (the sender's number is their account phone, or the store's own connected number receives from the owner) can
//    run their shop from chat: ORDERS, ORDER 1042, CONFIRM/SHIP/DELIVER/CANCEL/PAID 1042, STOCK, PRICE, LOW, SALES, LINK, STORE.
//    Commands need Pro/Advanced (whatsappCommands); sending a PHOTO with a caption creates a draft product on every plan
//    (whatsappProductUpload) and, when AI is on the plan and configured, fills in title/description/tags from the photo.
//  * Shoppers can check an order they placed ("ORDER 1042" from the phone used at checkout) and get a friendly pointer otherwise.
//  * Anyone can reply STOP / START to opt out of / back into WhatsApp messages.
// All order changes go through services/orderOps.js, so WhatsApp follows exactly the same rules as the dashboard.
const Store = require('../models/Store');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { WhatsAppInbound } = require('../models/WhatsApp');
const outbox = require('./outbox');
const wa = require('./whatsapp');
const { updateOrder } = require('./orderOps');
const { hasFeature, limitOf, planFor } = require('../config/plans');
const { env } = require('../config/env');
const { inr, STATUS_TEXT } = require('../utils/messages');
const { escapeRegex } = require('../utils/productInput');

// ---------------- parsing (pure, unit-tested) ----------------
const ALIASES = {
  help: 'HELP', menu: 'HELP', hi: 'HELP', hello: 'HELP', hai: 'HELP', start: 'START', stop: 'STOP', unsubscribe: 'STOP',
  orders: 'ORDERS', 'order list': 'ORDERS', order: 'ORDER', confirm: 'CONFIRM', accept: 'CONFIRM', ship: 'SHIP', shipped: 'SHIP', dispatch: 'SHIP',
  deliver: 'DELIVER', delivered: 'DELIVER', cancel: 'CANCEL', paid: 'PAID', stock: 'STOCK', price: 'PRICE', low: 'LOW', 'low stock': 'LOW',
  sales: 'SALES', today: 'SALES', report: 'SALES', link: 'LINK', share: 'LINK', store: 'STORE', shop: 'STORE',
  // Malayalam / Manglish (STORVA's first market is Kerala)
  'സഹായം': 'HELP', 'ഓർഡർ': 'ORDERS', 'ഓർഡറുകൾ': 'ORDERS', 'സ്റ്റോക്ക്': 'STOCK', 'വില': 'PRICE', 'വിൽപ്പന': 'SALES', 'ലിങ്ക്': 'LINK',
};
function parseCommand(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return { cmd: '', args: [] };
  const lower = t.toLowerCase();
  for (const two of ['order list', 'low stock']) if (lower === two || lower.startsWith(two + ' ')) return { cmd: ALIASES[two], args: t.slice(two.length).trim().split(' ').filter(Boolean), raw: t };
  const [first, ...rest] = t.split(' ');
  let cmd = ALIASES[first.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')] || ALIASES[first] || '';
  if (cmd === 'ORDER' && !rest.length) cmd = 'ORDERS';
  if (!cmd && /^#?\d{4,9}$/.test(first) && !rest.length) return { cmd: 'ORDER', args: [first.replace('#', '')], raw: t }; // just "1042"
  return { cmd: cmd || 'UNKNOWN', args: rest, raw: t };
}
const orderNo = (s) => { const n = Number(String(s || '').replace(/^#/, '')); return Number.isInteger(n) && n >= 1001 ? n : null; };
// "SHIP 1042 DTDC D1234567" | "SHIP 1042 D1234567" | "SHIP 1042 https://track..." -> { carrier, trackingNumber, trackingUrl }
function parseShipment(args) {
  const url = args.find((a) => /^https?:\/\//i.test(a)) || '';
  const rest = args.filter((a) => a !== url);
  let carrier = '', tn = '';
  if (rest.length >= 2 && /^[A-Za-z][A-Za-z.&-]{1,30}$/.test(rest[0])) { carrier = rest[0]; tn = rest.slice(1).join(' '); }
  else tn = rest.join(' ');
  return { carrier: carrier.slice(0, 60), trackingNumber: tn.slice(0, 60), trackingUrl: url.slice(0, 300) };
}
// "STOCK blue kurta M 12" -> { query: 'blue kurta M', value: '12' } (the number is always last)
function splitValue(args) {
  if (args.length < 2) return null;
  const value = args[args.length - 1].replace(/[₹,]/g, '').replace(/^rs\.?/i, '');
  return { query: args.slice(0, -1).join(' '), value };
}
// Photo captions: "Jute basket 499", "Jute basket - ₹499", "Jute basket Rs. 1,299.50" -> { title, pricePaise }
function parseCaption(caption) {
  const c = String(caption || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const m = c.match(/^(.*?)[\s,:\-–]*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:\/-|rs|rupees)?$/i);
  if (m && m[1].trim().length >= 2) { const price = Number(m[2].replace(/,/g, '')); if (price > 0 && price <= 1000000) return { title: m[1].trim().slice(0, 120), pricePaise: Math.round(price * 100) }; }
  return { title: c.slice(0, 120), pricePaise: null };
}

// ---------------- helpers ----------------
const storeLink = (s) => `${env.appUrl}/store/${s.slug}`;
const dashLink = (hash) => `${env.appUrl}/dashboard${hash ? '#' + hash : ''}`;
const HELP_TEXT = (store, pro) => [
  `👋 *STORVA assistant* for *${store.name}*`,
  '',
  '📦 *Orders*',
  'ORDERS – latest open orders', 'ORDER 1042 – details', 'CONFIRM 1042 · SHIP 1042 DTDC AB123 · DELIVER 1042 · CANCEL 1042', 'PAID 1042 – cash received',
  '',
  '🏷️ *Products*',
  '📷 Send a photo with a caption like "Cotton saree 1299" to add a draft product',
  'STOCK <name or SKU> 12 · PRICE <name or SKU> 499 · LOW – low stock',
  '',
  '📊 SALES – today & this week · LINK – your store link',
  'STOP – no more WhatsApp messages',
  ...(pro ? [] : ['', `ℹ️ Order and stock commands are part of Pro. Photo upload works on every plan. Upgrade: ${dashLink('plan')}`]),
].join('\n');

function orderSummary(o) {
  return `#${o.orderNumber} · ${inr(o.totalPaise)} · ${o.customer.name} · ${o.status}${o.paymentMethod === 'cod' ? (o.paymentStatus === 'paid' ? ' · COD paid' : ' · COD') : o.paymentStatus === 'paid' ? ' · paid' : ' · ' + o.paymentStatus}`;
}
function orderDetail(o) {
  const lines = o.items.map((i) => `• ${i.qty} × ${i.title}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''} – ${inr(i.lineTotalPaise)}`);
  const addr = [o.shipping.line1, o.shipping.line2, o.shipping.city, o.shipping.state, o.shipping.pincode].filter(Boolean).join(', ');
  return [`*Order #${o.orderNumber}* – ${o.status}`, `${o.customer.name} · +${o.customer.phone}`, addr, '', ...lines, '', `Total *${inr(o.totalPaise)}* (${o.paymentMethod === 'cod' ? 'COD' : 'online'}, ${o.paymentStatus})`,
    ...(o.shipment && o.shipment.trackingNumber ? [`Tracking: ${[o.shipment.carrier, o.shipment.trackingNumber].filter(Boolean).join(' ')}`] : []), ...(o.note ? [`Note: ${o.note}`] : []), '', `Open: ${dashLink('orders/' + o.orderNumber)}`].join('\n');
}

async function findProduct(storeId, query) {
  const q = String(query || '').trim().slice(0, 80);
  if (!q) return { error: 'Tell me which product, e.g. STOCK blue kurta 10' };
  const re = new RegExp(`^${escapeRegex(q)}$`, 'i');
  const bySku = await Product.find({ store: storeId, status: { $ne: 'archived' }, $or: [{ sku: re }, { 'variants.sku': re }] }).limit(2);
  if (bySku.length === 1) { const p = bySku[0]; const v = p.variants.find((x) => x.sku && re.test(x.sku)); return { product: p, variant: v || null }; }
  const exact = await Product.find({ store: storeId, status: { $ne: 'archived' }, title: re }).limit(2);
  if (exact.length === 1) return { product: exact[0], variant: null };
  const like = await Product.find({ store: storeId, status: { $ne: 'archived' }, title: new RegExp(escapeRegex(q), 'i') }).sort({ updatedAt: -1 }).limit(4);
  if (like.length === 1) return { product: like[0], variant: null };
  if (!like.length) return { error: `I couldn't find a product matching "${q}".` };
  return { error: `More than one product matches "${q}":\n${like.map((p) => `• ${p.title}${p.sku ? ' (SKU ' + p.sku + ')' : ''}`).join('\n')}\nUse the SKU or the full name.` };
}

// ---------------- owner commands ----------------
async function ownerCommand(store, user, { cmd, args }, inbound) {
  const pro = hasFeature(store, 'whatsappCommands');
  const needPro = () => `This command is part of the Pro plan. Upgrade here: ${dashLink('plan')}\nSend a product photo with a caption to add products on any plan.`;
  switch (cmd) {
    case 'HELP': case '': return HELP_TEXT(store, pro);
    case 'UNKNOWN': return `I didn't understand "${String(inbound.text || '').slice(0, 40)}". Send HELP to see what I can do.`;
    case 'LINK': return `🛍️ ${store.name}\n${storeLink(store)}\n\nForward this link to customers, or print your QR code: ${env.appUrl}/store/${store.slug}/qr.svg`;
    case 'STORE': {
      const stores = await Store.find({ owner: user._id }).sort({ createdAt: 1 }).select('name slug');
      if (!args.length) return `Your stores:\n${stores.map((s) => `${String(s._id) === String(store._id) ? '✅' : '•'} ${s.name} (STORE ${s.slug})`).join('\n')}`;
      const pick = stores.find((s) => s.slug === args[0].toLowerCase());
      if (!pick) return `No store called "${args[0]}". Send STORE to see your stores.`;
      await User.updateOne({ _id: user._id }, { $set: { waActiveStore: pick._id } });
      return `✅ Commands now act on *${pick.name}*.`;
    }
  }
  if (!pro) return needPro();
  switch (cmd) {
    case 'ORDERS': {
      const rows = await Order.find({ store: store._id, status: { $in: ['pending', 'confirmed', 'shipped'] } }).sort({ createdAt: -1 }).limit(8);
      if (!rows.length) return '🎉 No open orders right now.';
      return `*Open orders* (${rows.length}${rows.length === 8 ? '+' : ''})\n${rows.map(orderSummary).join('\n')}\n\nReply ORDER <number> for details.`;
    }
    case 'ORDER': {
      const n = orderNo(args[0]); if (!n) return 'Send ORDER followed by the order number, e.g. ORDER 1042';
      const o = await Order.findOne({ store: store._id, orderNumber: n });
      return o ? orderDetail(o) : `Order #${n} was not found in ${store.name}.`;
    }
    case 'CONFIRM': case 'SHIP': case 'DELIVER': case 'CANCEL': case 'PAID': {
      const n = orderNo(args[0]); if (!n) return `Send ${cmd} followed by the order number, e.g. ${cmd} 1042`;
      const o = await Order.findOne({ store: store._id, orderNumber: n });
      if (!o) return `Order #${n} was not found in ${store.name}.`;
      const change = cmd === 'PAID' ? { paymentStatus: 'paid' } : { status: { CONFIRM: 'confirmed', SHIP: 'shipped', DELIVER: 'delivered', CANCEL: 'cancelled' }[cmd] };
      if (cmd === 'SHIP' && args.length > 1) change.shipment = parseShipment(args.slice(1));
      try {
        const r = await updateOrder(store._id, o, change);
        if (!r.changed) return `Order #${n} is already ${cmd === 'PAID' ? 'marked paid' : o.status}.`;
        const notify = (planFor(store).features.whatsappNotifications) ? ' The customer has been notified.' : '';
        if (cmd === 'PAID') return `💰 Order #${n} marked as paid.`;
        return `✅ Order #${n} is now *${r.order.status}*.${cmd === 'SHIP' && r.order.shipment && r.order.shipment.trackingNumber ? ' Tracking saved.' : ''}${notify}${cmd === 'CANCEL' ? ' Stock was returned.' : ''}`;
      } catch (e) {
        const f = e.fields; return `⚠️ ${f ? Object.values(f)[0] : e.message}`;
      }
    }
    case 'STOCK': case 'PRICE': {
      const sv = splitValue(args); if (!sv) return cmd === 'STOCK' ? 'Example: STOCK blue kurta 12' : 'Example: PRICE blue kurta 499';
      const found = await findProduct(store._id, sv.query); if (found.error) return found.error;
      const { product: p, variant: v } = found;
      if (cmd === 'STOCK') {
        const n = Number(sv.value); if (!Number.isInteger(n) || n < 0 || n > 1000000) return 'Stock must be a whole number, e.g. STOCK blue kurta 12';
        if (!v && p.variants.length) return `"${p.title}" has options. Use the option's SKU, e.g. STOCK ${p.variants[0].sku || '<sku>'} ${n}`;
        await Product.updateOne({ _id: p._id, store: store._id }, v ? { $set: { 'variants.$[v].stock': n } } : { $set: { stock: n, trackInventory: true } }, v ? { arrayFilters: [{ 'v._id': v._id }] } : {});
        return `📦 Stock for *${p.title}${v ? ' (' + v.options.map((o) => o.value).join(' / ') + ')' : ''}* is now ${n}.`;
      }
      const price = Number(sv.value); if (!(price > 0) || price > 1000000) return 'Price must be a number in rupees, e.g. PRICE blue kurta 499';
      const paise = Math.round(price * 100);
      if (v) await Product.updateOne({ _id: p._id, store: store._id }, { $set: { 'variants.$[v].pricePaise': paise } }, { arrayFilters: [{ 'v._id': v._id }] });
      else await Product.updateOne({ _id: p._id, store: store._id }, { $set: { pricePaise: paise, ...(p.compareAtPricePaise && p.compareAtPricePaise <= paise ? { compareAtPricePaise: null } : {}) } });
      return `🏷️ Price for *${p.title}${v ? ' (' + v.options.map((o) => o.value).join(' / ') + ')' : ''}* is now ${inr(paise)}.`;
    }
    case 'LOW': {
      const threshold = require('./notifications').prefs(store).lowStockThreshold;
      const rows = await Product.find({ store: store._id, status: 'active', trackInventory: true, $or: [{ variants: { $size: 0 }, stock: { $lte: threshold } }, { 'variants.stock': { $lte: threshold } }] }).limit(15);
      if (!rows.length) return `✅ Nothing is at or below ${threshold} in stock.`;
      const lines = rows.flatMap((p) => (p.variants.length ? p.variants.filter((v) => v.stock <= threshold).map((v) => `• ${p.title} (${v.options.map((o) => o.value).join(' / ')}): ${v.stock}`) : [`• ${p.title}: ${p.stock}`]));
      return `⚠️ *Low stock* (≤ ${threshold})\n${lines.slice(0, 20).join('\n')}`;
    }
    case 'SALES': {
      const now = new Date(), ist = new Date(now.getTime() + 5.5 * 3600e3);
      const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600e3);
      const weekStart = new Date(dayStart.getTime() - ((ist.getUTCDay() + 6) % 7) * 864e5);
      const agg = async (from) => (await Order.aggregate([{ $match: { store: store._id, createdAt: { $gte: from }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: '$totalPaise' } } }]))[0] || { n: 0, t: 0 };
      const [d, w, open] = await Promise.all([agg(dayStart), agg(weekStart), Order.countDocuments({ store: store._id, status: { $in: ['pending', 'confirmed'] } })]);
      return `📊 *${store.name}*\nToday: ${d.n} order${d.n === 1 ? '' : 's'} · ${inr(d.t)}\nThis week: ${w.n} order${w.n === 1 ? '' : 's'} · ${inr(w.t)}\nWaiting to ship: ${open}\n\nMore: ${dashLink('analytics')}`;
    }
    default: return `I didn't understand "${(inbound.text || '').slice(0, 40)}". Send HELP to see what I can do.`;
  }
}

// Photo → draft product (every plan). AI fills the details when available.
async function photoToProduct(store, msg, sender) {
  if (!hasFeature(store, 'whatsappProductUpload')) return 'Product upload from WhatsApp is not available on your plan.';
  const total = Math.min(env.maxProductsPerStore, limitOf(store, 'totalProducts'));
  if (await Product.countDocuments({ store: store._id }) >= total) return `Your plan allows ${total} products in total. Delete old drafts or upgrade: ${dashLink('plan')}`;
  const { downloadMedia } = require('./whatsappApi');
  const { saveStoreImage, removeStoreFile } = require('../utils/uploads');
  let media, saved;
  try { media = await downloadMedia(msg.image.id, sender.token); saved = await saveStoreImage(store._id, media.buffer, { prefix: 'wa' }); }
  catch (e) { return `⚠️ I couldn't save that photo (${e.message}). Please send it again as a photo (JPEG/PNG, under 5 MB).`; }
  const cap = parseCaption(msg.image.caption);
  const data = { title: cap.title, pricePaise: cap.pricePaise || 0, description: '', tags: [], category: '', status: 'draft', images: [{ url: saved.url, alt: cap.title || '' }] };
  let aiNote = '';
  const ai = require('./ai');
  if (hasFeature(store, 'ai') && ai.configured()) {
    try {
      const r = await ai.run(store, 'photo', ai.readInput({ title: cap.title, tone: 'friendly', length: 'medium' }), { image: { mime: saved.mime, buffer: media.buffer } });
      const x = r.result;
      if (!data.title && x.title) data.title = x.title;
      data.description = x.description || ''; data.tags = x.tags || []; data.category = x.category || '';
      if (!data.pricePaise && x.priceHint) aiNote = `\n💡 Similar items sell for ₹${x.priceHint.low}–₹${x.priceHint.high}.`;
      aiNote = `\n✨ AI wrote the description and tags (${r.creditsUsed} credits).` + aiNote;
    } catch (e) { aiNote = e.code === 'ai_credits_exhausted' ? '\n(AI credits are used up this month, so I added the photo only.)' : ''; }
  }
  if (!data.title || data.title.length < 2) data.title = `New product ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
  try {
    const { createWithSlug } = require('../routes/products').helpers;
    const { slugify } = require('../utils/slug');
    const p = await createWithSlug(Product, store._id, slugify(data.title) || 'product', data);
    return `✅ Added *${p.title}*${data.pricePaise ? ' at ' + inr(data.pricePaise) : ''} as a *draft*.${aiNote}\n${data.pricePaise ? '' : 'Add a price: PRICE ' + p.title + ' 499\n'}Review and publish: ${dashLink('products/' + p._id)}`;
  } catch (e) { await removeStoreFile(store._id, saved.url); return `⚠️ I couldn't create the product: ${e.message}`; }
}

// ---------------- shoppers ----------------
async function shopperMessage(storeCtx, from, cmdObj) {
  const n = cmdObj.cmd === 'ORDER' ? orderNo(cmdObj.args[0]) : null;
  if (n) {
    const where = { orderNumber: n, 'customer.phone': from, ...(storeCtx ? { store: storeCtx._id } : {}) };
    const rows = await Order.find(where).setOptions({ skipTenant: true }).sort({ createdAt: -1 }).limit(3);
    if (rows.length) { // the same buyer can have #1042 at two different shops: show each (they are all theirs)
      const parts = [];
      for (const o of rows) {
        const s = storeCtx || await Store.findById(o.store).select('name slug');
        if (!s) continue;
        const tr = o.shipment && o.shipment.trackingNumber ? `\nTracking: ${[o.shipment.carrier, o.shipment.trackingNumber].filter(Boolean).join(' ')}${o.shipment.trackingUrl ? ' ' + o.shipment.trackingUrl : ''}` : '';
        parts.push(`Order #${o.orderNumber} from ${s.name} is *${STATUS_TEXT[o.status] || o.status}*.${tr}\nDetails: ${env.appUrl}/store/${s.slug}/order/${o.orderNumber}?t=${o.publicToken}`);
      }
      if (parts.length) return { text: parts.join('\n\n') };
    }
    return { text: `I couldn't find order #${n} for this WhatsApp number. Please use the number you gave at checkout, or contact the store.` };
  }
  if (storeCtx) return { text: `Hi! 👋 Thanks for messaging *${storeCtx.name}*.\nBrowse and order here: ${storeLink(storeCtx)}\nTo check an order, send ORDER followed by your order number.`, greet: true };
  return { text: 'Hi! 👋 This is the STORVA notifications number. To check an order, send ORDER followed by your order number. To talk to a shop, use the WhatsApp button on its website.', greet: true };
}

// ---------------- entry point ----------------
// ctx: { connection } when the message arrived on a store's own number; undefined for the platform number.
async function handleMessage(msg, ctx = {}) {
  const from = String(msg.from || '').replace(/\D/g, '');
  const type = msg.type || 'text';
  const text = type === 'text' ? (msg.text && msg.text.body) || '' : type === 'button' ? (msg.button && msg.button.text) || '' : type === 'interactive' ? ((msg.interactive && (msg.interactive.button_reply || msg.interactive.list_reply)) || {}).title || '' : type === 'image' ? (msg.image && msg.image.caption) || '' : '';
  const ownStore = ctx.connection ? await Store.findById(ctx.connection.store) : null;
  // Idempotency: WhatsApp retries webhooks; the unique waMessageId means each message is handled exactly once.
  let inbound;
  try { inbound = await WhatsAppInbound.create({ waMessageId: String(msg.id || '').slice(0, 200) || `${from}:${msg.timestamp}`, from, type: type.slice(0, 20), text: String(text).slice(0, 500), store: ownStore ? ownStore._id : null }); }
  catch (e) { if (e && e.code === 11000) return { duplicate: true }; throw e; }
  const cmdObj = parseCommand(text);

  // Who is it? Owner = sender's phone is the owner's account phone (for a store's own number: that store's owner).
  const user = await User.findOne({ phone: from, status: 'active' }).select('name phone phoneVerified waActiveStore');
  let store = null, role = 'shopper';
  if (user) {
    if (ownStore) { if (String(ownStore.owner) === String(user._id)) { store = ownStore; role = 'owner'; } }
    else {
      const stores = await Store.find({ owner: user._id, status: 'active' }).sort({ createdAt: 1 });
      store = stores.find((s) => user.waActiveStore && String(s._id) === String(user.waActiveStore)) || stores[0] || null;
      if (store) role = 'owner';
    }
    if (role === 'owner' && !user.phoneVerified) await User.updateOne({ _id: user._id }, { $set: { phoneVerified: true } }); // messaging from the number proves it
  }
  const replyStore = store || ownStore;

  let reply = '', command = cmdObj.cmd;
  if (cmdObj.cmd === 'STOP' || cmdObj.cmd === 'START') {
    await wa.setOptOut(from, ownStore ? ownStore._id : null, cmdObj.cmd === 'STOP');
    reply = cmdObj.cmd === 'STOP' ? 'You will no longer get WhatsApp messages from us. Reply START to turn them back on.' : '✅ WhatsApp messages are on again.';
  } else if (role === 'owner') {
    if (type === 'image' && msg.image && msg.image.id) { command = 'PHOTO'; const sender = await wa.senderFor(store._id); reply = sender ? await photoToProduct(store, msg, sender) : 'WhatsApp is not fully configured on this server yet.'; }
    else if (['text', 'button', 'interactive'].includes(type)) reply = await ownerCommand(store, user, cmdObj, { text });
    else reply = 'I can read text commands and product photos. Send HELP to see what I can do.';
  } else {
    const r = await shopperMessage(ownStore, from, cmdObj);
    reply = r.text; command = r.greet ? 'GREET' : command;
    if (r.greet) { // greet a shopper at most once a day per number, so a chatty customer is not spammed by the bot
      const day = new Date().toISOString().slice(0, 10);
      const k = `greet:${ownStore ? ownStore._id : 'platform'}:${from}:${day}`;
      const exists = await require('../models/OutboundMessage').exists({ dedupeKey: k });
      if (exists) reply = ''; else inbound._greetKey = k;
    }
  }
  await WhatsAppInbound.updateOne({ _id: inbound._id }, { $set: { role, command: String(command || '').slice(0, 40), result: reply.slice(0, 300), ...(replyStore ? { store: replyStore._id } : {}) } });
  if (reply) {
    await outbox.enqueue({ store: replyStore ? replyStore._id : null, channel: 'whatsapp', audience: role === 'owner' ? 'owner' : 'buyer', kind: 'wa_reply', to: from, payload: { type: 'text', text: reply.slice(0, 4000), via: ownStore ? 'own' : 'platform' }, dedupeKey: inbound._greetKey || `reply:${inbound.waMessageId}` });
  }
  return { role, command, reply, store: replyStore ? String(replyStore._id) : null };
}

module.exports = { handleMessage, parseCommand, parseShipment, parseCaption, splitValue, ownerCommand, HELP_TEXT, orderDetail, findProduct };
