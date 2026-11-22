'use strict';
// Affiliate / referral program (platform level: affiliates promote STORVA and earn on the plan payments of the people they bring).
//
//   Link          /r/CODE  (routes/referralLink.js)  -> counts a click, sets a 30-day cookie, sends the visitor to the sign-up screen
//   Registration  POST /api/affiliate/register       -> any verified account becomes an affiliate and gets a code
//   Tracking      sign-up stores the code on the User; the first verified login turns it into a Referral (one affiliate per person, ever)
//   Earning       'plan.activated' (a paid, verified plan payment) -> one Commission per BillingPayment, exactly once
//   Paying        pending -> (hold period) payable -> paid when a platform admin records a payout; admins can void
//
// Money rules: integer paise; the base is what the customer paid; free / dev / admin-granted periods (amount 0) earn nothing; a person
// cannot refer themselves; each referred customer earns commission for at most AFFILIATE_MAX_PAYMENTS payments.
const Affiliate = require('../models/Affiliate');
const Referral = require('../models/Referral');
const Commission = require('../models/Commission');
const User = require('../models/User');
const BillingPayment = require('../models/BillingPayment');
const AppError = require('../utils/AppError');
const events = require('./events');
const A = require('../utils/affiliate');

const DAY = 864e5;
const COOKIE = 'sv_ref';
const program = () => A.readProgram();
const isDup = (e) => e && (e.code === 11000 || /E11000/.test(String(e.message)));

// ---- public program facts (shown on the affiliate page) --------------------------------------------
function programInfo() {
  const p = program();
  return { enabled: p.enabled, commissionPercent: p.commissionBps / 100, maxPayments: p.maxPayments, holdDays: p.holdDays, minPayout: p.minPayoutPaise / 100, cookieDays: p.cookieDays };
}

// ---- link tracking ---------------------------------------------------------------------------------
// Returns the canonical code when it belongs to an ACTIVE affiliate, else null. Never throws (used on public paths).
async function activeCode(raw) {
  const code = A.normalizeCode(raw);
  if (!code || !program().enabled) return null;
  try { return (await Affiliate.exists({ code, status: 'active' })) ? code : null; } catch { return null; }
}

// Counts one click (the caller already de-duplicates per visitor with the cookie). True when the code is live.
async function trackClick(raw) {
  const code = A.normalizeCode(raw);
  if (!code || !program().enabled) return false;
  const r = await Affiliate.updateOne({ code, status: 'active' }, { $inc: { clicks: 1 } });
  return r.matchedCount > 0;
}

// Sign-up: the code comes from the explicit field (e.g. ?ref= typed into the form) or from the tracking cookie. Unknown codes are ignored silently
// (an error here would let anyone probe which codes exist).
async function codeFromRequest(req) {
  const b = req && req.body && typeof req.body === 'object' ? req.body : {};
  const c = req && req.cookies ? req.cookies[COOKIE] : null;
  return (await activeCode(b.ref)) || (await activeCode(c)) || null;
}

// ---- registration ----------------------------------------------------------------------------------
async function joinProgram(user, input = {}) {
  const p = program();
  if (!p.enabled) throw new AppError('The affiliate program is not open right now.', 503, 'affiliate_disabled');
  if (!user.emailVerified && !user.phoneVerified) throw new AppError('Please verify your email or mobile number first.', 403, 'not_verified');
  const existing = await Affiliate.findOne({ user: user._id });
  if (existing) return { affiliate: existing, created: false };

  const fields = {};
  if (input.acceptTerms !== true) fields.acceptTerms = 'Please accept the affiliate terms to continue.';
  const upi = A.normalizeUpi(input.upiId); if (upi === null) fields.upiId = 'Enter a valid UPI ID, like name@bank (or leave it empty for now).';
  let wanted = null;
  if (input.code != null && String(input.code).trim() !== '') {
    const problem = A.codeProblem(input.code); if (problem) fields.code = problem; else wanted = A.normalizeCode(input.code);
  }
  if (Object.keys(fields).length) throw new AppError('Please fix the highlighted fields.', 400, 'validation_error', { fields });

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = wanted || A.generateCode(attempt < 3 ? 8 : 10);
    try {
      const affiliate = await Affiliate.create({ user: user._id, code, upiId: upi || '', termsAcceptedAt: new Date() });
      return { affiliate, created: true };
    } catch (e) {
      if (!isDup(e)) throw e;
      const again = await Affiliate.findOne({ user: user._id }); // double-click / two tabs: the same user won the race
      if (again) return { affiliate: again, created: false };
      if (wanted) throw new AppError('Please fix the highlighted fields.', 400, 'validation_error', { fields: { code: 'That code is already taken. Please choose another.' } });
    }
  }
  throw new AppError('Could not create your code. Please try again.', 500, 'internal');
}

