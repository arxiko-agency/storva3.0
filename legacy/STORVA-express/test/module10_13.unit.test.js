'use strict';
// Modules 10 + 13 pure logic: command parsing (English + Malayalam), shipment/caption parsing, message templates (escaping,
// template params), WhatsApp request bodies and error classification, token encryption, webhook signatures.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'z'.repeat(40);
const C = require('../src/services/waCommands');
const M = require('../src/utils/messages');
const api = require('../src/services/whatsappApi');
const box = require('../src/utils/secretBox');
const { validSignature } = require('../src/services/waWebhook');
const crypto = require('crypto');

test('parseCommand: English, Manglish/Malayalam aliases, bare order numbers, unknown text', () => {
  assert.deepEqual(C.parseCommand('ship 1042 DTDC AB12').cmd, 'SHIP');
  assert.deepEqual(C.parseCommand('  Orders ').cmd, 'ORDERS');
  assert.equal(C.parseCommand('order').cmd, 'ORDERS');
  assert.deepEqual(C.parseCommand('order 1042'), { cmd: 'ORDER', args: ['1042'], raw: 'order 1042' });
  assert.deepEqual(C.parseCommand('#1042').args, ['1042']);
  assert.equal(C.parseCommand('സഹായം').cmd, 'HELP');
  assert.equal(C.parseCommand('ഓർഡറുകൾ').cmd, 'ORDERS');
  assert.equal(C.parseCommand('low stock').cmd, 'LOW');
  assert.equal(C.parseCommand('Hi!').cmd, 'HELP');
  assert.equal(C.parseCommand('what is this').cmd, 'UNKNOWN');
  assert.equal(C.parseCommand('').cmd, '');
});

test('parseShipment / splitValue / parseCaption', () => {
  assert.deepEqual(C.parseShipment(['DTDC', 'D123']), { carrier: 'DTDC', trackingNumber: 'D123', trackingUrl: '' });
  assert.deepEqual(C.parseShipment(['EZ1234567IN']), { carrier: '', trackingNumber: 'EZ1234567IN', trackingUrl: '' });
  assert.equal(C.parseShipment(['https://t.co/x', 'AB1']).trackingUrl, 'https://t.co/x');
  assert.deepEqual(C.splitValue(['blue', 'kurta', '₹1,299']), { query: 'blue kurta', value: '1299' });
  assert.equal(C.splitValue(['12']), null);
  assert.deepEqual(C.parseCaption('Jute basket 499'), { title: 'Jute basket', pricePaise: 49900 });
  assert.deepEqual(C.parseCaption('Silk saree - Rs. 1,299.50'), { title: 'Silk saree', pricePaise: 129950 });
  assert.deepEqual(C.parseCaption('Handmade soap ₹120/-'), { title: 'Handmade soap', pricePaise: 12000 });
  assert.deepEqual(C.parseCaption('Just a lamp'), { title: 'Just a lamp', pricePaise: null });
  assert.deepEqual(C.parseCaption(''), { title: '', pricePaise: null });
});

const store = { name: 'Asha <Crafts>', slug: 'asha', whatsappNumber: '919000000000', contactEmail: 'a@x.in' };
const order = { orderNumber: 1042, publicToken: 't', customer: { name: 'Priya Nair', phone: '919876543210', email: 'p@x.in' }, shipping: { line1: '1 Rd', city: 'Kochi', state: 'Kerala', pincode: '682001' },
  items: [{ title: 'Mug <b>', qty: 2, lineTotalPaise: 50000 }], subtotalPaise: 50000, discountPaise: 0, shippingPaise: 4000, totalPaise: 54000, paymentMethod: 'cod', paymentStatus: 'unpaid', shipment: { carrier: 'DTDC', trackingNumber: 'D1', trackingUrl: '' } };

