'use strict';
// Affiliate / referral program: pure helpers + the service's money rules, against in-memory stand-ins for the models. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const A = require('../src/utils/affiliate');

// ---------- pure helpers ----------
test('codes: generated codes are unambiguous; user input is normalised and validated', () => {
  for (let i = 0; i < 200; i++) assert.match(A.generateCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(A.normalizeCode(' anita10 '), 'ANITA10');
  for (const bad of ['abc', 'a'.repeat(17), 'AB CD', 'AB-CD1', '<script>', null, undefined, 42, {}, ['ABCD'], 'x'.repeat(41)]) assert.equal(A.normalizeCode(bad), null, String(bad));
  assert.equal(A.codeProblem('storva'), 'That code is not available. Please choose another.');
  assert.ok(A.codeProblem('no!'));
  assert.equal(A.codeProblem('ANITA10'), null);
});

test('UPI ids: optional, validated, lower-cased', () => {
  assert.equal(A.normalizeUpi(''), ''); assert.equal(A.normalizeUpi(undefined), '');
  assert.equal(A.normalizeUpi(' Anita.K@OkHdfcBank '), 'anita.k@okhdfcbank');
  for (const bad of ['anita', 'a@', '@bank', 'a b@bank', 'x@y@z', 5, {}]) assert.equal(A.normalizeUpi(bad), null, String(bad));
});

test('commission maths: integer paise, rounded down, never negative', () => {
  assert.equal(A.commissionFor(29900, 2000), 5980);
  assert.equal(A.commissionFor(23900 * 12, 2000), 57360);
  assert.equal(A.commissionFor(333, 2000), 66);          // 66.6 -> 66
  assert.equal(A.commissionFor(1, 2000), 0);
  for (const [a, r] of [[0, 2000], [-5, 2000], [100, 0], [100, -1], [NaN, 2000], ['x', 2000]]) assert.equal(A.commissionFor(a, r), 0);
});

test('masking: an affiliate never sees a referred person\'s full name', () => {
  assert.equal(A.maskName('Anita Kumar'), 'Anita K.'); assert.equal(A.maskName('Anita Devi Kumar'), 'Anita K.');
  assert.equal(A.maskName('Madonna'), 'Madonna'); assert.equal(A.maskName(''), 'Customer'); assert.equal(A.maskName(null), 'Customer');
});

test('program settings: defaults, overrides and clamping', () => {
  const d = A.readProgram({});
  assert.deepEqual(d, { enabled: true, commissionBps: 2000, maxPayments: 12, holdDays: 30, minPayoutPaise: 50000, cookieDays: 30 });
  const o = A.readProgram({ AFFILIATE_COMMISSION_PERCENT: '10.5', AFFILIATE_MAX_PAYMENTS: '1', AFFILIATE_HOLD_DAYS: '0', AFFILIATE_MIN_PAYOUT_RUPEES: '100', AFFILIATE_ENABLED: 'false' });
  assert.deepEqual(o, { enabled: false, commissionBps: 1050, maxPayments: 1, holdDays: 0, minPayoutPaise: 10000, cookieDays: 30 });
  const c = A.readProgram({ AFFILIATE_COMMISSION_PERCENT: '500', AFFILIATE_HOLD_DAYS: '9999', AFFILIATE_MAX_PAYMENTS: '0', AFFILIATE_COOKIE_DAYS: 'abc' });
  assert.equal(c.commissionBps, 9000); assert.equal(c.holdDays, 180); assert.equal(c.maxPayments, 1); assert.equal(c.cookieDays, 30);
});

// ---------- service rules with in-memory models ----------
let seq = 0; const oid = () => { const n = ++seq; return { _n: n, toString: () => 'id' + n }; };
const sid = (v) => String(v && v._id !== undefined ? v._id : v);
function matches(doc, q) {
  return Object.entries(q).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !cond._n) {
      if ('$lt' in cond) return v < cond.$lt;
      if ('$lte' in cond) return v <= cond.$lte;
    }
    return sid(v) === sid(cond);
  });
}
function fakeModel(name, uniques = [], defaults = {}) {
  const rows = [];
  const M = class {
    constructor(d) { Object.assign(this, d); }
    async save() { return this; }
    toApi() { return { ...this }; }
  };
  M.rows = rows; M.modelName = name;
  M.create = async (d) => {
    for (const u of uniques) if (rows.some((r) => sid(r[u]) === sid(d[u]))) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
    const doc = new M({ _id: oid(), paidPayments: 0, ...defaults, ...d }); rows.push(doc); return doc;
  };
  M.findOne = async (q) => rows.find((r) => matches(r, q)) || null;
  M.findById = async (id) => rows.find((r) => sid(r._id) === sid(id)) || null;
  M.exists = async (q) => (rows.some((r) => matches(r, q)) ? { _id: 1 } : null);
  M.updateOne = async (q, u) => { const r = rows.find((x) => matches(x, q)); if (!r) return { matchedCount: 0, modifiedCount: 0 }; if (u.$set) Object.assign(r, u.$set); if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) r[k] = (r[k] || 0) + v; return { matchedCount: 1, modifiedCount: 1 }; };
  M.findOneAndUpdate = async (q, u) => { const r = rows.find((x) => matches(x, q)); if (!r) return null; await M.updateOne({ _id: r._id }, u); return r; };
  return M;
}
const fakes = { Affiliate: fakeModel('Affiliate', ['user', 'code'], { status: 'active', commissionBps: null, clicks: 0 }), Referral: fakeModel('Referral', ['referredUser'], { status: 'signed_up' }), Commission: fakeModel('Commission', ['billingPayment'], { status: 'pending' }), User: fakeModel('User'), BillingPayment: fakeModel('BillingPayment') };
const root = path.join(__dirname, '..', 'src');
for (const [n, M] of Object.entries(fakes)) require.cache[require.resolve(path.join(root, 'models', n + '.js'))] = { id: n, filename: n, loaded: true, exports: M };
const events = require('../src/services/events');
const S = require('../src/services/affiliates');

