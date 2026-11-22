'use strict';
// Module 5 unit tests. No database, no npm packages: pure rules plus static checks of the views and client code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeCouponCode, couponProblem, discountFor } = require('../src/utils/pricing');
const { readCoupon } = require('../src/utils/couponInput');
const { readCartItems, readCheckout } = require('../src/utils/checkoutInput');
const { STATUSES, canTransition, releasesInventory } = require('../src/utils/orderStatus');

const OID = 'a'.repeat(24), OID2 = 'b'.repeat(24);

test('coupon codes are normalised to upper case and plain characters only', () => {
  assert.equal(normalizeCouponCode(' diwali-10 '), 'DIWALI-10');
  for (const bad of ['', 'ab', 'has space', 'a'.repeat(21), '-abc', 'ab$c', null, undefined, 5, {}, ['ABC'], { $ne: 1 }]) assert.equal(normalizeCouponCode(bad), null, String(JSON.stringify(bad)));
});

test('couponProblem: inactive, not started, expired, used up, minimum order', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const ok = { active: true, usedCount: 0, minOrderPaise: 0 };
  assert.equal(couponProblem(ok, 100, now), null);
  assert.match(couponProblem({ ...ok, active: false }, 100, now), /not valid/);
  assert.match(couponProblem({ ...ok, startsAt: new Date('2026-07-01') }, 100, now), /not active yet/);
  assert.match(couponProblem({ ...ok, expiresAt: new Date('2026-06-01') }, 100, now), /expired/);
  assert.match(couponProblem({ ...ok, expiresAt: now }, 100, now), /expired/, 'expiry instant itself is already expired');
  assert.equal(couponProblem({ ...ok, expiresAt: new Date('2026-12-01') }, 100, now), null);
  assert.match(couponProblem({ ...ok, usageLimit: 2, usedCount: 2 }, 100, now), /fully used/);
  assert.equal(couponProblem({ ...ok, usageLimit: 2, usedCount: 1 }, 100, now), null);
  assert.match(couponProblem({ ...ok, minOrderPaise: 50000 }, 30000, now), /₹200 more/);
  assert.equal(couponProblem({ ...ok, minOrderPaise: 50000 }, 50000, now), null, 'exactly the minimum is allowed');
  assert.match(couponProblem(null, 100, now), /not valid/);
});

test('discountFor: percent rounds down, caps, never exceeds the subtotal', () => {
  assert.equal(discountFor({ type: 'percent', value: 10 }, 149950), 14995);
  assert.equal(discountFor({ type: 'percent', value: 10 }, 999), 99, 'floor, not round');
  assert.equal(discountFor({ type: 'percent', value: 50, maxDiscountPaise: 10000 }, 100000), 10000);
  assert.equal(discountFor({ type: 'percent', value: 100 }, 5000), 5000);
  assert.equal(discountFor({ type: 'fixed', value: 20000 }, 150000), 20000);
  assert.equal(discountFor({ type: 'fixed', value: 20000 }, 15000), 15000, 'fixed coupon cannot make the total negative');
  assert.equal(discountFor({ type: 'fixed', value: 20000 }, 0), 0);
  assert.equal(discountFor(null, 1000), 0);
});

test('readCoupon: valid percent and fixed coupons are stored in paise', () => {
  const p = readCoupon({ code: 'save10', type: 'percent', value: 10, minOrder: 499.5, maxDiscount: 200, usageLimit: 50, expiresAt: '2030-01-01T00:00:00Z' });
  assert.deepEqual(p.fields, {}); assert.equal(p.data.code, 'SAVE10'); assert.equal(p.data.value, 10); assert.equal(p.data.minOrderPaise, 49950); assert.equal(p.data.maxDiscountPaise, 20000); assert.equal(p.data.usageLimit, 50);
  const f = readCoupon({ code: 'FLAT100', type: 'fixed', value: 100 });
  assert.deepEqual(f.fields, {}); assert.equal(f.data.value, 10000);
});

test('readCoupon: rejects bad input, operators and impossible values', () => {
  const bad = (i) => readCoupon(i).fields;
  assert.ok(bad({}).code && bad({}).type);
  assert.ok(bad({ code: 'AB', type: 'percent', value: 10 }).code);
  assert.ok(bad({ code: { $ne: 1 }, type: 'percent', value: 10 }).code);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 0 }).value);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 101 }).value);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 10.5 }).value);
  assert.ok(bad({ code: 'ABC', type: 'fixed', value: 0.5 }).value);
  assert.ok(bad({ code: 'ABC', type: 'weird', value: 5 }).type);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 5, usageLimit: 0 }).usageLimit);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 5, minOrder: -1 }).minOrder);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 5, expiresAt: 'not a date' }).expiresAt);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 5, startsAt: '2030-02-01', expiresAt: '2030-01-01' }).expiresAt);
  assert.ok(bad({ code: 'ABC', type: 'percent', value: 5, active: 'yes' }).active);
  assert.ok(readCoupon(null).fields.code && readCoupon([]).fields.code);
});

