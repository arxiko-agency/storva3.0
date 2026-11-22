'use strict';
// Module 6 step 2: the REAL storefront views and client script (checkout.ejs, order.ejs, public/js/storefront.js) driven in a real browser
// against a mock STORVA API and a fake Razorpay Checkout window. No MongoDB and no Razorpay account are needed, and nothing leaves the machine.
// Needs the `ejs` and `playwright` packages plus a Chromium; the suite skips itself (with a note) when they are missing.
//   npm i -D playwright && npx playwright install chromium     then     node --test test/module6.browser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

let ejs, chromium;
try { ejs = require('ejs'); ({ chromium } = require('playwright')); } catch { /* handled below */ }
const root = path.join(__dirname, '..');
const SLUG = 'demo', TOKEN = 'ab'.repeat(16), SECRET = 'SUPER_SECRET_KEY_VALUE_9f3a', KEY_ID = 'rzp_test_demoKey123';
const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const STORE = { name: 'Demo Sarees', slug: SLUG, tagline: '', description: '', logoUrl: '', whatsappNumber: '', contactEmail: '', address: '' };

// ---------- mock server ----------
function makeServer() {
  const S = { onlineEnabled: true, orders: new Map(), calls: [], verifyPlan: [], paymentPlan: 'ok', nextNo: 1001 };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const buyer = (o) => ({ orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, paidAt: o.paidAt || null, customer: { name: 'Priya Nair', phone: '919876543210', email: '' },
    shippingAddress: { line1: '12 MG Road', line2: '', city: 'Pune', state: 'MH', pincode: '411001' }, note: '', items: [{ title: 'Silk saree', variantLabel: '', image: '', unitPrice: 499.5, qty: 1, lineTotal: 499.5 }], subtotal: 499.5, discount: 0, shipping: 0, total: 499.5, couponCode: null });
  const page = (file, locals) => ejs.renderFile(path.join(root, 'views/storefront', file), { title: 'Test', store: STORE, money, safeJson: JSON.stringify, waLink: () => '', brand: 'STORVA', appUrl: '', noindex: true, onlinePayments: S.onlineEnabled, ...locals });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    try {
      if (u.pathname === `/store/${SLUG}/checkout`) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(await page('checkout.ejs', { page: 'checkout' })); }
      let m = u.pathname.match(new RegExp(`^/store/${SLUG}/order/(\\d+)$`));
      if (m) { const o = S.orders.get(Number(m[1])); if (!o || u.searchParams.get('t') !== TOKEN) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': 'text/html' }); return res.end(await page('order.ejs', { page: 'order', order: buyer(o) })); }
      if (u.pathname.startsWith('/js/') || u.pathname.startsWith('/css/') || u.pathname.startsWith('/images/')) {
        const f = path.join(root, 'public', u.pathname); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': u.pathname.endsWith('.js') ? 'text/javascript' : u.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); return res.end(fs.readFileSync(f));
      }
      const api = u.pathname.replace(`/api/public/stores/${SLUG}`, '');
      if (api === '/cart/quote') return json(res, 200, { canCheckout: true, subtotal: 499.5, discount: 0, shipping: 0, total: 499.5, coupon: null, lines: [{ productId: 'a'.repeat(24), variantId: null, title: 'Silk saree', variantLabel: '', image: '', unitPrice: 499.5, qty: 1, lineTotal: 499.5, ok: true, maxQty: 5 }] });
      if (api === '/orders' && req.method === 'POST') {
        S.calls.push({ path: api, body });
        const o = { orderNumber: S.nextNo++, status: 'pending', paymentMethod: body.paymentMethod, paymentStatus: body.paymentMethod === 'razorpay' ? 'pending' : 'unpaid' };
        S.orders.set(o.orderNumber, o);
        return json(res, 201, { order: buyer(o), token: TOKEN, url: `/store/${SLUG}/order/${o.orderNumber}?t=${TOKEN}`, replayed: false });
      }
      m = api.match(/^\/orders\/(\d+)(\/payment(\/verify)?)?$/);
      if (m) {
        const o = S.orders.get(Number(m[1]));
        if (!m[2]) return o && u.searchParams.get('t') === TOKEN ? json(res, 200, { order: buyer(o) }) : json(res, 404, { error: { code: 'not_found', message: 'Order not found.' } });
        S.calls.push({ path: api, body });
        if (!o || body.token !== TOKEN) return json(res, 404, { error: { code: 'not_found', message: 'Order not found.' } });
        if (!m[3]) {
          if (S.paymentPlan === '503') return json(res, 503, { error: { code: 'payments_unavailable', message: 'Online payment is not available right now. Please choose cash on delivery.' } });
          if (o.paymentStatus === 'paid') return json(res, 409, { error: { code: 'already_paid', message: 'This order is already paid.' } });
          return json(res, 200, { payment: { keyId: KEY_ID, razorpayOrderId: 'order_Mock' + o.orderNumber + 'ABCDEFGH', amount: 49950, currency: 'INR', orderNumber: o.orderNumber, name: STORE.name, description: `Order #${o.orderNumber}`, prefill: { name: 'Priya Nair', contact: '+919876543210' } } });
        }
        const plan = S.verifyPlan.shift() || 'ok';
        if (plan === 'drop') return req.socket.destroy();
        if (plan === 'invalid') return json(res, 400, { error: { code: 'invalid_signature', message: 'We could not verify this payment.' } });
        o.paymentStatus = 'paid'; o.paidAt = new Date().toISOString();
        return json(res, 200, { verified: true, alreadyVerified: false, order: buyer(o) });
      }
      json(res, 404, { error: { code: 'not_found', message: 'nope' } });
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack)); }
  });
  return { S, server };
}