const reset = () => Object.values(fakes).forEach((M) => { M.rows.length = 0; });
const mkUser = (o = {}) => ({ _id: oid(), name: 'Ravi Shankar', emailVerified: true, phoneVerified: false, referredByCode: null, ...o });
const NOW = new Date('2026-11-18T10:00:00Z');
const pay = (user, o = {}) => ({ _id: oid(), user: user._id, store: oid(), status: 'paid', source: 'razorpay', plan: 'pro', cycle: 'monthly', amountPaise: 29900, ...o });
async function setup() {
  reset();
  const owner = mkUser({ name: 'Anita Kumar' });
  const { affiliate } = await S.joinProgram(owner, { acceptTerms: true, upiId: 'anita@okbank' });
  const buyer = mkUser({ referredByCode: affiliate.code });
  fakes.User.rows.push(buyer);
  const referral = await S.attributeSignup(buyer);
  return { owner, affiliate, buyer, referral };
}

test('joining: needs verified account + accepted terms; custom codes are unique; joining twice returns the same row', async () => {
  reset();
  await assert.rejects(S.joinProgram(mkUser({ emailVerified: false }), { acceptTerms: true }), { code: 'not_verified' });
  await assert.rejects(S.joinProgram(mkUser(), {}), (e) => e.code === 'validation_error' && Boolean(e.fields.acceptTerms));
  await assert.rejects(S.joinProgram(mkUser(), { acceptTerms: true, upiId: 'nope' }), (e) => Boolean(e.fields.upiId));
  await assert.rejects(S.joinProgram(mkUser(), { acceptTerms: true, code: 'ADMIN' }), (e) => Boolean(e.fields.code));
  const u1 = mkUser(), u2 = mkUser();
  const a = await S.joinProgram(u1, { acceptTerms: true, code: 'anita10' });
  assert.equal(a.created, true); assert.equal(a.affiliate.code, 'ANITA10');
  const again = await S.joinProgram(u1, { acceptTerms: true }); assert.equal(again.created, false); assert.equal(again.affiliate.code, 'ANITA10');
  await assert.rejects(S.joinProgram(u2, { acceptTerms: true, code: 'ANITA10' }), (e) => /taken/.test(e.fields.code));
  const auto = await S.joinProgram(u2, { acceptTerms: true }); assert.match(auto.affiliate.code, /^[A-Z2-9]{8}$/);
});

