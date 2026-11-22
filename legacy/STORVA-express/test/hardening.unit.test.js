'use strict';
// Modules 1-6 hardening: identifier throttle, storefront CSP, abandoned-order cleanup, stock return after a full refund.
// Pure logic + the REAL services against in-memory fakes. NOT a MongoDB / browser / Razorpay run (see docs/IMPLEMENTATION_STATUS.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const { Throttle, keyOf } = require('../src/utils/identifierThrottle');
const { storefrontCsp, storefrontCspMiddleware } = require('../src/utils/csp');
const { decideAbandon, hasLivePayment, decideRefundSettlement } = require('../src/utils/orderCleanup');
// The real service needs dotenv + the Order model only for its DEFAULT wiring; these tests inject fakes, so stub the two packages when npm install has not run.
const Module = require('module'), origLoad = Module._load;
Module._load = function (req, ...a) { if (req === 'dotenv') return { config() {} }; if (req === 'mongoose') return {}; if (req.endsWith('/models/Order')) return {}; return origLoad.call(this, req, ...a); };
let cleanupAbandoned, settleFullRefund; try { ({ cleanupAbandoned, settleFullRefund } = require('../src/services/orderSettlement')); } finally { Module._load = origLoad; }

// ---------- throttle ----------
test('throttle: limit, window expiry, cooldown, reset (fake clock)', () => {
  let t = 1000; const th = new Throttle({ windowMs: 1000, limit: 2, cooldownMs: 100, now: () => t });
  assert.equal(th.hit('a').ok, true); assert.equal(th.hit('a').ok, false, 'cooldown');
  t += 150; assert.equal(th.hit('a').ok, true); t += 150; assert.equal(th.hit('a').ok, false, 'limit 2 within window');
  assert.ok(th.peek('a').retryAfterSec >= 1);
  assert.equal(th.hit('b').ok, true, 'other key unaffected');
  t += 1000; assert.equal(th.hit('a').ok, true, 'window passed');
  th.reset('a'); assert.equal(th.peek('a').ok, true);
});
test('throttle: peek never records; keys are hashed, scoped and stable', () => {
  const th = new Throttle({ windowMs: 1000, limit: 1 }); th.peek('k'); th.peek('k'); assert.equal(th.hit('k').ok, true);
  assert.equal(keyOf('login', 'a@b.co'), keyOf('login', 'a@b.co')); assert.notEqual(keyOf('login', 'a@b.co'), keyOf('signup', 'a@b.co')); assert.ok(!keyOf('login', 'a@b.co').includes('a@b.co'));
});
test('throttle: memory is bounded', () => {
  const th = new Throttle({ windowMs: 1e9, limit: 1, maxKeys: 50 }); for (let i = 0; i < 500; i++) th.hit('k' + i); assert.ok(th.m.size <= 51);
});
test('auth route: no account-existence disclosure left (static)', () => {
  const a = read('src/routes/auth.js');
  assert.ok(!a.includes("'account_exists'") && !a.includes("'account_locked'"), 'old distinguishing responses removed');
  assert.match(a, /admitUnknownLogin\(/); assert.ok(!/new Throttle\(/.test(a), 'no in-memory throttle left in the auth route'); assert.match(a, /registration\.reserve\(/);
  assert.ok(a.indexOf('registration.reserve(') > -1 && a.indexOf('registration.reserve(') < a.indexOf('User.find({ $or'), 'sign-up budget (DB-backed) runs before any account lookup');
});

// ---------- CSP ----------
test('storefront CSP: no inline / eval script, no inline handlers, Razorpay allowed', () => {
  const c = storefrontCsp(), dir = (n) => (c.split('; ').find((d) => d.startsWith(n + ' ')) || '');
  assert.ok(!dir('script-src').includes('unsafe-inline') && !dir('script-src').includes('unsafe-eval'));
  assert.ok(!c.includes('cdn.tailwindcss.com'));
  assert.equal(dir('script-src-attr'), "script-src-attr 'none'"); assert.equal(dir('object-src'), "object-src 'none'"); assert.match(dir('base-uri'), /'self'/); assert.match(dir('frame-ancestors'), /'self'/);
  assert.match(dir('script-src'), /https:\/\/checkout\.razorpay\.com/); assert.match(dir('frame-src'), /api\.razorpay\.com/); assert.match(dir('connect-src'), /lumberjack\.razorpay\.com/);
});
test('storefront CSP middleware sets the header; STOREFRONT_CSP=relaxed leaves the global one', () => {
  const hdr = {}; const res = { setHeader: (k, v) => { hdr[k] = v; } };
  let nexted = 0; storefrontCspMiddleware({})({}, res, () => nexted++); assert.equal(hdr['Content-Security-Policy'], storefrontCsp()); assert.equal(nexted, 1);
  const h2 = {}; storefrontCspMiddleware({ STOREFRONT_CSP: 'relaxed' })({}, { setHeader: (k, v) => { h2[k] = v; } }, () => {}); assert.deepEqual(h2, {});
  assert.match(read('src/app.js'), /storefrontCspMiddleware\(\), require\('\.\/routes\/storefrontPages'\)/);
});
test('storefront views and script need no inline script or handler (static)', () => {
  const walk = (d) => fs.readdirSync(path.join(__dirname, '..', d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]));
  for (const f of walk('views/storefront')) {
    const s = read(f);
    for (const m of s.matchAll(/<script\b([^>]*)>/g)) assert.ok(/\bsrc=/.test(m[1]) || /type="application\/json"/.test(m[1]), `${f}: inline executable <script> found: ${m[0]}`);
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(s.replace(/<%[\s\S]*?%>/g, '')), `${f}: inline event handler attribute`);
  }
  assert.match(read('public/js/storefront.js'), /localStorage\.removeItem\(CART_KEY\)/, 'cart clearing moved into storefront.js');
});

// ---------- pure decisions ----------
const O = (o = {}) => ({ paymentMethod: 'razorpay', status: 'pending', paymentStatus: 'pending', refunds: [], createdAt: new Date(0), ...o });
test('decideAbandon: only old, unpaid, pending, refund-free online orders', () => {
  const now = 10 * 3600e3, age = 2 * 3600e3;
  assert.equal(decideAbandon(O(), now, age).action, 'cancel'); assert.equal(decideAbandon(O({ paymentStatus: 'failed' }), now, age).action, 'cancel');
  for (const bad of [{ paymentMethod: 'cod' }, { status: 'confirmed' }, { status: 'cancelled' }, { paymentStatus: 'paid' }, { paymentStatus: 'refunded' }, { refunds: [{}] }, { createdAt: new Date(now - 1000) }])
    assert.equal(decideAbandon(O(bad), now, age).action, 'skip', JSON.stringify(bad));
});
test('hasLivePayment: captured/authorized/unreadable => not abandoned', () => {
  assert.equal(hasLivePayment([]), false); assert.equal(hasLivePayment([{ status: 'failed' }, { status: 'created' }]), false);
  assert.equal(hasLivePayment([{ status: 'failed' }, { status: 'captured' }]), true); assert.equal(hasLivePayment([{ status: 'authorized' }]), true);
  assert.equal(hasLivePayment(null), true); assert.equal(hasLivePayment([{}]), true);
});
test('decideRefundSettlement', () => {
  const d = (o) => decideRefundSettlement(O({ paymentStatus: 'refunded', inventoryReleased: false, ...o })).action;
  assert.equal(d({ status: 'pending' }), 'cancel_and_release'); assert.equal(d({ status: 'confirmed' }), 'cancel_and_release');
  assert.equal(d({ status: 'cancelled' }), 'release'); assert.equal(d({ status: 'cancelled', inventoryReleased: true }), 'none');
  assert.equal(d({ status: 'shipped' }), 'none'); assert.equal(d({ status: 'delivered' }), 'none'); assert.equal(d({ paymentStatus: 'paid' }), 'none');
});

// ---------- services against fakes ----------
function fakeOrders(rows) {
  const matches = (d, f) => Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((x) => matches(d, x));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$in' in v) return v.$in.includes(d[k]); if ('$lt' in v) return d[k] < v.$lt; if ('$exists' in v) return (d[k] !== undefined) === v.$exists;
    }
    return v === null ? d[k] == null : d[k] === v;
  });
  const q = (arr) => { const p = Promise.resolve(arr); p.setOptions = () => p; p.sort = () => p; p.limit = (n) => { arr.splice(n); return p; }; return p; };
  return {
    rows, hooks: {},
    find: (f) => q(rows.filter((r) => matches(r, f))),
    findOne: async (f) => rows.find((r) => matches(r, f)) || null,
    updateOne: async (f, u) => { if (typeof this?.hooks === 'function') {} const r = rows.find((x) => matches(x, f)); if (!r) return { matchedCount: 0 }; Object.assign(r, u.$set || {}); if (u.$push) for (const [k, v] of Object.entries(u.$push)) (r[k] = r[k] || []).push(v); return { matchedCount: 1 }; },
  };
}
const mk = (o) => ({ _id: 'o' + Math.random(), store: 's1', paymentMethod: 'razorpay', status: 'pending', paymentStatus: 'pending', razorpayOrderId: 'order_X', paymentRev: 0, refunds: [], inventoryReleased: false, createdAt: new Date(0), ...o });
function deps(rows, over = {}) { const Order = fakeOrders(rows), released = []; return { Order, released, deps: { Order, now: () => 5 * 3600e3, gatewayEnabled: true, fetchPayments: async () => [{ status: 'failed' }], release: async (s, o) => { released.push(o._id); const r = rows.find((x) => x._id === o._id); if (r.inventoryReleased) return false; r.inventoryReleased = true; return true; }, ...over } }; }