test('readCoupon (PATCH): code is immutable, limit cannot drop below uses used', () => {
  const existing = { code: 'SAVE10', type: 'percent', value: 10, usedCount: 5, usageLimit: 10, startsAt: null, expiresAt: null };
  assert.deepEqual(readCoupon({ active: false }, { partial: true, existing }).fields, {});
  assert.ok(readCoupon({ code: 'OTHER' }, { partial: true, existing }).fields.code);
  assert.deepEqual(readCoupon({ code: 'save10' }, { partial: true, existing }).fields, {});
  assert.ok(readCoupon({ usageLimit: 3 }, { partial: true, existing }).fields.usageLimit);
  assert.deepEqual(readCoupon({ usageLimit: null }, { partial: true, existing }).fields, {});
  assert.ok(readCoupon({ value: 150 }, { partial: true, existing }).fields.value, 'percent above 100 on an existing percent coupon');
  assert.ok(readCoupon({ expiresAt: '2020-01-01' }, { partial: true, existing: { ...existing, startsAt: new Date('2025-01-01') } }).fields.expiresAt);
});

test('readCartItems: merges duplicates, caps quantity, rejects junk', () => {
  const m = readCartItems([{ productId: OID, qty: 2 }, { productId: OID.toUpperCase(), qty: 3 }, { productId: OID, variantId: OID2, qty: 1 }]);
  assert.equal(m.items.length, 2); assert.equal(m.items.find((i) => !i.variantId).qty, 5);
  assert.equal(readCartItems([{ productId: OID, qty: 15 }, { productId: OID, qty: 15 }]).items[0].qty, 20, 'merged quantity is capped');
  for (const bad of [null, 'x', {}, [], [null], [{ productId: 'nope', qty: 1 }], [{ productId: OID, qty: 0 }], [{ productId: OID, qty: 21 }], [{ productId: OID, qty: 1.5 }], [{ productId: OID, qty: 'abc' }], [{ productId: { $ne: 1 }, qty: 1 }], [{ productId: OID, variantId: 'zz', qty: 1 }], [{ productId: OID, variantId: { $gt: '' }, qty: 1 }]]) {
    assert.ok(readCartItems(bad).problem, JSON.stringify(bad));
  }
  const many = Array.from({ length: 31 }, (_, i) => ({ productId: i.toString(16).padStart(24, '0'), qty: 1 }));
  assert.ok(readCartItems(many).problem, 'more than 30 lines');
});

test('readCheckout: valid form is normalised', () => {
  const { data, fields } = readCheckout({ name: ' Priya Nair ', phone: '+91 98765 43210', email: 'P@Example.com', address: { line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, note: 'Call first', couponCode: 'save10', idempotencyKey: 'abcdef1234567890' });
  assert.deepEqual(fields, {});
  assert.equal(data.name, 'Priya Nair'); assert.equal(data.phone, '919876543210'); assert.equal(data.email, 'p@example.com');
  assert.equal(data.shipping.pincode, '560001'); assert.equal(data.couponCode, 'SAVE10'); assert.equal(data.idempotencyKey, 'abcdef1234567890');
});

test('readCheckout: collects every field error and refuses objects', () => {
  const { fields } = readCheckout({ name: 'P', phone: '12345', email: 'nope', address: { line1: 'x', city: '', state: '', pincode: '012345' }, couponCode: '$$', idempotencyKey: 'short' });
  for (const k of ['name', 'phone', 'email', 'line1', 'city', 'state', 'pincode', 'couponCode', 'idempotencyKey']) assert.ok(fields[k], k);
  const inj = readCheckout({ name: { $ne: 1 }, phone: { $gt: '' }, address: 'x', note: { a: 1 } }).fields;
  for (const k of ['name', 'phone', 'line1', 'pincode', 'note']) assert.ok(inj[k], k);
  assert.ok(readCheckout(null).fields.name);
  const ok = readCheckout({ name: 'Priya', phone: '9876543210', address: { line1: '12 MG Road', city: 'Pune', state: 'MH', pincode: 411001 } });
  assert.deepEqual(ok.fields, {}, 'numeric pincode is accepted'); assert.equal(ok.data.email, ''); assert.equal(ok.data.couponCode, null);
});

test('order lifecycle: allowed transitions only; cancel is the only inventory-releasing move', () => {
  assert.deepEqual(STATUSES, ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);
  const yes = [['pending', 'confirmed'], ['pending', 'cancelled'], ['confirmed', 'shipped'], ['confirmed', 'cancelled'], ['shipped', 'delivered']];
  for (const [a, b] of yes) assert.equal(canTransition(a, b), true, `${a}->${b}`);
  const no = [['pending', 'shipped'], ['pending', 'delivered'], ['shipped', 'cancelled'], ['delivered', 'cancelled'], ['delivered', 'pending'], ['cancelled', 'pending'], ['cancelled', 'confirmed'], ['pending', 'pending'], ['x', 'pending']];
  for (const [a, b] of no) assert.equal(canTransition(a, b), false, `${a}->${b}`);
  assert.equal(releasesInventory('cancelled'), true); assert.equal(releasesInventory('shipped'), false);
});

// ---- static checks (the EJS engine is not installed in the verification sandbox, so templates are checked structurally) ----
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const viewFiles = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? viewFiles(path.join(d, e.name)) : [path.join(d, e.name)]));

