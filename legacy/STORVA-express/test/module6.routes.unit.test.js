'use strict';
// Module 6 step 4: the REAL src/routes/payments.js loaded with a FAKE express Router (express is not installed in the sandbox) and fake services/models.
// Proves route wiring (method + path + ORDER of registration), which routes carry a rate limiter, that every handler passes the OWNER'S store (req.store) and
// the logged-in user to the services (never an id from the URL/body), status codes (201 new refund / 200 replay), response shapes, filter whitelisting and
// that errors are forwarded to next() instead of thrown. Real HTTP + real MongoDB behaviour is covered by the integration suites (NOT run in the sandbox).
// NOTE: re-created in the final step-4 pass (the first scratch copy of this file was lost when the sandbox was reset); it is NOT the original.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const routes = []; const limiters = []; const cascades = [];
const fakeExpress = () => {};
fakeExpress.Router = () => { const r = {}; for (const m of ['get', 'post']) r[m] = (path, ...h) => { routes.push({ method: m.toUpperCase(), path, handlers: h }); return r; }; return r; };
const calls = { orderFind: [], orderCount: [], agg: [], refunds: [], reconcile: [], issues: [] };
const mk = (n) => ({ _id: 'o' + n, orderNumber: n, status: 'confirmed', customer: { name: 'A', phone: '1' }, paymentMethod: 'razorpay', paymentStatus: 'paid', totalPaise: 50000, refunds: [], refundedPaise: 0, razorpayPaymentId: 'pay_Abc123456789' });
const rows = [mk(1001), mk(1002)];
const FakeOrder = {
  aggregate(p) { calls.agg.push(p); return Promise.resolve([]); },
  countDocuments(w) { calls.orderCount.push(w); return Promise.resolve(45); },
  find(w) { calls.orderFind.push({ where: w }); const q = { sort(s) { calls.orderFind.at(-1).sort = s; return q; }, skip(n) { calls.orderFind.at(-1).skip = n; return q; }, limit(n) { calls.orderFind.at(-1).limit = n; return q; }, then(a, b) { return Promise.resolve(rows).then(a, b); } }; return q; },
};
const fakeRefunds = {
  loadOrder: async (store, n) => { calls.refunds.push(['load', store, n]); return mk(Number(n)); },
  initiateRefund: async (store, user, n, input) => { calls.refunds.push(['initiate', store, user, n, input]); return fakeRefunds.next; },
  retryRefund: async (store, n, key) => { calls.refunds.push(['retry', store, n, key]); return { retried: true }; },
};
const fakeReconciliation = {
  listIssues: async (store) => { calls.issues.push(['list', store]); return [{ id: 'i1' }]; },
  dismissIssue: async (store, user, id) => { calls.issues.push(['dismiss', store, user, id]); return { dismissed: true }; },
  reconcileOne: async (store, n) => { calls.reconcile.push([store, n]); return fakeReconciliation.next; },
};
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'express') return fakeExpress;
  if (req.endsWith('/models/Order')) return FakeOrder;
  if (req.endsWith('/models/ReconciliationIssue')) return { deleteMany: async (f) => { cascades.push(f); } };
  if (req.endsWith('/services/refunds')) return fakeRefunds;
  if (req.endsWith('/services/reconciliation')) return fakeReconciliation;
  if (req.endsWith('/middleware/rateLimit')) return { strictLimiter: (windowMs, limit, message) => { const mw = (req2, res, next) => next(); mw.meta = { windowMs, limit, message }; limiters.push(mw); return mw; } };
  if (req.endsWith('/middleware/tenant')) return { registerCascade: (fn) => { cascades.push(fn); } };
  if (req === 'dotenv') { try { return origLoad.call(this, req, ...a); } catch { return { config() {} }; } }
  return origLoad.call(this, req, ...a);
};
const registeredCascadeCount = () => cascades.filter((c) => typeof c === 'function').length;
require('../src/routes/payments');
Module._load = origLoad;
const cascadeFn = cascades.find((c) => typeof c === 'function');