test('cleanupAbandoned: cancels unpaid old online orders and releases stock once', async () => {
  const rows = [mk({ _id: 'a' }), mk({ _id: 'cod', paymentMethod: 'cod' }), mk({ _id: 'fresh', createdAt: new Date(5 * 3600e3 - 1000) })];
  const { deps: d, released } = deps(rows);
  const r = await cleanupAbandoned({ maxAgeMs: 2 * 3600e3, limit: 50 }, d);
  assert.equal(r.cancelled, 1); assert.deepEqual(released, ['a']); assert.equal(rows[0].status, 'cancelled'); assert.equal(rows[0].statusHistory.at(-1).status, 'cancelled');
  assert.equal(rows[1].status, 'pending'); assert.equal(rows[2].status, 'pending');
  const r2 = await cleanupAbandoned({ maxAgeMs: 2 * 3600e3, limit: 50 }, d); assert.equal(r2.cancelled, 0, 'second run changes nothing'); assert.deepEqual(released, ['a']);
});
test('cleanupAbandoned: a live payment at Razorpay, gateway errors, or gateway off => order untouched', async () => {
  for (const over of [{ fetchPayments: async () => [{ status: 'captured' }] }, { fetchPayments: async () => { throw Object.assign(new Error('x'), { kind: 'transient' }); } }, { gatewayEnabled: false }, { fetchPayments: async () => null }]) {
    const rows = [mk({ _id: 'a' })]; const { deps: d, released } = deps(rows, over);
    const r = await cleanupAbandoned({ maxAgeMs: 2 * 3600e3, limit: 50 }, d);
    assert.equal(r.cancelled, 0); assert.equal(rows[0].status, 'pending'); assert.equal(released.length, 0);
  }
});
test('cleanupAbandoned: stops the run when Razorpay rejects our keys', async () => {
  const rows = [mk({ _id: 'a' }), mk({ _id: 'b' })]; let calls = 0;
  const { deps: d } = deps(rows, { fetchPayments: async () => { calls++; throw Object.assign(new Error('auth'), { kind: 'auth' }); } });
  const r = await cleanupAbandoned({ maxAgeMs: 1, limit: 50 }, d); assert.equal(calls, 1); assert.equal(r.cancelled, 0);
});
test('cleanupAbandoned: a payment webhook that bumped paymentRev after our read wins (order not cancelled)', async () => {
  const rows = [mk({ _id: 'a', paymentRev: 0 })];
  const { deps: d, released } = deps(rows, { fetchPayments: async () => { rows[0].paymentRev = 1; rows[0].paymentStatus = 'paid'; return [{ status: 'failed' }]; } });
  const r = await cleanupAbandoned({ maxAgeMs: 2 * 3600e3, limit: 50 }, d);
  assert.equal(r.cancelled, 0); assert.equal(rows[0].status, 'pending'); assert.equal(released.length, 0);
});
test('settleFullRefund: pending/confirmed order is cancelled and stock released exactly once; shipped is left alone', async () => {
  for (const st of ['pending', 'confirmed']) {
    const rows = [mk({ _id: 'r', status: st, paymentStatus: 'refunded' })]; const { deps: d, released } = deps(rows);
    assert.equal((await settleFullRefund('s1', 'r', d)).outcome, 'cancel_and_release'); assert.equal(rows[0].status, 'cancelled'); assert.deepEqual(released, ['r']);
    assert.equal((await settleFullRefund('s1', 'r', d)).outcome, 'already_released'); assert.deepEqual(released, ['r'], 'no double release');
  }
  const rows = [mk({ _id: 'sh', status: 'shipped', paymentStatus: 'refunded' })]; const { deps: d, released } = deps(rows);
  assert.equal((await settleFullRefund('s1', 'sh', d)).outcome, 'goods_may_have_shipped'); assert.equal(rows[0].status, 'shipped'); assert.equal(released.length, 0);
  assert.equal((await settleFullRefund('s1', 'nope', d)).outcome, 'order_not_found'); assert.equal((await settleFullRefund('OTHER', 'sh', d)).outcome, 'order_not_found', 'store-scoped');
});
test('sweep repairs a refunded order whose stock was never returned', async () => {
  const rows = [mk({ _id: 'r', status: 'confirmed', paymentStatus: 'refunded' })]; const { deps: d, released } = deps(rows);
  const r = await cleanupAbandoned({ maxAgeMs: 2 * 3600e3, limit: 50 }, d); assert.equal(r.refundSettled, 1); assert.deepEqual(released, ['r']); assert.equal(rows[0].status, 'cancelled');
});
test('webhook path calls settleFullRefund only for a fully refunded write, and never lets it fail the payment write (static)', () => {
  const w = read('src/services/webhooks.js'); assert.match(w, /d\.set\.paymentStatus === 'refunded'/); assert.match(w, /postApply\(order\.store, order\._id\)\)\.catch/); assert.match(read('src/app.js'), /setPostApplyHook\(require\('\.\/services\/orderSettlement'\)\.settleFullRefund\)/);
  for (const f of ['src/services/orderSettlement.js', 'src/services/abandonedJob.js']) assert.ok(!/skipTenant/.test(read(f)) || f.endsWith('orderSettlement.js'));
  assert.match(read('server.js'), /abandonedJob/);
});