async function updateProfile(affiliate, input = {}) {
  const upi = A.normalizeUpi(input.upiId);
  if (upi === null) throw new AppError('Please fix the highlighted fields.', 400, 'validation_error', { fields: { upiId: 'Enter a valid UPI ID, like name@bank.' } });
  affiliate.upiId = upi; await affiliate.save();
  return affiliate;
}

// ---- attribution -----------------------------------------------------------------------------------
// Turns the code stored at sign-up into a Referral once the account is verified. Idempotent; the unique index on referredUser makes the first win final.
async function attributeSignup(user) {
  const code = A.normalizeCode(user.referredByCode);
  if (!code) return null;
  let referral = await Referral.findOne({ referredUser: user._id });
  if (!referral) {
    const affiliate = await Affiliate.findOne({ code, status: 'active' });
    if (affiliate && String(affiliate.user) !== String(user._id)) { // never your own link
      try { referral = await Referral.create({ affiliate: affiliate._id, referredUser: user._id, code }); }
      catch (e) { if (!isDup(e)) throw e; referral = await Referral.findOne({ referredUser: user._id }); }
    }
  }
  await User.updateOne({ _id: user._id }, { $set: { referredByCode: null } }); // handled: no more work on later logins
  user.referredByCode = null;
  return referral;
}

// ---- earning ---------------------------------------------------------------------------------------
// Credits the commission for ONE paid BillingPayment. Safe to call any number of times for the same payment.
async function creditPayment(payment, { now = new Date() } = {}) {
  const p = program();
  if (!p.enabled || !payment || payment.status !== 'paid' || !(payment.amountPaise > 0) || !['razorpay', 'subscription'].includes(payment.source)) return { credited: false, reason: 'not_eligible' };
  if (await Commission.exists({ billingPayment: payment._id })) return { credited: false, reason: 'already_credited' };

  const referral = await Referral.findOne({ referredUser: payment.user });
  if (!referral) return { credited: false, reason: 'no_referral' };
  const affiliate = await Affiliate.findById(referral.affiliate);
  if (!affiliate || affiliate.status !== 'active') return { credited: false, reason: 'affiliate_inactive' };
  if (String(affiliate.user) === String(payment.user)) return { credited: false, reason: 'self_referral' };

  const rateBps = affiliate.commissionBps == null ? p.commissionBps : affiliate.commissionBps;
  const amountPaise = A.commissionFor(payment.amountPaise, rateBps);
  if (amountPaise <= 0) return { credited: false, reason: 'zero_commission' };

  // Reserve one of the referral's commission-earning slots atomically (two payments racing cannot both take the last one).
  const slot = await Referral.findOneAndUpdate({ _id: referral._id, paidPayments: { $lt: p.maxPayments } }, { $inc: { paidPayments: 1 } }, { new: true });
  if (!slot) return { credited: false, reason: 'limit_reached' };
  try {
    const commission = await Commission.create({
      affiliate: affiliate._id, referral: referral._id, billingPayment: payment._id, store: payment.store || null, plan: payment.plan, cycle: payment.cycle,
      basePaise: payment.amountPaise, rateBps, amountPaise, availableAt: new Date(now.getTime() + p.holdDays * DAY),
    });
    await Referral.updateOne({ _id: referral._id, status: 'signed_up' }, { $set: { status: 'converted', convertedAt: now } });
    events.emit('affiliate.commission_earned', { affiliateId: affiliate._id, commissionId: commission._id, amountPaise });
    return { credited: true, commission };
  } catch (e) {
    await Referral.updateOne({ _id: referral._id }, { $inc: { paidPayments: -1 } }).catch(() => {}); // give the slot back
    if (isDup(e)) return { credited: false, reason: 'already_credited' }; // a racing caller credited the same payment first
    throw e;
  }
}

