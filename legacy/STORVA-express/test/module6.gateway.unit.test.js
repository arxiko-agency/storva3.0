'use strict';
// Module 6 step 4: the REAL src/services/razorpayApi.js against a STUBBED global fetch (no network, no Razorpay, no MongoDB, no npm packages).
// Proves how every gateway answer is classified (definite refusal vs unknown outcome vs auth/not_found/transient/bad_response),
// what is sent (URL, auth, idempotency header, body) and that neither the secret nor Razorpay's raw error text ever reaches an error message.
// NOTE: re-created in the final step-4 pass (the first scratch copy of this file was lost when the sandbox was reset); it is NOT the original.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc12345'; process.env.RAZORPAY_KEY_SECRET = 'SECRET_do_not_leak_9876';
const origLoad = Module._load;
Module._load = function (req, ...a) { if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } } return origLoad.call(this, req, ...a); };
const api = require('../src/services/razorpayApi');
Module._load = origLoad;

const realFetch = global.fetch, realErr = console.error;
let calls;
const reply = (status, body, { badJson = false } = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (badJson) throw new SyntaxError('Unexpected token <'); return body; } });
const stub = (impl) => { global.fetch = async (url, opts) => { calls.push({ url, opts }); return impl(url, opts); }; };
test.beforeEach(() => { calls = []; console.error = () => {}; });
test.afterEach(() => { global.fetch = realFetch; console.error = realErr; });

const EXPECT_AUTH = 'Basic ' + Buffer.from('rzp_test_abc12345:SECRET_do_not_leak_9876').toString('base64');
const refundArgs = { paymentId: 'pay_Abc123456789', amountPaise: 25000, idempotencyKey: 'rf_' + 'a'.repeat(40), receipt: 'shop-1001', notes: { store: 'shop', orderNumber: '1001' } };
const okRefund = { id: 'rfnd_Abc123456789', payment_id: 'pay_Abc123456789', amount: 25000, status: 'processed' };
const caught = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a rejection'); };
const noLeak = (e) => { const s = JSON.stringify({ m: e.message, d: e.details, c: e.code }); assert.ok(!s.includes('SECRET_do_not_leak'), 'secret leaked'); assert.ok(!s.includes('RAW_GATEWAY_TEXT'), 'raw gateway text leaked'); assert.ok(!s.includes(Buffer.from('rzp_test_abc12345:SECRET_do_not_leak_9876').toString('base64')), 'auth header leaked'); };

// ---------- createRefund: what is sent ----------
test('createRefund sends POST to the encoded payment path with Basic auth, the idempotency header and an integer-paise body', async () => {
  stub(() => reply(200, okRefund));
  const r = await api.createRefund({ ...refundArgs, paymentId: 'pay_Abc123456789' });
  assert.deepEqual(r, { id: 'rfnd_Abc123456789', paymentId: 'pay_Abc123456789', amount: 25000, status: 'processed' });
  const { url, opts } = calls[0];
  assert.equal(url, 'https://api.razorpay.com/v1/payments/pay_Abc123456789/refund'); assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.authorization, EXPECT_AUTH); assert.equal(opts.headers['X-Refund-Idempotency'], refundArgs.idempotencyKey); assert.equal(opts.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(opts.body), { amount: 25000, speed: 'normal', receipt: 'shop-1001', notes: { store: 'shop', orderNumber: '1001' } });
  assert.ok(opts.signal, 'a timeout signal is set');
});
test('createRefund path-encodes the payment id (no path injection)', async () => {
  stub(() => reply(200, okRefund)); await api.createRefund({ ...refundArgs, paymentId: '../orders?x=1' });
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/payments/..%2Forders%3Fx%3D1/refund');
});
test('a missing status in a good answer defaults to pending (never assumed processed)', async () => {
  stub(() => reply(200, { ...okRefund, status: undefined })); assert.equal((await api.createRefund(refundArgs)).status, 'pending');
});