test('post-refund hook: runs after a full-refund write only, and a throwing hook never breaks the write', async () => {
  const row = { _id: 'o1', store: 's1', paymentRev: 0 };
  const FakeOrder = { updateOne: async (f, u) => { if (f._id !== row._id || f.store !== row.store) return { matchedCount: 0 }; Object.assign(row, u.$set); row.paymentRev += u.$inc.paymentRev; return { matchedCount: 1 }; } };
  const Module2 = require('module'), ol = Module2._load;
  Module2._load = function (req, ...a) { if (req === 'dotenv') return { config() {} }; if (req === 'mongoose') return {}; if (/\/models\/Order$/.test(req)) return FakeOrder; if (/\/models\/WebhookEvent$/.test(req)) return {}; return ol.call(this, req, ...a); };
  let W; try { W = require('../src/services/webhooks'); } finally { Module2._load = ol; }
  const calls = []; W.setPostApplyHook(async (store, id) => { calls.push([store, id]); });
  const lookup = async () => ({ ...row });
  const r1 = await W.applyToOrder(lookup, () => ({ action: 'apply', reason: 'partially_refunded', set: { refundedPaise: 100 } }));
  assert.equal(r1.outcome, 'applied:partially_refunded'); assert.equal(calls.length, 0, 'partial refund: no hook');
  const r2 = await W.applyToOrder(lookup, () => ({ action: 'apply', reason: 'fully_refunded', set: { paymentStatus: 'refunded' } }));
  assert.equal(r2.outcome, 'applied:fully_refunded'); assert.deepEqual(calls, [['s1', 'o1']]);
  const r3 = await W.applyToOrder(lookup, () => ({ action: 'noop', reason: 'refund_already_processed' }));
  assert.equal(r3.outcome, 'noop:refund_already_processed'); assert.equal(calls.length, 1, 'noop: no hook');
  W.setPostApplyHook(async () => { throw new Error('boom'); });
  const origErr = console.error; console.error = () => {};
  try { const r4 = await W.applyToOrder(lookup, () => ({ action: 'apply', reason: 'fully_refunded', set: { paymentStatus: 'refunded' } })); assert.equal(r4.outcome, 'applied:fully_refunded'); } finally { console.error = origErr; }
  W.setPostApplyHook(null);
});