// Event listener: billing.grant() emits plan.activated with the payment id after the period was granted.
async function onPlanActivated(payload) {
  if (!payload || !payload.paymentId) return;
  const payment = await BillingPayment.findOne({ _id: payload.paymentId }).setOptions({ skipTenant: true });
  if (payment) await creditPayment(payment);
}
let listening = false;
// Called once from createApp(), like the other services: listens for paid plan activations.
function register() { if (listening) return; listening = true; events.on('plan.activated', onPlanActivated); }

// Repair sweep: if the process died between "period granted" and "commission credited", this finds it. Looks at recent paid payments only.
async function syncMissing({ days = 3, limit = 500, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY);
  const payments = await BillingPayment.find({ status: 'paid', paidAt: { $gte: since }, amountPaise: { $gt: 0 }, source: { $in: ['razorpay', 'subscription'] } }).setOptions({ skipTenant: true }).sort({ paidAt: -1 }).limit(limit);
  if (!payments.length) return { checked: 0, credited: 0 };
  const referred = new Set((await Referral.find({ referredUser: { $in: payments.map((x) => x.user) } }).select('referredUser').lean()).map((r) => String(r.referredUser)));
  let credited = 0;
  for (const pay of payments) { if (referred.has(String(pay.user)) && (await creditPayment(pay, { now })).credited) credited++; }
  return { checked: payments.length, credited };
}
function startAffiliateJob() {
  if (!program().enabled || process.env.AFFILIATE_SYNC_ENABLED === 'false') return null;
  return require('./jobs').startJob('affiliate-sync', () => syncMissing(), { intervalMs: 60 * 60 * 1000 });
}

// ---- dashboards ------------------------------------------------------------------------------------
async function totalsFor(affiliateId, now = new Date()) {
  const rows = await Commission.aggregate([
    { $match: { affiliate: affiliateId } },
    { $group: { _id: { status: '$status', ready: { $lte: ['$availableAt', now] } }, total: { $sum: '$amountPaise' }, n: { $sum: 1 } } },
  ]);
  const t = { pending: 0, payable: 0, paid: 0, void: 0 };
  for (const r of rows) {
    if (r._id.status === 'pending') t[r._id.ready ? 'payable' : 'pending'] += r.total;
    else t[r._id.status] += r.total;
  }
  return t;
}

async function stats(affiliate, now = new Date()) {
  const [signups, customers, totals, referrals, commissions] = await Promise.all([
    Referral.countDocuments({ affiliate: affiliate._id }),
    Referral.countDocuments({ affiliate: affiliate._id, status: 'converted' }),
    totalsFor(affiliate._id, now),
    Referral.find({ affiliate: affiliate._id }).sort({ createdAt: -1 }).limit(25).populate('referredUser', 'name').lean(),
    Commission.find({ affiliate: affiliate._id }).sort({ createdAt: -1 }).limit(25),
  ]);
  const p = program();
  return {
    funnel: { clicks: affiliate.clicks, signups, customers, signupRate: affiliate.clicks ? Math.round((signups / affiliate.clicks) * 1000) / 10 : 0, customerRate: signups ? Math.round((customers / signups) * 1000) / 10 : 0 },
    earnings: { pending: totals.pending / 100, payable: totals.payable / 100, paid: totals.paid / 100, lifetime: (totals.pending + totals.payable + totals.paid) / 100, minPayout: p.minPayoutPaise / 100 },
    referrals: referrals.map((r) => ({ name: A.maskName(r.referredUser && r.referredUser.name), status: r.status, joinedAt: r.createdAt, convertedAt: r.convertedAt, payments: r.paidPayments })),
    commissions: commissions.map((c) => c.toApi(now)),
  };
}