// ---------- createRefund: definite vs unknown ----------
test('4xx = Razorpay REFUSED: definite=true, fixed message, raw text and secret never exposed, short gatewayCode kept', async () => {
  for (const status of [400, 404, 422]) {
    stub(() => reply(status, { error: { code: 'BAD_REQUEST_ERROR', description: 'RAW_GATEWAY_TEXT the payment has been fully refunded' } }));
    const e = await caught(api.createRefund(refundArgs));
    assert.equal(e.definite, true); assert.equal(e.code, 'refund_rejected'); assert.equal(e.status, 502); assert.equal(e.gatewayCode, 'BAD_REQUEST_ERROR'); noLeak(e);
  }
});
test('401/403 = our credentials were rejected: still definite, with the credentials message', async () => {
  for (const status of [401, 403]) { stub(() => reply(status, { error: { code: 'BAD_REQUEST_ERROR', description: 'RAW_GATEWAY_TEXT' } })); const e = await caught(api.createRefund(refundArgs)); assert.equal(e.definite, true); assert.match(e.message, /credentials/i); noLeak(e); }
});
test('UNKNOWN outcome => definite=false (money stays reserved, retry with same key): 500, 502, 503, 429, network error, timeout', async () => {
  for (const status of [500, 502, 503, 429]) { stub(() => reply(status, { error: { description: 'RAW_GATEWAY_TEXT' } })); const e = await caught(api.createRefund(refundArgs)); assert.equal(e.definite, false, 'HTTP ' + status); assert.equal(e.status, 503); noLeak(e); }
  for (const err of [new TypeError('fetch failed'), Object.assign(new Error('timeout'), { name: 'TimeoutError' })]) { stub(() => { throw err; }); const e = await caught(api.createRefund(refundArgs)); assert.equal(e.definite, false); assert.equal(e.code, 'gateway_unreachable'); noLeak(e); }
});
test('a 2xx answer that is unusable (not JSON, no id, odd id, float/missing/string amount) is UNKNOWN, never success and never a refusal', async () => {
  const bad = [reply(200, null, { badJson: true }), reply(200, {}), reply(200, { ...okRefund, id: 'rfnd_x' }), reply(200, { ...okRefund, id: 'pay_Abc123456789' }), reply(200, { ...okRefund, amount: 250.5 }), reply(200, { ...okRefund, amount: '25000' }), reply(200, { ...okRefund, amount: undefined }), reply(200, { id: 12345, amount: 25000 })];
  for (const b of bad) { stub(() => b); const e = await caught(api.createRefund(refundArgs)); assert.equal(e.definite, false); assert.equal(e.code, 'gateway_error'); }
});
test('a 4xx whose body is not JSON is still a definite refusal (it was clearly refused)', async () => {
  stub(() => reply(400, null, { badJson: true })); const e = await caught(api.createRefund(refundArgs)); assert.equal(e.definite, true); assert.equal(e.gatewayCode, '');
});
test('gatewayCode is cut to 40 characters', async () => {
  stub(() => reply(400, { error: { code: 'X'.repeat(200) } })); assert.equal((await caught(api.createRefund(refundArgs))).gatewayCode.length, 40);
});