test('views: EJS tags are balanced and every include exists', () => {
  const files = viewFiles('views/storefront').filter((f) => f.endsWith('.ejs'));
  assert.ok(files.length >= 10, 'expected the storefront views');
  for (const f of files) {
    const src = read(f);
    assert.equal((src.match(/<%/g) || []).length, (src.match(/%>/g) || []).length, `${f}: unbalanced <% %>`);
    assert.ok(!/<%[^%]*<%/.test(src.replace(/<%[^>]*?%>/g, '')), `${f}: nested tag`);
    for (const m of src.matchAll(/include\('([^']+)'(\s*\+)?/g)) {
      if (m[2]) { // dynamic include (Module 7 sections): every section type in the catalogue must have its partial
        const dir = path.join(root, path.dirname(f), m[1]);
        for (const type of Object.keys(require('../src/utils/themes').SECTION_CATALOG)) assert.ok(fs.existsSync(path.join(dir, type + '.ejs')), `${f}: missing section partial ${m[1]}${type}`);
        continue;
      }
      const target = path.join(path.dirname(f), m[1] + '.ejs');
      assert.ok(fs.existsSync(path.join(root, target)), `${f}: missing include ${m[1]}`);
    }
    // Braces opened inside scriptlets must be closed (catches a forgotten "<% } %>").
    const code = [...src.matchAll(/<%(?![%=-])([\s\S]*?)%>/g)].map((m) => m[1]).join('\n');
    assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length, `${f}: unbalanced braces in scriptlets`);
  }
});

test('views: unescaped output (<%-) is only used for includes and the safeJson data block', () => {
  for (const f of viewFiles('views/storefront').filter((x) => x.endsWith('.ejs'))) {
    for (const m of read(f).matchAll(/<%-\s*([^%]*?)\s*%>/g)) assert.match(m[1], /^(include\(|safeJson\(|safeCss\()/, `${f}: unsafe raw output <%- ${m[1]} %>`);
  }
});

test('client code never writes dynamic data with innerHTML / document.write / eval', () => {
  for (const f of ['public/js/storefront.js', 'public/js/dashboard-m5.js']) {
    const src = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src), f);
  }
});

test('client API paths exist on the server', () => {
  const pub = read('src/routes/public.js'), js = read('public/js/storefront.js');
  for (const p of ["'/cart/quote'", "'/orders'"]) { assert.ok(js.includes(p), `client uses ${p}`); }
  for (const r of ["router.post('/cart/quote'", "router.post('/orders'", "router.get('/products'", "router.post('/coupons/validate'"]) assert.ok(pub.includes(r), r);
});

test('wiring: Module 5 routes are mounted, storefront pages come before static files', () => {
  assert.match(read('src/routes/stores.js'), /scoped\.use\('\/orders'/); assert.match(read('src/routes/stores.js'), /scoped\.use\('\/coupons'/);
  assert.match(read('src/routes/index.js'), /\/public\/stores\/:slug/); assert.match(read('src/app.js'), /routes\/storefrontPages/);
  // The storefront page route must come before the static handler, otherwise /store/... would 404 as a file.
  const app = read('src/app.js'); assert.ok(app.indexOf('storefrontPages') < app.indexOf("express.static(path.join(__dirname, '..', 'public')"));
});

test('tenant safety: every Module 5 query in routes and service carries a store filter', () => {
  // Structural guard: models are tenantScoped, and no Module 5 file opts out of the guard.
  for (const f of ['src/services/storefront.js', 'src/routes/public.js', 'src/routes/orders.js', 'src/routes/coupons.js', 'src/routes/storefrontPages.js']) assert.ok(!read(f).includes('skipTenant'), `${f} must not use skipTenant`);
  for (const m of ['Order', 'Coupon', 'Counter']) assert.match(read(`src/models/${m}.js`), /plugin\(tenantScoped\)/, m);
});