// ---- admin -----------------------------------------------------------------------------------------
async function adminList({ page = 1, limit = 25 } = {}) {
  const skip = (Math.max(1, page) - 1) * limit, now = new Date();
  const [rows, total] = await Promise.all([
    Affiliate.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name email phone').lean(),
    Affiliate.countDocuments({}),
  ]);
  const out = [];
  for (const a of rows) {
    const [t, referrals] = [await totalsFor(a._id, now), await Referral.countDocuments({ affiliate: a._id })];
    out.push({ id: String(a._id), code: a.code, status: a.status, upiId: a.upiId, clicks: a.clicks, referrals, user: a.user ? { name: a.user.name, email: a.user.email, phone: a.user.phone } : null, earnings: { pending: t.pending / 100, payable: t.payable / 100, paid: t.paid / 100 } });
  }
  return { affiliates: out, total, page, limit };
}

async function setStatus(id, status) {
  if (!['active', 'suspended'].includes(status)) throw new AppError('Status must be active or suspended.', 400, 'validation_error');
  const a = await Affiliate.findByIdAndUpdate(id, { $set: { status } }, { new: true });
  if (!a) throw new AppError('Affiliate not found.', 404, 'not_found');
  return a;
}

// Records a payout for everything payable: marks those commissions paid in ONE guarded update, so a double-click or two admins cannot pay the same commission twice.
async function recordPayout(id, { reference, now = new Date() } = {}) {
  const ref = typeof reference === 'string' ? reference.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '';
  if (ref.length < 3 || ref.length > 120) throw new AppError('Enter the payment reference (UTR / note), 3 to 120 characters.', 400, 'validation_error', { fields: { reference: 'Enter the payment reference (UTR / note).' } });
  const a = await Affiliate.findById(id);
  if (!a) throw new AppError('Affiliate not found.', 404, 'not_found');
  if (!a.upiId) throw new AppError('This affiliate has not added a UPI ID yet.', 409, 'no_payout_details');
  const t = await totalsFor(a._id, now);
  const min = program().minPayoutPaise;
  if (t.payable <= 0 || t.payable < min) throw new AppError(`Payable balance is Rs ${t.payable / 100}; the minimum payout is Rs ${min / 100}.`, 409, 'below_minimum');
  const r = await Commission.updateMany({ affiliate: a._id, status: 'pending', availableAt: { $lte: now } }, { $set: { status: 'paid', paidAt: now, payoutRef: ref } });
  if (!r.modifiedCount) throw new AppError('Nothing payable right now (it may have just been paid).', 409, 'nothing_payable'); // a concurrent payout got there first
  const [sum] = await Commission.aggregate([{ $match: { affiliate: a._id, status: 'paid', paidAt: now, payoutRef: ref } }, { $group: { _id: null, total: { $sum: '$amountPaise' }, n: { $sum: 1 } } }]);
  return { paid: (sum ? sum.total : 0) / 100, commissions: r.modifiedCount, reference: ref, upiId: a.upiId };
}

async function voidCommission(id, reason) {
  const why = typeof reason === 'string' ? reason.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200) : '';
  if (why.length < 3) throw new AppError('Give a short reason.', 400, 'validation_error', { fields: { reason: 'Give a short reason.' } });
  const c = await Commission.findOneAndUpdate({ _id: id, status: 'pending' }, { $set: { status: 'void', voidReason: why } }, { new: true });
  if (c) return c;
  const exists = await Commission.findById(id).select('status').lean();
  if (!exists) throw new AppError('Commission not found.', 404, 'not_found');
  throw new AppError(exists.status === 'paid' ? 'Already paid out; it cannot be voided.' : 'Already voided.', 409, 'conflict');
}

module.exports = {
  COOKIE, programInfo, activeCode, trackClick, codeFromRequest, joinProgram, updateProfile, attributeSignup, creditPayment, onPlanActivated, register,
  syncMissing, startAffiliateJob, stats, totalsFor, adminList, setStatus, recordPayout, voidCommission,
};
