'use strict';
const AppError = require('./AppError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// Indian mobile numbers. Accepts 9876543210, 09876543210, 919876543210, +91 98765 43210.
// Stored as digits with country code: 919876543210.
function normalizePhone(v) {
  let d = String(v || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `91${d}` : null;
}

// Decide whether a login/recovery identifier is an email or a phone number.
function parseIdentifier(v) {
  const raw = String(v || '').trim();
  if (raw.includes('@')) { const value = normalizeEmail(raw); return value ? { type: 'email', value } : null; }
  const value = normalizePhone(raw);
  return value ? { type: 'phone', value } : null;
}

function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters.';
  if (s.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must contain at least one letter and one number.';
  return null;
}

function cleanName(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 80 ? s : null;
}

const isCode = (v) => /^\d{6}$/.test(String(v || ''));

function badRequest(fields) {
  return new AppError('Please fix the highlighted fields.', 400, 'validation_error', { fields });
}

module.exports = { normalizeEmail, normalizePhone, parseIdentifier, passwordProblem, cleanName, isCode, badRequest };