const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `route ${method} ${path} is not registered`); return r; };
const store = { _id: 'S1', slug: 'shop' }, user = { _id: 'U1' };
// run a route's handler chain like express would; resolves with { status, json, err }
function run(method, path, { params = {}, query = {}, body, store: st = store, usr = user } = {}) {
  const r = find(method, path);
  return new Promise((resolve) => {
    const out = { status: 200, json: undefined, err: undefined, done: false }, fin = () => { if (!out.done) { out.done = true; resolve(out); } };
    const res = { status(c) { out.status = c; return res; }, json(j) { out.json = j; fin(); return res; } };
    const req = { params, query, body, store: st, user: usr };
    let i = 0; const next = (e) => { if (e) { out.err = e; return fin(); } const h = r.handlers[i++]; if (!h) return fin(); h(req, res, next); };
    next();
    setTimeout(fin, 500);
  });
}
const clear = () => { for (const k of Object.keys(calls)) calls[k].length = 0; };

test('route table: exactly these routes exist, and static paths are registered BEFORE "/:orderNumber" (otherwise "issues" would be read as an order number)', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), [
    'GET /summary', 'GET /transactions', 'GET /issues', 'POST /issues/:issueId/dismiss', 'GET /:orderNumber', 'POST /:orderNumber/refunds', 'POST /:orderNumber/reconcile', 'POST /:orderNumber/refunds/:key/retry',
  ]);
  const idx = (m, p) => routes.findIndex((r) => r.method === m && r.path === p);
  for (const p of ['/summary', '/transactions', '/issues']) assert.ok(idx('GET', p) < idx('GET', '/:orderNumber'), p + ' must come before /:orderNumber');
});
test('the state-changing routes carry a rate limiter; read-only routes do not need one; limits are configurable and sane', () => {
  const limited = (m, p) => find(m, p).handlers.length === 2 && typeof find(m, p).handlers[0] === 'function' && limiters.includes(find(m, p).handlers[0]);
  assert.ok(limited('POST', '/:orderNumber/refunds'), 'refund create'); assert.ok(limited('POST', '/:orderNumber/refunds/:key/retry'), 'refund retry'); assert.ok(limited('POST', '/:orderNumber/reconcile'), 'check with Razorpay');
  for (const [m, p] of [['GET', '/summary'], ['GET', '/transactions'], ['GET', '/issues'], ['GET', '/:orderNumber']]) assert.equal(find(m, p).handlers.length, 1, `${m} ${p}`);
  assert.equal(limiters.length, 2, 'one limiter for refunds, one for reconcile'); for (const l of limiters) { assert.equal(l.meta.windowMs, 60000); assert.equal(l.meta.limit, 20); assert.ok(l.meta.message.length > 5); }
  assert.equal(find('POST', '/:orderNumber/refunds').handlers[0], find('POST', '/:orderNumber/refunds/:key/retry').handlers[0], 'refund create and retry share one budget');
  assert.notEqual(find('POST', '/:orderNumber/reconcile').handlers[0], find('POST', '/:orderNumber/refunds').handlers[0]);
});
test('deleting a store deletes its reconciliation issues (cascade registered, filtered by that store)', async () => {
  assert.equal(registeredCascadeCount(), 1); cascades.length = 0; await cascadeFn('S9'); assert.deepEqual(cascades, [{ store: 'S9' }]);
});

// ---------- refunds ----------
test('POST refunds: the OWNER store and user come from req (never from URL/body); 201 for a new refund, 200 for a replay; body is passed through the service only', async () => {
  clear(); fakeRefunds.next = { replayed: false, refund: { id: 1 }, payment: {} };
  let o = await run('POST', '/:orderNumber/refunds', { params: { orderNumber: '1001', storeId: 'ATTACKER' }, body: { type: 'full', idempotencyKey: 'k'.repeat(20), store: 'ATTACKER', _id: 'x' } });
  assert.equal(o.status, 201); assert.deepEqual(o.json, fakeRefunds.next); const c = calls.refunds[0]; assert.equal(c[0], 'initiate'); assert.equal(c[1], store); assert.equal(c[2], user); assert.equal(c[3], '1001');
  fakeRefunds.next = { replayed: true, refund: { id: 1 }, payment: {} }; o = await run('POST', '/:orderNumber/refunds', { params: { orderNumber: '1001' }, body: { type: 'full', idempotencyKey: 'k'.repeat(20) } }); assert.equal(o.status, 200);
});
test('POST refunds: a body that is missing, an array or a string reaches the service as an empty object (no crash, no prototype tricks)', async () => {
  for (const b of [undefined, null, [], ['x'], 'text', 5]) { clear(); fakeRefunds.next = { replayed: false }; await run('POST', '/:orderNumber/refunds', { params: { orderNumber: '1001' }, body: b }); assert.deepEqual(calls.refunds[0][4], {}, 'body ' + JSON.stringify(b)); }
});
test('POST refunds: service errors go to next(err) with status/code intact (the error middleware formats them); nothing is thrown', async () => {
  clear(); const AppError = require('../src/utils/AppError'); const orig = fakeRefunds.initiateRefund;
  fakeRefunds.initiateRefund = async () => { throw new AppError('A refund is already in progress', 409, 'refund_in_progress'); };
  try { const o = await run('POST', '/:orderNumber/refunds', { params: { orderNumber: '1001' }, body: {} }); assert.equal(o.json, undefined); assert.equal(o.err.status, 409); assert.equal(o.err.code, 'refund_in_progress'); } finally { fakeRefunds.initiateRefund = orig; }
});
test('POST refunds/:key/retry passes store, order number and key from the URL to the service and returns its answer with 200', async () => {
  clear(); const o = await run('POST', '/:orderNumber/refunds/:key/retry', { params: { orderNumber: '1002', key: 'abcdefghijklmnop' } });
  assert.equal(o.status, 200); assert.deepEqual(o.json, { retried: true }); assert.deepEqual(calls.refunds[0], ['retry', store, '1002', 'abcdefghijklmnop']);
});

