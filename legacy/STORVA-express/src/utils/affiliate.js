'use strict';
// Affiliate / referral program: pure helpers (no database), so they are unit-tested offline.
// The program: anyone with a STORVA account can become an affiliate and gets a personal link (/r/CODE). People who sign up through it and later
// buy a paid plan earn the affiliate a commission on each plan payment (rate, number of payments, hold period and payout minimum are env-configurable).
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: easy to read aloud and type
const RESERVED = new Set(['ADMIN', 'STORVA', 'SUPPORT', 'HELP', 'TEST', 'NULL', 'UNDEFINED', 'AFFILIATE', 'REFER', 'OFFICIAL', 'STAFF']);
const CODE_RE = /^[A-Z0-9]{4,16}$/;

function generateCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

// Returns the canonical (upper-case) code, or null when the input cannot be a code. Safe to call with anything (query strings, cookies, JSON).
function normalizeCode(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const c = raw.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

// Validation message for a code an affiliate chose themselves (null = fine).
function codeProblem(raw) {
  const c = normalizeCode(raw);
  if (!c) return 'Use 4 to 16 letters or numbers (no spaces or symbols).';
  if (RESERVED.has(c)) return 'That code is not available. Please choose another.';
  return null;
}

// UPI ID such as name@okhdfcbank. Optional everywhere; validated only when given.
const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/;
function normalizeUpi(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return UPI_RE.test(s) ? s.toLowerCase() : null;
}

// Commission in paise for one payment. Integer maths in basis points (2000 bps = 20%), rounded DOWN so the platform never over-pays.
function commissionFor(amountPaise, rateBps) {
  const a = Number(amountPaise), r = Number(rateBps);
  if (!Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r <= 0) return 0;
  return Math.floor((Math.floor(a) * Math.floor(r)) / 10000);
}

// "Anita Kumar" -> "Anita K." : an affiliate sees who signed up without learning full names, emails or phone numbers.
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Customer';
  const first = parts[0].slice(0, 20);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

// Reads the program settings from env. Percent is clamped to 0-90, hold days to 0-180.
function readProgram(e = process.env) {
  const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const percent = Math.min(90, Math.max(0, num(e.AFFILIATE_COMMISSION_PERCENT, 20)));
  return {
    enabled: e.AFFILIATE_ENABLED !== 'false',
    commissionBps: Math.round(percent * 100),
    maxPayments: Math.min(120, Math.max(1, Math.floor(num(e.AFFILIATE_MAX_PAYMENTS, 12)))),   // paid plan payments per referred customer that earn commission
    holdDays: Math.min(180, Math.max(0, Math.floor(num(e.AFFILIATE_HOLD_DAYS, 30)))),          // refund-window delay before a commission becomes payable
    minPayoutPaise: Math.max(0, Math.floor(num(e.AFFILIATE_MIN_PAYOUT_RUPEES, 500))) * 100,
    cookieDays: Math.min(365, Math.max(1, Math.floor(num(e.AFFILIATE_COOKIE_DAYS, 30)))),
  };
}

module.exports = { ALPHABET, RESERVED, generateCode, normalizeCode, codeProblem, normalizeUpi, commissionFor, maskName, readProgram };