// ---------- read-only calls ----------
test('fetchOrderPayments / fetchPaymentRefunds: GET, Basic auth, no body, no idempotency header, encoded ids, count=100 for refunds', async () => {
  stub(() => reply(200, { entity: 'collection', count: 1, items: [{ id: 'pay_1' }] }));
  assert.deepEqual(await api.fetchOrderPayments('order_Abc123'), [{ id: 'pay_1' }]);
  assert.deepEqual(await api.fetchPaymentRefunds('pay_Abc/123'), [{ id: 'pay_1' }]);
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders/order_Abc123/payments');
  assert.equal(calls[1].url, 'https://api.razorpay.com/v1/payments/pay_Abc%2F123/refunds?count=100');
  for (const c of calls) { assert.equal(c.opts.method, 'GET'); assert.equal(c.opts.headers.authorization, EXPECT_AUTH); assert.equal(c.opts.body, undefined); assert.equal(c.opts.headers['X-Refund-Idempotency'], undefined); assert.ok(c.opts.signal); }
});
test('read classification: 401/403 -> auth; 404 -> not_found; 429/5xx/network -> transient; unreadable -> bad_response', async () => {
  const kinds = async (impl) => { stub(impl); const e = await caught(api.fetchOrderPayments('order_Abc123')); noLeak(e); return e.kind; };
  assert.equal(await kinds(() => reply(401, { error: { description: 'RAW_GATEWAY_TEXT' } })), 'auth');
  assert.equal(await kinds(() => reply(403, {})), 'auth');
  assert.equal(await kinds(() => reply(404, { error: { description: 'RAW_GATEWAY_TEXT' } })), 'not_found');
  for (const s of [429, 500, 502, 503, 504]) assert.equal(await kinds(() => reply(s, {})), 'transient', 'HTTP ' + s);
  assert.equal(await kinds(() => { throw new TypeError('fetch failed'); }), 'transient');
  assert.equal(await kinds(() => reply(200, null, { badJson: true })), 'bad_response');
  assert.equal(await kinds(() => reply(200, { entity: 'collection', count: 0 })), 'bad_response', 'no items array');
  assert.equal(await kinds(() => reply(200, { items: 'nope' })), 'bad_response');
  assert.equal(await kinds(() => reply(200, [])), 'bad_response', 'a bare array is not the documented shape');
  assert.equal(await kinds(() => reply(400, { items: [] })), 'bad_response', 'a 4xx other than 401/403/404/429 is never trusted, even with items');
});
test('an empty items list is a valid answer (returns [])', async () => {
  stub(() => reply(200, { entity: 'collection', count: 0, items: [] })); assert.deepEqual(await api.fetchOrderPayments('order_Abc123'), []);
});
test('read errors carry a safe status/code and never the raw gateway text', async () => {
  stub(() => reply(401, { error: { description: 'RAW_GATEWAY_TEXT' } })); let e = await caught(api.fetchPaymentRefunds('pay_Abc123456789')); assert.equal(e.status, 502); assert.equal(e.code, 'gateway_auth');
  stub(() => reply(503, {})); e = await caught(api.fetchPaymentRefunds('pay_Abc123456789')); assert.equal(e.status, 503); assert.equal(e.code, 'gateway_error');
});

// ---------- createOrder ----------
test('createOrder: sends INR + integer amount + auth, returns only id/amount/currency', async () => {
  stub(() => reply(200, { id: 'order_Xyz987', amount: 12300, currency: 'INR', status: 'created', secret_extra: 'x' }));
  assert.deepEqual(await api.createOrder({ amountPaise: 12300, receipt: 'shop-1', notes: { a: 'b' } }), { id: 'order_Xyz987', amount: 12300, currency: 'INR' });
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders'); assert.equal(calls[0].opts.headers.authorization, EXPECT_AUTH);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { amount: 12300, currency: 'INR', receipt: 'shop-1', notes: { a: 'b' } });
});
test('createOrder failures: network -> 503 gateway_unreachable; 5xx/429 -> 503; 4xx/odd body -> 502; nothing leaks', async () => {
  stub(() => { throw new TypeError('fetch failed'); }); let e = await caught(api.createOrder({ amountPaise: 100 })); assert.equal(e.status, 503); assert.equal(e.code, 'gateway_unreachable'); noLeak(e);
  for (const [s, want] of [[500, 503], [429, 503], [400, 502], [401, 502]]) { stub(() => reply(s, { error: { code: 'X', description: 'RAW_GATEWAY_TEXT' } })); e = await caught(api.createOrder({ amountPaise: 100 })); assert.equal(e.status, want, 'HTTP ' + s); assert.equal(e.code, 'gateway_error'); noLeak(e); }
  stub(() => reply(200, { amount: 100 })); e = await caught(api.createOrder({ amountPaise: 100 })); assert.equal(e.status, 502); // 200 without an id
  stub(() => reply(200, null, { badJson: true })); e = await caught(api.createOrder({ amountPaise: 100 })); assert.equal(e.status, 502);
});
test('the error log line for a failed call never contains the secret or the raw description', async () => {
  const logged = []; console.error = (...a) => logged.push(a.join(' '));
  stub(() => reply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'RAW_GATEWAY_TEXT' } })); await caught(api.createRefund(refundArgs));
  stub(() => reply(401, {})); await caught(api.fetchOrderPayments('order_Abc123')); stub(() => reply(500, {})); await caught(api.createOrder({ amountPaise: 1 }));
  assert.ok(logged.length >= 2); for (const l of logged) { assert.ok(!l.includes('SECRET_do_not_leak')); assert.ok(!l.includes('RAW_GATEWAY_TEXT')); }
});