// ---------- reconcile + issues ----------
test('POST reconcile: answers only {changed, issues, nothingToCheck, payment}; the raw order/internal fields never leak', async () => {
  clear(); fakeReconciliation.next = { changed: true, issues: [{ code: 'x' }], nothingToCheck: false, order: { ...mk(1001), razorpayOrderId: 'order_Abc', reconcileCheckedAt: new Date(), paymentRev: 7 }, internal: 'SECRET' };
  const o = await run('POST', '/:orderNumber/reconcile', { params: { orderNumber: '1001' } });
  assert.equal(o.status, 200); assert.deepEqual(Object.keys(o.json).sort(), ['changed', 'issues', 'nothingToCheck', 'payment']); assert.equal(o.json.changed, true); assert.equal(o.json.payment.orderNumber, 1001);
  assert.ok(!JSON.stringify(o.json).includes('SECRET')); assert.ok(!('paymentRev' in o.json.payment), 'revision counter is not exposed'); assert.deepEqual(calls.reconcile[0], [store, '1001']);
});
test('POST reconcile: gateway trouble (503) is forwarded as an error and produces no payment body', async () => {
  const AppError = require('../src/utils/AppError'); const orig = fakeReconciliation.reconcileOne; fakeReconciliation.reconcileOne = async () => { throw new AppError('x', 503, 'gateway_unreachable'); };
  try { const o = await run('POST', '/:orderNumber/reconcile', { params: { orderNumber: '1001' } }); assert.equal(o.err.status, 503); assert.equal(o.json, undefined); } finally { fakeReconciliation.reconcileOne = orig; }
});
test('GET issues / POST dismiss use the owner store; dismiss also gets the user and the id from the URL', async () => {
  clear(); let o = await run('GET', '/issues'); assert.deepEqual(o.json, { issues: [{ id: 'i1' }] }); assert.equal(calls.issues[0][1], store);
  o = await run('POST', '/issues/:issueId/dismiss', { params: { issueId: 'abc' } }); assert.deepEqual(o.json, { dismissed: true }); assert.deepEqual(calls.issues[1], ['dismiss', store, user, 'abc']);
});