test('attribution: a valid code becomes one Referral; the code on the user is consumed; unknown / suspended / own codes attribute nothing', async () => {
  const { affiliate, buyer, referral } = await setup();
  assert.equal(String(referral.affiliate), String(affiliate._id)); assert.equal(referral.code, affiliate.code); assert.equal(buyer.referredByCode, null);
  assert.equal(await S.attributeSignup(buyer), null); // nothing left to do
  buyer.referredByCode = 'OTHER123'; assert.equal(String((await S.attributeSignup(buyer))._id), String(referral._id)); // already attributed: the existing referral stands
  const stranger = mkUser({ referredByCode: 'NOSUCH99' }); assert.equal(await S.attributeSignup(stranger), null); assert.equal(stranger.referredByCode, null);
  affiliate.status = 'suspended'; const late = mkUser({ referredByCode: affiliate.code }); assert.equal(await S.attributeSignup(late), null);
  affiliate.status = 'active';
  const self = mkUser({ _id: affiliate.user, referredByCode: affiliate.code }); assert.equal(await S.attributeSignup(self), null);
  assert.equal(fakes.Referral.rows.length, 1);
});

test('first confirmed attribution wins: a second code cannot steal a referred person', async () => {
  const { buyer, referral } = await setup();
  const rival = (await S.joinProgram(mkUser(), { acceptTerms: true })).affiliate;
  buyer.referredByCode = rival.code;
  const r2 = await S.attributeSignup(buyer);
  assert.equal(String(r2._id), String(referral._id)); assert.equal(fakes.Referral.rows.length, 1);
});

test('commission: 20% of the paid amount, held 30 days, referral marked converted; crediting the same payment twice pays once', async () => {
  const { affiliate, buyer, referral } = await setup();
  const p = pay(buyer);
  const r = await S.creditPayment(p, { now: NOW });
  assert.equal(r.credited, true); assert.equal(r.commission.amountPaise, 5980); assert.equal(r.commission.basePaise, 29900); assert.equal(r.commission.rateBps, 2000);
  assert.equal(r.commission.availableAt.toISOString(), '2026-12-18T10:00:00.000Z'); assert.equal(r.commission.status, 'pending');
  assert.equal(referral.status, 'converted'); assert.equal(referral.paidPayments, 1);
  const dup = await S.creditPayment(p, { now: NOW });
  assert.deepEqual([dup.credited, dup.reason], [false, 'already_credited']); assert.equal(fakes.Commission.rows.length, 1); assert.equal(referral.paidPayments, 1);
  assert.equal(String(r.commission.affiliate), String(affiliate._id));
});

test('commission is skipped for: dev/admin/free (amount 0) periods, unpaid rows, non-referred buyers, suspended affiliates, self-purchase', async () => {
  const { affiliate, buyer, owner } = await setup();
  assert.equal((await S.creditPayment(pay(buyer, { source: 'dev', amountPaise: 0 }))).reason, 'not_eligible');
  assert.equal((await S.creditPayment(pay(buyer, { source: 'admin' }))).reason, 'not_eligible');
  assert.equal((await S.creditPayment(pay(buyer, { status: 'created' }))).reason, 'not_eligible');
  assert.equal((await S.creditPayment(pay(mkUser()))).reason, 'no_referral');
  affiliate.status = 'suspended'; assert.equal((await S.creditPayment(pay(buyer))).reason, 'affiliate_inactive'); affiliate.status = 'active';
  assert.equal((await S.creditPayment(pay(owner))).reason, 'no_referral'); // the affiliate's own purchases never earn
  assert.equal(fakes.Commission.rows.length, 0);
});

