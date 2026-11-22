'use strict';
// Affiliate / referral program against a REAL MongoDB: link -> click -> sign-up -> verification -> paid plan -> commission -> payout.
// Needs MONGODB_URI pointing at a database whose name contains "test" (see test/helpers/harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.AFFILIATE_HOLD_DAYS = '0'; process.env.AFFILIATE_MIN_PAYOUT_RUPEES = '50'; process.env.AFFILIATE_MAX_PAYMENTS = '2';
const H = require('./helpers/harness');
if (!H.enabled) { H.skip(test, 'affiliate'); return; }
test.before(H.start); test.after(async () => {
  const mongoose = require('mongoose');
  for (const n of ['Affiliate', 'Referral', 'Commission', 'BillingPayment']) await mongoose.model(n).deleteMany(n === 'BillingPayment' ? { user: { $in: H.created.users } } : {}).setOptions({ skipTenant: true }).catch(() => {});
  await H.stop();
});

const Affiliate = () => require('../src/models/Affiliate'), Referral = () => require('../src/models/Referral'), Commission = () => require('../src/models/Commission');
const BillingPayment = () => require('../src/models/BillingPayment'), User = () => require('../src/models/User');
const events = () => require('../src/services/events'), billing = () => require('../src/services/billing');
let OWNER, AFF, CODE, BUYER;