// ---------- read routes ----------
test('GET /:orderNumber loads through the store-scoped service and returns payment detail', async () => {
  clear(); const o = await run('GET', '/:orderNumber', { params: { orderNumber: '1001' } });
  assert.deepEqual(calls.refunds[0], ['load', store, '1001']); assert.equal(o.json.payment.orderNumber, 1001); assert.ok(Array.isArray(o.json.payment.refunds), 'detail view includes the refund list');
});
test('GET /transactions: always filtered to the owner store; method and status are WHITELISTED; unknown values fall back to online/unfiltered', async () => {
  clear(); await run('GET', '/transactions', { query: { method: '$ne', status: 'constructor' } });
  let w = calls.orderFind[0].where; assert.equal(w.store, 'S1'); assert.equal(w.paymentMethod, 'razorpay'); assert.equal(w.paymentStatus, undefined); assert.equal(w.refunds, undefined);
  clear(); await run('GET', '/transactions', { query: { method: 'cod', status: 'refund_pending' } }); w = calls.orderFind[0].where; assert.equal(w.paymentMethod, 'cod'); assert.equal(w.paymentStatus, 'paid'); assert.deepEqual(w.refunds, { $elemMatch: { status: { $in: ['pending', 'created'] } } });
  clear(); await run('GET', '/transactions', { query: { status: { $gt: '' }, method: ['cod'] } }); w = calls.orderFind[0].where; assert.equal(w.paymentMethod, 'razorpay'); assert.equal(w.paymentStatus, undefined);
});
test('GET /transactions: pagination is clamped (limit 1..100, page >= 1), the count query uses the SAME where, newest first', async () => {
  clear(); let o = await run('GET', '/transactions', { query: { limit: '100000', page: '-4' } }); let f = calls.orderFind[0];
  assert.equal(f.limit, 100); assert.equal(f.skip, 0); assert.deepEqual(f.sort, { createdAt: -1 }); assert.equal(calls.orderCount[0], f.where, 'count and list share one filter'); assert.equal(o.json.total, 45); assert.equal(o.json.pages, 1);
  clear(); o = await run('GET', '/transactions', { query: { limit: '20', page: '3' } }); f = calls.orderFind[0]; assert.equal(f.skip, 40); assert.equal(o.json.pages, 3); assert.equal(o.json.page, 3);
  clear(); await run('GET', '/transactions', { query: { limit: '0', page: 'abc' } }); f = calls.orderFind[0]; assert.equal(f.limit, 20); assert.equal(f.skip, 0);
});
test('GET /transactions: search text is escaped (regex injection), cut to 60 chars, and only digit strings or pay_ ids become exact matches', async () => {
  clear(); await run('GET', '/transactions', { query: { q: '.*(a+)+$' } }); let w = calls.orderFind[0].where; assert.equal(w.$or.length, 2); assert.ok(w.$or[0]['customer.name'] instanceof RegExp);
  assert.ok(!w.$or[0]['customer.name'].test('zzz'), 'the pattern was escaped, so ".*" is not a wildcard'); assert.ok(w.$or[0]['customer.name'].test('x.*(a+)+$x'));
  clear(); await run('GET', '/transactions', { query: { q: '1042' } }); w = calls.orderFind[0].where; assert.ok(w.$or.some((c) => c.orderNumber === 1042));
  clear(); await run('GET', '/transactions', { query: { q: 'pay_Abc123456789' } }); w = calls.orderFind[0].where; assert.ok(w.$or.some((c) => c.razorpayPaymentId === 'pay_Abc123456789'));
  clear(); await run('GET', '/transactions', { query: { q: { $ne: 1 } } }); w = calls.orderFind[0].where; assert.equal(w.$or, undefined, 'an object is never turned into a filter');
  clear(); await run('GET', '/transactions', { query: { q: 'x'.repeat(500) } }); w = calls.orderFind[0].where; assert.ok(w.$or[0]['customer.name'].source.length <= 60);
  clear(); await run('GET', '/transactions', { query: { q: '   ' } }); assert.equal(calls.orderFind[0].where.$or, undefined);
});
test('GET /summary: every aggregation starts with $match on the owner store', async () => {
  clear(); const o = await run('GET', '/summary'); assert.equal(calls.agg.length, 3); for (const p of calls.agg) assert.equal(p[0].$match.store, 'S1', 'aggregate without a store filter');
  assert.ok(o.json.summary && o.json.summary.successful && o.json.summary.refundsInProgress && o.json.summary.cod);
});
test('GET /summary with no orders returns zeros (no NaN, no missing keys)', async () => {
  clear(); const { summary } = (await run('GET', '/summary')).json;
  assert.deepEqual(summary.successful, { count: 0, amount: 0 }); assert.deepEqual(summary.refundsInProgress, { count: 0, amount: 0 }); assert.equal(summary.netCollected, 0); assert.deepEqual(summary.refunded, { amount: 0, fullyRefundedOrders: 0 });
});
test('every handler is wrapped so a rejected promise reaches next(err), never an unhandled rejection', async () => {
  const orig = FakeOrder.aggregate; FakeOrder.aggregate = () => Promise.reject(new Error('db down'));
  try { const o = await run('GET', '/summary'); assert.equal(o.err.message, 'db down'); assert.equal(o.json, undefined); } finally { FakeOrder.aggregate = orig; }
});