test('payment cap: only AFFILIATE_MAX_PAYMENTS payments per referred customer earn; a failed credit gives the slot back', async () => {
  const keep = process.env.AFFILIATE_MAX_PAYMENTS; process.env.AFFILIATE_MAX_PAYMENTS = '2';
  try {
    const { buyer, referral } = await setup();
    assert.equal((await S.creditPayment(pay(buyer))).credited, true);
    assert.equal((await S.creditPayment(pay(buyer))).credited, true);
    assert.equal((await S.creditPayment(pay(buyer))).reason, 'limit_reached');
    assert.equal(referral.paidPayments, 2); assert.equal(fakes.Commission.rows.length, 2);
    // slot is returned when the commission row cannot be written
    process.env.AFFILIATE_MAX_PAYMENTS = '5'; const boom = fakes.Commission.create; fakes.Commission.create = async () => { throw new Error('db down'); };
    await assert.rejects(S.creditPayment(pay(buyer)), /db down/); assert.equal(referral.paidPayments, 2); fakes.Commission.create = boom;
  } finally { if (keep === undefined) delete process.env.AFFILIATE_MAX_PAYMENTS; else process.env.AFFILIATE_MAX_PAYMENTS = keep; }
});

test('per-affiliate rate override beats the program default; closed program earns nothing', async () => {
  const { affiliate, buyer } = await setup();
  affiliate.commissionBps = 3000;
  assert.equal((await S.creditPayment(pay(buyer), { now: NOW })).commission.amountPaise, 8970);
  process.env.AFFILIATE_ENABLED = 'false';
  try { assert.equal((await S.creditPayment(pay(buyer))).reason, 'not_eligible'); assert.equal(await S.activeCode(affiliate.code), null); assert.equal(await S.trackClick(affiliate.code), false); }
  finally { delete process.env.AFFILIATE_ENABLED; }
});

test('sign-up code lookup: body field or cookie, only for active affiliates, never throws on junk', async () => {
  const { affiliate } = await setup();
  assert.equal(await S.codeFromRequest({ body: { ref: affiliate.code.toLowerCase() }, cookies: {} }), affiliate.code);
  assert.equal(await S.codeFromRequest({ body: {}, cookies: { [S.COOKIE]: affiliate.code } }), affiliate.code);
  assert.equal(await S.codeFromRequest({ body: { ref: 'NOSUCH99' }, cookies: { [S.COOKIE]: affiliate.code } }), affiliate.code); // bad field falls back to the cookie
  for (const junk of [{ body: { ref: { $ne: 1 } }, cookies: {} }, { body: null, cookies: null }, {}, { body: { ref: ['A'] } }]) assert.equal(await S.codeFromRequest(junk), null);
  affiliate.status = 'suspended'; assert.equal(await S.codeFromRequest({ body: { ref: affiliate.code } }), null);
});

test('plan.activated listener credits through the event bus (and ignores events without a payment id)', async () => {
  const { buyer } = await setup();
  fakes.BillingPayment.rows.length = 0; const p = pay(buyer); fakes.BillingPayment.rows.push(p);
  fakes.BillingPayment.findOne = (q) => { const r = fakes.BillingPayment.rows.find((x) => sid(x._id) === sid(q._id)) || null; const query = { setOptions: () => query, then: (ok, bad) => Promise.resolve(r).then(ok, bad) }; return query; }; // mimics a mongoose Query
  events.reset(); S.register(); // idempotent registration
  await events.emit('plan.activated', { storeId: p.store });                   // no paymentId: ignored
  assert.equal(fakes.Commission.rows.length, 0);
  await events.emit('plan.activated', { storeId: p.store, paymentId: p._id });
  assert.equal(fakes.Commission.rows.length, 1);
});
