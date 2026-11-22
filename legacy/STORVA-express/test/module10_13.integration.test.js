'use strict';
// Modules 10 + 13 against a REAL MongoDB with a fake WhatsApp Cloud API (no network): alerts, outbox retries, webhook security,
// owner commands, photo upload, shopper lookups, opt-out, own-number connection, preferences, QR and share kit.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
Object.assign(process.env, { WHATSAPP_TOKEN: 'platform-token', WHATSAPP_PHONE_NUMBER_ID: '1000001', WHATSAPP_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_SECRET: 'a'.repeat(32), WHATSAPP_DISPLAY_NUMBER: '919000000000' });
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'modules 10 + 13'); return; }
const api = require('../src/services/whatsappApi');
const events = require('../src/services/events');
const outbox = require('../src/services/outbox');
const waWebhook = require('../src/services/waWebhook');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
let sent = [], seq = 0, fail = null;
api.setTransport(async ({ method, url, body, headers }) => {
  if (method === 'POST' && url.endsWith('/messages')) {
    if (body.status === 'read') return { status: 200, json: { success: true } };
    if (fail) { const f = fail; fail = null; return f; }
    sent.push({ url, body, auth: headers.authorization }); return { status: 200, json: { messages: [{ id: 'wamid.T' + (++seq) }] } };
  }
  if (method === 'GET' && /\/2000002\?fields=/.test(url)) return { status: 200, json: { display_phone_number: '+91 90000 11111', verified_name: 'My Shop' } };
  if (method === 'GET' && /\/9999999\?fields=/.test(url)) return { status: 400, json: { error: { message: 'Invalid OAuth access token' } } };
  if (method === 'GET' && /\/media-1$/.test(url)) return { status: 200, json: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/png', file_size: PNG.length } };
  if (method === 'GET' && url.startsWith('https://lookaside.fbsbx.com/')) return { status: 200, buffer: PNG, contentType: 'image/png' };
  return { status: 404, json: { error: { message: 'unexpected ' + url } } };
});
test.before(H.start); test.after(H.stop);
const OM = () => require('../src/models/OutboundMessage');
const Order = () => require('../src/models/Order');
const settle = async () => { await events.drain(); await waWebhook.drain(); await events.drain(); };
const sign = (raw, secret = process.env.WHATSAPP_APP_SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const hook = (payload, { key = '', secret, sig } = {}) => { const raw = JSON.stringify(payload); return fetch(`${H.base}/webhooks/whatsapp${key ? '/' + key : ''}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig || sign(raw, secret) }, body: raw }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })); };
const envelope = (value, pnid = '1000001') => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: pnid }, ...value } }] }] });
let mid = 0;
const say = async (from, text, extra = {}) => { const id = 'wamid.IN' + (++mid) + crypto.randomBytes(3).toString('hex'); const r = await hook(envelope({ messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text }, ...extra }] })); assert.equal(r.status, 200); await settle(); return id; };
const lastReply = async (to) => (await OM().findOne({ to, kind: 'wa_reply' }).sort({ createdAt: -1 })).payload.text;
let FREE, PRO, pp;

test('setup', async () => { await OM().deleteMany({ store: null }); await require('../src/models/WhatsApp').WhatsAppInbound.deleteMany({}); await require('../src/models/WhatsApp').WhatsAppOptOut.deleteMany({}); FREE = await H.owner(); PRO = await H.owner({ plan: 'pro' }); pp = await H.product(PRO, { title: 'Blue Kurta', sku: 'KURTA-BLU', stock: 5 }); });

test('a new order creates an in-app alert, owner + buyer emails, and (Pro only) WhatsApp messages – exactly once', async () => {
  const fp = await H.product(FREE, { title: 'Mug', stock: 10 });
  const fo = await H.order(FREE, [{ productId: fp.id, qty: 1 }]); await settle();
  const fn = await H.api(FREE, `/stores/${FREE.sid}/notifications`);
  assert.equal(fn.status, 200); assert.equal(fn.json.unread, 1); assert.match(fn.json.notifications[0].title, new RegExp(`New order #${fo.order.orderNumber}`));
  const fRows = await OM().find({ store: FREE.sid });
  assert.deepEqual(fRows.map((r) => `${r.channel}:${r.audience}`).sort(), ['email:buyer', 'email:owner']); // Free: no WhatsApp alerts
  const o = await H.order(PRO, [{ productId: pp.id, qty: 1 }]); await settle();
  const rows = await OM().find({ store: PRO.sid, kind: { $in: ['new_order_alert', 'order_confirmation'] } });
  assert.deepEqual(rows.map((r) => `${r.channel}:${r.audience}`).sort(), ['email:buyer', 'email:owner', 'whatsapp:buyer', 'whatsapp:owner']);
  const buyerWa = rows.find((r) => r.channel === 'whatsapp' && r.audience === 'buyer');
  assert.equal(buyerWa.to, '919876543210'); assert.equal(buyerWa.payload.type, 'template'); assert.equal(buyerWa.payload.name, 'storva_order_confirmed');
  assert.equal(buyerWa.payload.params[2], String(o.order.orderNumber)); assert.match(buyerWa.payload.params[4], /\/order\/\d+\?t=/);
  const email = rows.find((r) => r.channel === 'email' && r.audience === 'buyer');
  assert.match(email.payload.subject, /confirmed/); assert.ok(!/<script/i.test(email.payload.html));
  const ord = await Order().findOne({ store: PRO.sid, orderNumber: o.order.orderNumber });
  await events.emit('order.created', { storeId: PRO.sid, orderId: ord._id }); await settle(); // repeated event
  assert.equal(await OM().countDocuments({ store: PRO.sid, kind: { $in: ['new_order_alert', 'order_confirmation'] } }), 4);
  PRO.order = o.order.orderNumber;
});

test('the outbox sends WhatsApp via the Cloud API, skips unconfigured email, and retries temporary errors with back-off', async () => {
  sent = [];
  const r = await outbox.flush(100);
  assert.ok(r.sent >= 2, JSON.stringify(r));
  const wa = await OM().findOne({ store: PRO.sid, kind: 'order_confirmation', channel: 'whatsapp' });
  assert.equal(wa.status, 'sent'); assert.match(wa.providerId, /^wamid\.T/);
  const call = sent.find((s) => s.body.to === '919876543210' && s.body.type === 'template');
  assert.equal(call.auth, 'Bearer platform-token'); assert.equal(call.body.type, 'template'); assert.ok(call.url.includes('/1000001/messages'));
  const em = await OM().findOne({ store: PRO.sid, kind: 'order_confirmation', channel: 'email' });
  assert.equal(em.status, 'skipped'); assert.match(em.lastError, /not configured/);
  // temporary failure -> queued again later; definite failure -> failed, never retried
  const t = await outbox.enqueue({ store: PRO.sid, channel: 'whatsapp', audience: 'owner', kind: 'test', to: '919111111111', payload: { type: 'text', text: 'hi' }, dedupeKey: 'it-temp-' + H.rnd() });
  fail = { status: 503, json: { error: { code: 2, message: 'Service temporarily unavailable' } } }; await outbox.flush(5);
  let row = await OM().findById(t._id); assert.equal(row.status, 'queued'); assert.equal(row.attempts, 1); assert.ok(row.nextAttemptAt > new Date(Date.now() + 30000));
  await OM().updateOne({ _id: t._id }, { $set: { nextAttemptAt: new Date() } }); await outbox.flush(5);
  row = await OM().findById(t._id); assert.equal(row.status, 'sent'); assert.equal(row.attempts, 2);
  const d = await outbox.enqueue({ store: PRO.sid, channel: 'whatsapp', audience: 'owner', kind: 'test', to: '919222222222', payload: { type: 'text', text: 'hi' }, dedupeKey: 'it-def-' + H.rnd() });
  fail = { status: 400, json: { error: { code: 131026, message: 'Message undeliverable' } } }; await outbox.flush(5);
  row = await OM().findById(d._id); assert.equal(row.status, 'failed'); assert.match(row.lastError, /undeliverable/);
});

test('webhook: subscription check, signature required, delivery statuses only move forward', async () => {
  const ok = await fetch(`${H.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '12345');
  assert.equal((await fetch(`${H.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);
  assert.equal((await hook(envelope({ statuses: [] }), { sig: 'sha256=' + '0'.repeat(64) })).status, 401);
  const wa = await OM().findOne({ store: PRO.sid, kind: 'order_confirmation', channel: 'whatsapp' });
  const st = (status) => hook(envelope({ statuses: [{ id: wa.providerId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: wa.to }] }));
  assert.equal((await st('read')).status, 200); await settle();
  assert.equal((await OM().findById(wa._id)).status, 'read');
  await st('delivered'); await settle();
  const row = await OM().findById(wa._id); assert.equal(row.status, 'read'); assert.ok(row.deliveredAt && row.readAt);
  // a message for another phone number id is ignored by the platform webhook
  assert.equal((await hook(envelope({ statuses: [{ id: wa.providerId, status: 'failed' }] }, '5555555'))).json.statuses, 0);
});

test('owner WhatsApp commands (Pro): ORDERS, ORDER, SHIP with tracking, STOCK, PRICE, LOW, SALES; each message handled once', async () => {
  await say(PRO.phone, 'orders');
  assert.match(await lastReply(PRO.phone), new RegExp(`#${PRO.order}`));
  await say(PRO.phone, `order ${PRO.order}`);
  assert.match(await lastReply(PRO.phone), /Blue Kurta/);
  await say(PRO.phone, `CONFIRM ${PRO.order}`);
  const id = await say(PRO.phone, `SHIP ${PRO.order} DTDC D1234567`);
  assert.match(await lastReply(PRO.phone), /now \*shipped\*.*Tracking saved/);
  const o = await H.api(PRO, `/stores/${PRO.sid}/orders/${PRO.order}`);
  assert.equal(o.json.order.status, 'shipped'); assert.equal(o.json.order.shipment.carrier, 'DTDC'); assert.equal(o.json.order.shipment.trackingNumber, 'D1234567');
  const upd = await OM().findOne({ store: PRO.sid, kind: 'order_shipped', channel: 'whatsapp' });
  assert.ok(upd, 'buyer is told about the shipment'); assert.match(upd.payload.params[4], /DTDC D1234567/);
  // WhatsApp retries the same webhook: the message is not handled again
  const before = await OM().countDocuments({ to: PRO.phone, kind: 'wa_reply' });
  await hook(envelope({ messages: [{ id, from: PRO.phone, type: 'text', text: { body: `SHIP ${PRO.order} DTDC D1234567` } }] })); await settle();
  assert.equal(await OM().countDocuments({ to: PRO.phone, kind: 'wa_reply' }), before);
  await say(PRO.phone, `CANCEL ${PRO.order}`);
  assert.match(await lastReply(PRO.phone), /cannot become cancelled/);
  await say(PRO.phone, 'STOCK kurta-blu 2');
  assert.match(await lastReply(PRO.phone), /now 2/);
  await say(PRO.phone, 'PRICE Blue Kurta ₹649');
  assert.match(await lastReply(PRO.phone), /₹649/);
  const p = await H.api(PRO, `/stores/${PRO.sid}/products/${pp.id}`); assert.equal(p.json.product.stock, 2); assert.equal(p.json.product.price, 649);
  await say(PRO.phone, 'low'); assert.match(await lastReply(PRO.phone), /Blue Kurta: 2/);
  await say(PRO.phone, 'sales'); assert.match(await lastReply(PRO.phone), /Today: \d+ order/);
  await say(PRO.phone, 'blah'); assert.match(await lastReply(PRO.phone), /HELP/);
  const reply = await OM().findOne({ to: PRO.phone, kind: 'wa_reply' });
  assert.equal(reply.payload.via, 'platform'); assert.equal(String(reply.store), PRO.sid);
});

test('Free owners get HELP/LINK and photo upload, but order commands ask them to upgrade', async () => {
  await say(FREE.phone, 'ORDERS'); assert.match(await lastReply(FREE.phone), /Pro plan/);
  await say(FREE.phone, 'link'); assert.match(await lastReply(FREE.phone), new RegExp(`/store/${FREE.slug}`));
  await say(FREE.phone, '', { type: 'image', text: undefined, image: { id: 'media-1', mime_type: 'image/png', caption: 'Jute basket ₹499' } });
  assert.match(await lastReply(FREE.phone), /Added \*Jute basket\* at ₹499 as a \*draft\*/);
  const list = await H.api(FREE, `/stores/${FREE.sid}/products?q=Jute`);
  const jp = list.json.products.find((x) => x.title === 'Jute basket');
  assert.ok(jp); assert.equal(jp.status, 'draft'); assert.equal(jp.price, 499); assert.equal(jp.images.length, 1); assert.match(jp.images[0].url, new RegExp(`^/uploads/${FREE.sid}/wa-`));
});

test('shoppers can look up their own order; strangers cannot; STOP opts out of all WhatsApp messages', async () => {
  await say('919876543210', `ORDER ${PRO.order}`);
  assert.match(await lastReply('919876543210'), /is \*on its way\*.*DTDC D1234567/s);
  await say('919555555555', `ORDER ${PRO.order}`);
  assert.match(await lastReply('919555555555'), /couldn't find order/);
  await say('919555555555', 'hello'); assert.match(await lastReply('919555555555'), /notifications number/);
  const n = await OM().countDocuments({ to: '919555555555', kind: 'wa_reply' });
  await say('919555555555', 'hello again'); assert.equal(await OM().countDocuments({ to: '919555555555', kind: 'wa_reply' }), n, 'greeted once a day');
  await say('919876543210', 'STOP');
  const m = await outbox.enqueue({ store: PRO.sid, channel: 'whatsapp', audience: 'buyer', kind: 'test', to: '919876543210', payload: { type: 'text', text: 'promo' }, dedupeKey: 'it-stop-' + H.rnd() });
  await outbox.flush(50); assert.equal((await OM().findById(m._id)).status, 'skipped');
  await say('919876543210', 'START');
  const m2 = await outbox.enqueue({ store: PRO.sid, channel: 'whatsapp', audience: 'buyer', kind: 'test', to: '919876543210', payload: { type: 'text', text: 'promo' }, dedupeKey: 'it-start-' + H.rnd() });
  await outbox.flush(50); assert.equal((await OM().findById(m2._id)).status, 'sent');
});

test('preferences: validation, turning buyer emails off, low-stock threshold alerts, mark read', async () => {
  const bad = await H.api(PRO, `/stores/${PRO.sid}/notifications/settings`, { method: 'PUT', body: { ownerEmail: { newOrder: 'yes', hack: true }, lowStockThreshold: -1 } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields['ownerEmail.newOrder'] && bad.json.error.fields['ownerEmail.hack'] && bad.json.error.fields.lowStockThreshold);
  const s = await H.api(PRO, `/stores/${PRO.sid}/notifications/settings`, { method: 'PUT', body: { buyerEmail: false, lowStockThreshold: 5, ownerWhatsapp: { lowStock: true } } });
  assert.equal(s.status, 200); assert.equal(s.json.settings.buyerEmail, false); assert.equal(s.json.settings.lowStockThreshold, 5); assert.equal(s.json.whatsappAlertsAvailable, true);
  const p2 = await H.product(PRO, { title: 'Clay Lamp', stock: 6 });
  const o = await H.order(PRO, [{ productId: p2.id, qty: 2 }]); await settle();
  const ord = await Order().findOne({ store: PRO.sid, orderNumber: o.order.orderNumber });
  assert.equal(await OM().countDocuments({ dedupeKey: `o:${ord._id}:created:buyer:email` }), 0, 'buyer email off');
  const list = await H.api(PRO, `/stores/${PRO.sid}/notifications`);
  const low = list.json.notifications.find((n) => n.type === 'stock.low');
  assert.ok(low); assert.match(low.title, /Clay Lamp/); assert.equal(low.body, '4 left');
  assert.ok(await OM().exists({ store: PRO.sid, kind: 'low_stock', channel: 'whatsapp' }));
  const r = await H.api(PRO, `/stores/${PRO.sid}/notifications/read`, { method: 'POST', body: { ids: [low.id] } });
  assert.equal(r.json.updated, 1);
  const all = await H.api(PRO, `/stores/${PRO.sid}/notifications/read`, { method: 'POST', body: {} });
  assert.equal(all.json.unread, 0);
  assert.equal((await H.api(FREE, `/stores/${PRO.sid}/notifications`)).status, 404, 'another owner cannot read them');
  const log = await H.api(PRO, `/stores/${PRO.sid}/notifications/messages?channel=whatsapp`);
  assert.equal(log.status, 200); assert.ok(log.json.messages.length > 0); assert.ok(log.json.messages.every((m) => !/9876543210/.test(m.to)), 'numbers are masked');
});

test('connect own WhatsApp number (Pro): validated against Meta, token encrypted, own webhook URL + verify token', async () => {
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/whatsapp/connection`, { method: 'PUT', body: { phoneNumberId: '2000002', accessToken: 'E'.repeat(120) } })).status, 402);
  const bad = await H.api(PRO, `/stores/${PRO.sid}/whatsapp/connection`, { method: 'PUT', body: { phoneNumberId: '9999999', accessToken: 'E'.repeat(120) } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, 'whatsapp_rejected');
  const c = await H.api(PRO, `/stores/${PRO.sid}/whatsapp/connection`, { method: 'PUT', body: { phoneNumberId: '2000002', accessToken: 'E'.repeat(120), appSecret: 'b'.repeat(32) } });
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.sendingFrom, 'own'); assert.equal(c.json.own.verifiedName, 'My Shop');
  const { WhatsAppConnection } = require('../src/models/WhatsApp');
  const row = await WhatsAppConnection.findOne({ store: PRO.sid }).select('+tokenEnc +appSecretEnc');
  assert.ok(row.tokenEnc.startsWith('v1.') && !row.tokenEnc.includes('EEEE')); assert.ok(!row.appSecretEnc.includes('bbbb'));
  const url = new URL(c.json.own.webhook.url);
  const v = await fetch(`${H.base}${url.pathname}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(c.json.own.webhook.verifyToken)}&hub.challenge=77`);
  assert.equal(await v.text(), '77');
  // store messages now go from the store's own number with its own token
  sent = [];
  const m = await outbox.enqueue({ store: PRO.sid, channel: 'whatsapp', audience: 'buyer', kind: 'test', to: '919333333333', payload: { type: 'text', text: 'x' }, dedupeKey: 'it-own-' + H.rnd() });
  await outbox.flush(200); assert.equal((await OM().findById(m._id)).status, 'sent');
  const own = sent.find((x) => x.body.to === '919333333333'); assert.ok(own.url.includes('/2000002/messages')); assert.equal(own.auth, 'Bearer ' + 'E'.repeat(120));
  // a shopper writing to the store's own number gets the store greeting (signed with the store's app secret)
  const raw = envelope({ messages: [{ id: 'wamid.OWN1', from: '919444444444', type: 'text', text: { body: 'hi' } }] }, '2000002');
  assert.equal((await hook(raw, { key: url.pathname.split('/').pop(), secret: 'b'.repeat(32) })).status, 200); await settle();
  assert.match(await lastReply('919444444444'), /Thanks for messaging/);
  assert.equal((await hook(raw, { key: url.pathname.split('/').pop() })).status, 401, 'platform secret is not accepted on a store webhook');
  const d = await H.api(PRO, `/stores/${PRO.sid}/whatsapp/connection`, { method: 'DELETE' });
  assert.equal(d.json.sendingFrom, 'platform');
});

test('status page, QR code and catalogue share kit', async () => {
  const st = await H.api(PRO, `/stores/${PRO.sid}/whatsapp`);
  assert.equal(st.status, 200); assert.equal(st.json.features.commands, true); assert.ok(st.json.recent.length > 0); assert.equal(st.json.commandNumber, '919000000000');
  const qr = await H.page(`/store/${PRO.slug}/qr.svg`);
  assert.equal(qr.status, 200); assert.match(qr.headers.get('content-type'), /image\/svg\+xml/); assert.match(qr.text, /^<svg/);
  const sh = await H.api(PRO, `/stores/${PRO.sid}/whatsapp/share`, { method: 'POST', body: { productIds: [pp.id], intro: 'Diwali offers!' } });
  assert.equal(sh.status, 200); assert.match(sh.json.text, /Diwali offers!/); assert.match(sh.json.text, /\/product\/blue-kurta/); assert.match(sh.json.shareUrl, /^https:\/\/wa\.me\/\?text=/);
  assert.equal((await H.api(PRO, `/stores/${PRO.sid}/whatsapp/share`, { method: 'POST', body: { productIds: ['nope'] } })).status, 400);
});

test('test alert endpoint and plan / payment-issue events reach the bell', async () => {
  const t = await H.api(PRO, `/stores/${PRO.sid}/notifications/test`, { method: 'POST', body: { channel: 'email' } });
  assert.equal(t.status, 202); assert.ok(t.json.message);
  assert.equal((await H.api(FREE, `/stores/${FREE.sid}/notifications/test`, { method: 'POST', body: { channel: 'whatsapp' } })).status, 402);
  await events.emit('plan.expiring', { storeId: PRO.sid, plan: 'pro', expiresAt: new Date(Date.now() + 3 * 864e5), daysLeft: 3 });
  await events.emit('payment.issue', { storeId: PRO.sid, orderNumber: 1001, message: 'Captured payment on a cancelled order', key: 'k1' });
  await events.emit('payment.issue', { storeId: PRO.sid, orderNumber: 1001, message: 'Captured payment on a cancelled order', key: 'k1' });
  await settle();
  const list = await H.api(PRO, `/stores/${PRO.sid}/notifications?unread=1`);
  assert.ok(list.json.notifications.some((n) => /ends in 3 days/.test(n.title)));
  assert.equal(list.json.notifications.filter((n) => n.type === 'payment.issue').length, 1);
});