test('messages: HTML is escaped, WhatsApp template params are in the documented order', () => {
  const c = M.orderConfirmation({ store, order, link: 'https://s/o' });
  assert.ok(c.email.html.includes('Asha &lt;Crafts&gt;') && c.email.html.includes('Mug &lt;b&gt;') && !c.email.html.includes('<b>Mug'));
  assert.deepEqual(c.whatsapp.params, ['Priya', 'Asha <Crafts>', '1042', '₹540', 'https://s/o']);
  const u = M.orderUpdate({ store, order, status: 'shipped', link: 'L' });
  assert.equal(u.whatsapp.name, 'storva_order_update'); assert.equal(u.whatsapp.params[3], 'on its way'); assert.equal(u.whatsapp.params[4], 'Tracking: DTDC D1');
  assert.equal(M.refundProcessed({ store, order, amountPaise: 12345, link: 'L' }).whatsapp.params[1], '₹123.45');
  assert.equal(M.ownerNewOrder({ store, order, dashUrl: 'D' }).whatsapp.params.length, 6);
  process.env.WA_TPL_NEW_ORDER = 'my_custom_alert'; assert.equal(M.ownerNewOrder({ store, order, dashUrl: 'D' }).whatsapp.name, 'my_custom_alert'); delete process.env.WA_TPL_NEW_ORDER;
});

test('WhatsApp request bodies and template parameter cleaning', () => {
  const b = api.buildBody('919', { type: 'template', name: 'x', language: 'ml', params: ['a\nb', 'c     d', ''] });
  assert.deepEqual(b.template.components[0].parameters.map((p) => p.text), ['a b', 'c   d', '-']);
  assert.equal(b.template.language.code, 'ml');
  assert.equal(api.buildBody('919', { type: 'text', text: 'hi' }).text.body, 'hi');
  assert.equal(api.buildBody('919', { type: 'image', link: 'https://x/y.png', caption: 'c' }).image.link, 'https://x/y.png');
});

test('WhatsApp errors: permanent vs temporary', async () => {
  const run = async (status, json) => { api.setTransport(async () => ({ status, json })); try { await api.sendMessage({ phoneNumberId: '1', token: 't', to: '9', payload: { type: 'text', text: 'x' } }); return null; } catch (e) { return e; } finally { api.setTransport(null); } };
  assert.equal((await run(400, { error: { code: 131026, message: 'undeliverable' } })).definite, true);
  assert.equal((await run(400, { error: { code: 132001, message: 'template missing' } })).definite, true);
  assert.equal((await run(429, { error: { code: 130429, message: 'rate' } })).definite, false);
  assert.equal((await run(500, { error: { code: 1, message: 'oops' } })).definite, false);
  const noId = await run(200, { messages: [] }); assert.ok(noId instanceof api.WaError, '200 without a message id is an error'); assert.equal(noId.definite, false);
  api.setTransport(async () => { throw new Error('ECONNRESET'); });
  await assert.rejects(api.sendMessage({ phoneNumberId: '1', token: 't', to: '9', payload: { type: 'text', text: 'x' } }), (e) => e.definite === false);
  api.setTransport(null);
});

test('media download never sends our token to an unexpected host', async () => {
  api.setTransport(async ({ url }) => (url.endsWith('/m1') ? { status: 200, json: { url: 'https://evil.example.com/x' } } : { status: 200, buffer: Buffer.alloc(1) }));
  await assert.rejects(api.downloadMedia('m1', 't'), /Unexpected media location/);
  api.setTransport(null);
});

test('secretBox encrypts with a random IV and detects tampering', () => {
  const a = box.seal('EAAG-secret'), b = box.seal('EAAG-secret');
  assert.notEqual(a, b); assert.ok(!a.includes('EAAG')); assert.equal(box.open(a), 'EAAG-secret');
  const parts = a.split('.'); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'B' : 'A') + parts[3].slice(-1);
  assert.equal(box.open(parts.join('.')), null); assert.equal(box.open('garbage'), null);
});

test('webhook signature check', () => {
  const raw = Buffer.from('{"a":1}'), secret = 's'.repeat(32);
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(validSignature(raw, good, secret), true);
  assert.equal(validSignature(raw, good, 'x'.repeat(32)), false);
  assert.equal(validSignature(raw, 'sha1=abc', secret), false);
  assert.equal(validSignature(raw, good, ''), false);
});
