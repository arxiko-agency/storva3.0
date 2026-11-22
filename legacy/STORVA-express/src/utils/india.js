'use strict';
// Module 12: Indian states / union territories with their GST state codes, GSTIN validation (format + check digit) and HSN codes.
const STATES = Object.freeze([
  ['01', 'Jammu and Kashmir', ['j&k', 'jammu & kashmir']], ['02', 'Himachal Pradesh', ['hp']], ['03', 'Punjab', []], ['04', 'Chandigarh', []], ['05', 'Uttarakhand', ['uttaranchal']],
  ['06', 'Haryana', []], ['07', 'Delhi', ['new delhi', 'nct of delhi']], ['08', 'Rajasthan', []], ['09', 'Uttar Pradesh', ['up']], ['10', 'Bihar', []], ['11', 'Sikkim', []],
  ['12', 'Arunachal Pradesh', []], ['13', 'Nagaland', []], ['14', 'Manipur', []], ['15', 'Mizoram', []], ['16', 'Tripura', []], ['17', 'Meghalaya', []], ['18', 'Assam', []],
  ['19', 'West Bengal', ['wb']], ['20', 'Jharkhand', []], ['21', 'Odisha', ['orissa']], ['22', 'Chhattisgarh', ['chattisgarh']], ['23', 'Madhya Pradesh', ['mp']], ['24', 'Gujarat', []],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu', ['daman and diu', 'dadra and nagar haveli', 'dnh and dd']], ['27', 'Maharashtra', []], ['29', 'Karnataka', []], ['30', 'Goa', []],
  ['31', 'Lakshadweep', []], ['32', 'Kerala', ['keralam']], ['33', 'Tamil Nadu', ['tn', 'tamilnadu']], ['34', 'Puducherry', ['pondicherry']], ['35', 'Andaman and Nicobar Islands', ['andaman & nicobar']],
  ['36', 'Telangana', []], ['37', 'Andhra Pradesh', ['ap']], ['38', 'Ladakh', []],
].map(([code, name, aliases]) => Object.freeze({ code, name, aliases })));
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const BY_KEY = new Map();
for (const s of STATES) { BY_KEY.set(norm(s.name), s); s.aliases.forEach((a) => BY_KEY.set(norm(a), s)); }
// Two-letter short forms people type (vehicle-registration style) and common spellings.
const SHORT = { an: '35', ar: '12', as: '18', br: '10', ch: '04', cg: '22', ct: '22', dn: '26', dd: '26', dl: '07', ga: '30', gj: '24', hr: '06', jk: '01', jh: '20', ka: '29', kl: '32', la: '38', ld: '31',
  mh: '27', mn: '14', ml: '17', mz: '15', nl: '13', od: '21', or: '21', py: '34', pb: '03', rj: '08', sk: '11', ts: '36', tg: '36', tr: '16', uk: '05', ua: '05', telengana: '36', bombay: '27', karnatak: '29', 'chhatisgarh': '22', 'pondichery': '34', 'west bangal': '19', 'gujrat': '24', 'tamil nadu state': '33' };
for (const [k, code] of Object.entries(SHORT)) if (!BY_KEY.has(k)) BY_KEY.set(k, STATES.find((x) => x.code === code));
const stateByName = (name) => BY_KEY.get(norm(name)) || null;
const canonicalState = (name) => { const s = stateByName(name); return s ? s.name : String(name || '').trim(); };
const stateByCode = (code) => STATES.find((s) => s.code === String(code)) || null;

// GSTIN: 2-digit state code + 10-char PAN + entity number + 'Z' + check character (base-36 weighted checksum).
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const v = CHARS.indexOf(first14[i]); const p = v * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return CHARS[(36 - (sum % 36)) % 36];
}
function gstinProblem(raw) {
  const g = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return 'A GSTIN has 15 characters, like 32ABCDE1234F1Z5.';
  if (!stateByCode(g.slice(0, 2)) && !['97', '99'].includes(g.slice(0, 2))) return 'The first two digits are not a valid state code.';
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'This GSTIN looks mistyped (the last character does not match).';
  return null;
}
const normalizeGstin = (raw) => String(raw || '').toUpperCase().replace(/\s/g, '');
const validHsn = (h) => /^\d{4}(\d{2}){0,2}$/.test(String(h || ''));   // 4, 6 or 8 digits
const GST_RATES = Object.freeze([0, 0.25, 3, 5, 12, 18, 28, 40]);

// Indian financial year (April–March) for invoice numbering: 2026-05-10 -> "26-27".
function financialYear(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600e3), y = ist.getUTCFullYear(), start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

module.exports = { STATES, stateByName, canonicalState, stateByCode, gstinProblem, gstinCheckChar, normalizeGstin, validHsn, GST_RATES, financialYear };