// Fake Razorpay Checkout. window.__rzp = { behavior, opened:[options] } is controlled by the test.
const FAKE_RZP = `
window.Razorpay = function (options) { this.o = options; this.h = {}; };
window.Razorpay.prototype.on = function (ev, fn) { this.h[ev] = fn; };
window.Razorpay.prototype.open = function () {
  var self = this, o = this.o; window.__rzp = window.__rzp || { behavior: 'success', opened: [] }; window.__rzp.opened.push(JSON.parse(JSON.stringify(o)));
  setTimeout(function () {
    var b = window.__rzp.behavior;
    if (b === 'success') o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_MockPayment0001', razorpay_signature: 'f'.repeat(64) });
    else { if (b === 'fail') self.h['payment.failed']({ error: { description: window.__rzp.failText || 'Card declined' } }); o.modal.ondismiss(); }
  }, 50);
};`;

const skip = !ejs || !chromium ? 'needs the ejs and playwright packages (see the header of this file)' : false;
let browser, mock, base;
test.before(async () => {
  if (skip) return;
  mock = makeServer(); await new Promise((r) => mock.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${mock.server.address().port}`;
  try { browser = await chromium.launch(); } catch (e) { console.warn('[module6.browser] Chromium unavailable:', e.message.split('\n')[0]); }
});
test.after(async () => { if (browser) await browser.close(); if (mock) mock.server.close(); });

async function newPage({ rzp = 'ok', behavior = 'success', online = true } = {}) {
  mock.S.onlineEnabled = online; mock.S.calls.length = 0; mock.S.verifyPlan = []; mock.S.paymentPlan = 'ok';
  const ctx = await browser.newContext(), page = await ctx.newPage();
  page.rzpRequests = 0; page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('https://checkout.razorpay.com/**', (route) => { page.rzpRequests++; return rzp === 'blocked' ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: FAKE_RZP }); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.addInitScript((b) => { try { localStorage.setItem('storva_cart_demo', JSON.stringify([{ productId: 'a'.repeat(24), variantId: null, qty: 1 }])); } catch {} window.__rzp = { behavior: b, opened: [] }; }, behavior);
  return page;
}
async function fillAndSubmit(page) {
  await page.goto(`${base}/store/${SLUG}/checkout`);
  await page.waitForSelector('#place');
  for (const [id, v] of Object.entries({ name: 'Priya Nair', phone: '9876543210', line1: '12 MG Road', city: 'Pune', pincode: '411001' })) await page.fill('#' + id, v);
  await page.selectOption('#state', 'Maharashtra'); // Module 12: the state is a list (delivery region + GST place of supply)
}
const text = (page) => page.locator('body').innerText();

test('checkout: online option is preselected, labels follow the choice, COD stays available', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  await page.goto(`${base}/store/${SLUG}/checkout`); await page.waitForSelector('#place');
  assert.equal(await page.isChecked('#pm-razorpay'), true);
  assert.match(await page.textContent('#place'), /^Pay ₹499\.50 securely$/);
  assert.match(await text(page), /UPI, debit card, credit card or net banking/);
  await page.check('#pm-cod');
  assert.match(await page.textContent('#place'), /^Place order · ₹499\.50$/);
  assert.match(await page.textContent('#pay-note'), /cash on delivery/i);
  await page.check('#pm-razorpay'); assert.match(await page.textContent('#pay-note'), /never reach this store/);
  assert.deepEqual(page.errors, []);
});

test('checkout: when Razorpay is not configured only cash on delivery is shown (Module 5 behaviour)', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage({ online: false });
  await page.goto(`${base}/store/${SLUG}/checkout`); await page.waitForSelector('#place');
  assert.equal(await page.locator('input[name=paymentMethod]').count(), 0);
  assert.match(await page.textContent('#place'), /^Place order · /);
  assert.match(await page.textContent('#pay-note'), /cash on delivery/i);
  assert.equal(page.rzpRequests, 0, 'Razorpay script must not load');
});

test('COD order: no payment calls, Razorpay script never requested, order page as in Module 5', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  await fillAndSubmit(page); await page.check('#pm-cod'); await page.click('#place');
  await page.waitForURL(/\/order\/\d+\?t=/);
  assert.equal(mock.S.calls.find((c) => c.path === '/orders').body.paymentMethod, 'cod');
  assert.equal(mock.S.calls.some((c) => c.path.includes('/payment')), false);
  const t = await text(page);
  assert.match(t, /Thank you, Priya!/); assert.match(t, /Cash on delivery \(unpaid\)/); assert.equal(await page.locator('#pay-now').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('storva_cart_demo')), null, 'cart cleared');
});

test('online success: order, payment order, Checkout opened with the public key only, signature sent to the server, order shown as paid', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  await fillAndSubmit(page);
  page.on('request', (r) => { assert.ok(!(r.postData() || '').includes(SECRET)); });
  await page.click('#place');
  await page.waitForURL(/\/order\/\d+\?t=/); await page.waitForSelector('#pay-box');
  const [create, verify] = [mock.S.calls.find((c) => /\/payment$/.test(c.path)), mock.S.calls.find((c) => /\/verify$/.test(c.path))];
  assert.equal(mock.S.calls.find((c) => c.path === '/orders').body.paymentMethod, 'razorpay');
  assert.deepEqual(Object.keys(create.body), ['token']);
  assert.equal(verify.body.token, TOKEN); assert.match(verify.body.razorpay_order_id, /^order_Mock/); assert.equal(verify.body.razorpay_payment_id, 'pay_MockPayment0001'); assert.equal(verify.body.razorpay_signature.length, 64);
  const t = await text(page);
  assert.match(t, /Payment received, Priya!/); assert.match(t, /Paid online/); assert.match(t, /Payment received\. Thank you!/); assert.equal(await page.locator('#pay-now').count(), 0);
  assert.deepEqual(page.errors, []);
});

test('Checkout options: public key id, server order id and prefill; no secret anywhere in the options', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage({ behavior: 'dismiss' });
  await fillAndSubmit(page);
  const captured = new Promise((resolve) => page.exposeFunction('__grab', resolve));
  await page.evaluate(() => { const t = setInterval(() => { if (window.__rzp.opened.length) { clearInterval(t); window.__grab(JSON.stringify(window.__rzp.opened)); } }, 5); });
  await page.click('#place');
  const opts = JSON.parse(await captured)[0];
  assert.equal(opts.key, KEY_ID); assert.match(opts.order_id, /^order_Mock/); assert.equal(opts.amount, 49950); assert.equal(opts.currency, 'INR'); assert.equal(opts.prefill.contact, '+919876543210');
  assert.ok(!JSON.stringify(opts).includes(SECRET));
});

test('dismissed payment: shopper lands on the order page with a calm message and can pay again', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage({ behavior: 'dismiss' });
  await fillAndSubmit(page); await page.click('#place');
  await page.waitForURL(/\/order\/\d+\?t=/); await page.waitForSelector('#pay-now');
  let t = await text(page);
  assert.match(t, /Almost there, Priya/); assert.match(t, /Online payment pending/); assert.match(t, /The payment was not completed\. Your order is saved/);
  assert.match(await page.textContent('#pay-now'), /^Pay ₹499\.50 now$/);
  await page.evaluate(() => { window.__rzp.behavior = 'success'; });
  await page.click('#pay-now'); await page.waitForURL(/order\/\d+\?t=/); await page.waitForFunction(() => /Paid online/.test(document.body.innerText));
  assert.match(await text(page), /Payment received, Priya!/);
});

test('failed payment: Razorpay text is shown as plain text (no HTML injection) and the order stays retryable', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage({ behavior: 'fail' });
  await page.addInitScript(() => { window.__rzp.failText = 'Declined <img src=x onerror=window.__pwn=1>'; });
  await fillAndSubmit(page); await page.click('#place');
  await page.waitForURL(/\/order\/\d+\?t=/); await page.waitForSelector('#pay-msg');
  assert.match(await page.textContent('#pay-msg'), /The payment failed \(Declined <img src=x/);
  assert.equal(await page.locator('#pay-msg img').count(), 0); assert.equal(await page.evaluate(() => window.__pwn), undefined);
  assert.equal(await page.locator('#pay-now').count(), 1);
  mock.S.orders.get(Number(new URL(page.url()).pathname.split('/').pop())).paymentStatus = 'failed'; // what the webhook will do in step 3
  await page.reload(); assert.match(await text(page), /Payment did not go through/); assert.match(await page.textContent('#pay-now'), /Try payment again/);
});

test('confirmation trouble: unreachable server is shown as PENDING (never failed), retries, and recovers', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  await fillAndSubmit(page); mock.S.verifyPlan = Array(12).fill('drop'); await page.click('#place'); // Chrome silently re-sends a request on a reset connection, so drop generously
  await page.waitForSelector('.sf-pay-ov h2:has-text("Still confirming")', { timeout: 15000 });
  const t = await text(page);
  assert.match(t, /do not pay again/i); assert.doesNotMatch(t, /payment failed|did not go through/i);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith('storva_pv_'))), true, 'proof kept for the order page');
  mock.S.verifyPlan = []; // the server is reachable again
  await page.click('button:has-text("Check again")');
  await page.waitForURL(/\/order\/\d+\?t=/); await page.waitForFunction(() => /Paid online/.test(document.body.innerText));
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith('storva_pv_'))), false);
});

test('interrupted confirmation is finished automatically when the order page opens', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  mock.S.orders.set(2001, { orderNumber: 2001, status: 'pending', paymentMethod: 'razorpay', paymentStatus: 'pending' });
  await page.addInitScript(() => { sessionStorage.setItem('storva_pv_demo_2001', JSON.stringify({ razorpay_order_id: 'order_Mock2001ABCDEFGH', razorpay_payment_id: 'pay_MockPayment0001', razorpay_signature: 'f'.repeat(64) })); });
  await page.goto(`${base}/store/${SLUG}/order/2001?t=${TOKEN}`);
  await page.waitForFunction(() => /Paid online/.test(document.body.innerText), null, { timeout: 10000 });
  assert.ok(mock.S.calls.some((c) => /2001\/payment\/verify$/.test(c.path)));
});

test('rejected confirmation (bad signature): clear message, no retry loop, link back to the order', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  const page = await newPage();
  await fillAndSubmit(page); mock.S.verifyPlan = ['invalid']; await page.click('#place');
  await page.waitForSelector('.sf-pay-ov h2:has-text("could not confirm")');
  assert.equal(mock.S.calls.filter((c) => /verify$/.test(c.path)).length, 1);
  await page.click('button:has-text("View my order")'); await page.waitForURL(/\/order\/\d+/);
  assert.match(await text(page), /Online payment pending/);
});

test('payment unavailable (503) and blocked Razorpay script are explained, with a way back to the order', { skip }, async (tc) => {
  if (!browser) return tc.skip('Chromium is not installed (npx playwright install chromium)');
  let page = await newPage(); await fillAndSubmit(page); mock.S.paymentPlan = '503'; await page.click('#place');
  await page.waitForSelector('.sf-pay-ov h2:has-text("unavailable")'); assert.match(await text(page), /choose cash on delivery/i);
  assert.equal(await page.locator('.sf-pay-ov button:has-text("Try again")').count(), 0, 'a definite refusal is not retried blindly');
  page = await newPage({ rzp: 'blocked' }); await fillAndSubmit(page); await page.click('#place');
  await page.waitForSelector('.sf-pay-ov h2:has-text("could not load")'); assert.match(await text(page), /ad blocker/i);
  assert.equal(await page.locator('.sf-pay-ov button:has-text("Try again")').count(), 1);
});

test('static: the client has no secrets, only the Razorpay origins are allowed by the CSP', { skip: false }, () => {
  const js = fs.readFileSync(path.join(root, 'public/js/storefront.js'), 'utf8'), app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.doesNotMatch(js, /key_secret|KEY_SECRET|keySecret|webhook/i);
  assert.equal([...js.matchAll(/https?:\/\/[^'"\s)]+/g)].map((m) => m[0]).join(), 'https://checkout.razorpay.com/v1/checkout.js');
  for (const d of ['script-src', 'frame-src', 'connect-src', 'form-action']) assert.match(app, new RegExp(`'${d}':[^\\]]*razorpay\\.com`), d);
  assert.doesNotMatch(app, /\*\.razorpay|'unsafe-hashes'|https:\s*['"],/, 'no wildcard hosts');
});