// A verified, store-less user (affiliates do not need a store).
async function verifiedUser() {
  const { hashPassword } = require('../src/utils/password');
  const em = `af${H.rnd()}@example.com`, phone = '918' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await User().create({ name: 'Anita Kumar', email: em, phone, passwordHash: await hashPassword(H.PW), emailVerified: true, phoneVerified: true });
  H.created.users.push(user._id);
  const r = await fetch(H.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': H.fakeIp() }, body: JSON.stringify({ identifier: em, password: H.PW }) });
  assert.equal(r.status, 200);
  return { email: em, phone, user, jar: r.headers.getSetCookie()[0].split(';')[0] };
}

test('registration: needs login, validates, issues a code and link, is idempotent', async () => {
  assert.equal((await H.api(null, '/affiliate/me')).status, 401);
  assert.equal((await H.api(null, '/affiliate/program')).json.program.commissionPercent, 20);
  OWNER = await verifiedUser();
  assert.equal((await H.api(OWNER, '/affiliate/stats')).json.error.code, 'not_affiliate');
  const bad = await H.api(OWNER, '/affiliate/register', { method: 'POST', body: { upiId: 'nope' } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.acceptTerms && bad.json.error.fields.upiId);
  const r = await H.api(OWNER, '/affiliate/register', { method: 'POST', body: { acceptTerms: true, upiId: 'anita@okbank' } });
  assert.equal(r.status, 201); AFF = r.json.affiliate; CODE = AFF.code;
  assert.match(CODE, /^[A-Z2-9]{8}$/); assert.equal(AFF.link, `http://localhost:3000/r/${CODE}`);
  const again = await H.api(OWNER, '/affiliate/register', { method: 'POST', body: { acceptTerms: true } });
  assert.equal(again.status, 200); assert.equal(again.json.affiliate.code, CODE);
});

test('referral link: counts one click per visitor, sets the cookie, always redirects (unknown codes too); preview bots are ignored', async () => {
  const hit = (code, headers = {}) => fetch(H.base + '/r/' + code, { redirect: 'manual', headers: { 'x-forwarded-for': H.fakeIp(), ...headers } });
  const r1 = await hit(CODE);
  assert.equal(r1.status, 302); assert.match(r1.headers.get('location'), /#signup$/);
  const cookie = r1.headers.getSetCookie()[0]; assert.match(cookie, new RegExp(`sv_ref=${CODE}`)); assert.match(cookie, /HttpOnly/i);
  await hit(CODE, { cookie: cookie.split(';')[0] });                 // same visitor again: no new click
  await hit(CODE, { 'user-agent': 'WhatsApp/2.23 link preview' });    // link preview: no click, no cookie
  const unknown = await hit('NOSUCH99'); assert.equal(unknown.status, 302); assert.equal(unknown.headers.getSetCookie().length, 0);
  assert.equal((await hit('bad code!')).status, 302);
  assert.equal((await Affiliate().findOne({ code: CODE })).clicks, 1);
});

test('sign-up through the link: attribution happens once the account is verified, never for unknown codes', async () => {
  const signup = async (cookie, extra = {}) => {
    const email = `ref${H.rnd()}@example.com`, phone = '917' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const r = await H.api(null, '/auth/register', { method: 'POST', headers: cookie ? { cookie } : {}, body: { name: 'Ravi Shankar', email, phone, password: H.PW, ...extra } });
    assert.equal(r.status, 201);
    const u = await User().findOne({ email }); H.created.users.push(u._id); return u;
  };
  const viaCookie = await signup(`sv_ref=${CODE}`);
  assert.equal(viaCookie.referredByCode, CODE);
  assert.equal(await Referral().countDocuments({ referredUser: viaCookie._id }), 0);   // not verified yet: not a referral yet
  const viaField = await signup(null, { ref: CODE.toLowerCase() }); assert.equal(viaField.referredByCode, CODE);
  const junk = await signup('sv_ref=NOSUCH99', { ref: { $ne: 1 } }); assert.equal(junk.referredByCode, null);

  // Verification itself is covered by the auth suites; here we mark the channel verified and run the same attribution step that every verified login runs.
  await User().updateOne({ _id: viaCookie._id }, { emailVerified: true });
  await require('../src/services/affiliates').attributeSignup(await User().findById(viaCookie._id));
  const ref = await Referral().findOne({ referredUser: viaCookie._id });
  assert.ok(ref); assert.equal(ref.code, CODE); assert.equal(ref.status, 'signed_up');
  assert.equal((await User().findById(viaCookie._id)).referredByCode, null);
  BUYER = viaCookie;
});

test('a paid plan payment by the referred user earns exactly one commission, even if the event fires twice', async () => {
  const store = await require('../src/models/Store').create({ owner: BUYER._id, name: 'Ravi Store', slug: `it-${H.rnd()}${H.rnd()}`.slice(0, 20) }); H.created.stores.push(store._id);
  const row = await BillingPayment().create({ store: store._id, user: BUYER._id, plan: 'pro', cycle: 'monthly', amountPaise: 29900, razorpayOrderId: 'order_AF' + H.rnd() });
  const g = await billing().grant(row, { razorpayPaymentId: 'pay_AF' + H.rnd() }); assert.equal(g.granted, true);
  await events().drain();
  await events().emit('plan.activated', { storeId: store._id, paymentId: row._id });   // replay
  const list = await Commission().find({ billingPayment: row._id }); assert.equal(list.length, 1);
  assert.equal(list[0].amountPaise, 5980); assert.equal(list[0].status, 'pending');
  assert.equal((await Referral().findOne({ referredUser: BUYER._id })).status, 'converted');
  const second = await BillingPayment().create({ store: store._id, user: BUYER._id, plan: 'pro', cycle: 'monthly', amountPaise: 29900, razorpayOrderId: 'order_AF' + H.rnd() });
  await billing().grant(second, { razorpayPaymentId: 'pay_AF' + H.rnd() }); await events().drain();
  const third = await BillingPayment().create({ store: store._id, user: BUYER._id, plan: 'pro', cycle: 'monthly', amountPaise: 29900, razorpayOrderId: 'order_AF' + H.rnd() });
  await billing().grant(third, { razorpayPaymentId: 'pay_AF' + H.rnd() }); await events().drain();
  assert.equal(await Commission().countDocuments({ affiliate: AFF.id }), 2);          // AFFILIATE_MAX_PAYMENTS=2
  const dev = await BillingPayment().create({ store: store._id, user: BUYER._id, plan: 'pro', cycle: 'monthly', amountPaise: 0, source: 'dev' });
  await billing().grant(dev); await events().drain(); assert.equal(await Commission().countDocuments({ affiliate: AFF.id }), 2); // free / dev periods earn nothing
});

test('affiliate dashboard: funnel, earnings, masked referrals, no personal data of referred people', async () => {
  const r = await H.api(OWNER, '/affiliate/stats'); assert.equal(r.status, 200);
  assert.equal(r.json.funnel.clicks, 1); assert.ok(r.json.funnel.signups >= 1); assert.equal(r.json.funnel.customers, 1);
  assert.equal(r.json.earnings.payable, 119.6); assert.equal(r.json.earnings.paid, 0);   // hold days = 0 in this suite
  assert.equal(r.json.referrals[0].name, 'Ravi S.');
  assert.ok(!/@example\.com|\b91\d{10}\b/.test(r.text), 'no email or phone of referred people');
  assert.equal((await H.api(OWNER, '/affiliate/me', { method: 'PATCH', body: { upiId: 'bad' } })).status, 400);
});

test('admin: only admins; payout needs a reference, pays each commission once; void is blocked after payout', async () => {
  assert.equal((await H.api(OWNER, '/affiliate/admin/list')).status, 403);
  const adm = await verifiedUser(); await User().updateOne({ _id: adm.user._id }, { role: 'admin' });
  const list = await H.api(adm, '/affiliate/admin/list'); assert.equal(list.status, 200); assert.ok(list.json.affiliates.find((a) => a.code === CODE));
  assert.equal((await H.api(adm, `/affiliate/admin/${AFF.id}/payout`, { method: 'POST', body: {} })).status, 400);
  const [a, b] = await Commission().find({ affiliate: AFF.id }).sort({ createdAt: 1 });
  const v = await H.api(adm, `/affiliate/admin/commissions/${b._id}/void`, { method: 'POST', body: { reason: 'Refunded by support' } }); assert.equal(v.status, 200); assert.equal(v.json.commission.status, 'void');
  const [x, y] = await Promise.all([1, 2].map(() => H.api(adm, `/affiliate/admin/${AFF.id}/payout`, { method: 'POST', body: { reference: 'UTR123456' } })));
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);                                  // double click: one pays, the other finds nothing payable
  const ok = [x, y].find((r) => r.status === 200); assert.equal(ok.json.paid, 59.8); assert.equal(ok.json.commissions, 1);
  assert.equal((await Commission().findById(a._id)).status, 'paid');
  assert.equal((await H.api(adm, `/affiliate/admin/commissions/${a._id}/void`, { method: 'POST', body: { reason: 'too late' } })).status, 409);
  assert.equal((await H.api(adm, `/affiliate/admin/${AFF.id}/status`, { method: 'POST', body: { status: 'suspended' } })).json.affiliate.status, 'suspended');
  const hit = await fetch(H.base + '/r/' + CODE, { redirect: 'manual', headers: { 'x-forwarded-for': H.fakeIp() } });
  assert.equal(hit.headers.getSetCookie().length, 0);                                          // suspended: link no longer tracks
});
