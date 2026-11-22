'use strict';
// Module 14 pure helpers: India day boundaries, date range rules per plan, traffic-source classification, bot detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/services/analytics');

test('India day boundaries', () => {
  assert.equal(A.istDay(new Date('2026-05-01T18:29:00Z')), '2026-05-01'); assert.equal(A.istDay(new Date('2026-05-01T18:30:00Z')), '2026-05-02');
  assert.equal(A.dayStart('2026-05-02').toISOString(), '2026-05-01T18:30:00.000Z'); assert.equal(A.addDays('2026-02-28', 1), '2026-03-01');
});

test('date ranges: presets, custom, limits, Free plan restricted to the last 30 days', () => {
  const now = new Date('2026-06-15T06:00:00Z');
  let r = A.readRange({}, 'basic', now); assert.equal(r.to, '2026-06-15'); assert.equal(r.from, '2026-05-17'); assert.equal(r.span, 30);
  r = A.readRange({ days: '7' }, 'overview', now); assert.equal(r.from, '2026-06-09');
  r = A.readRange({ from: '2026-01-01', to: '2026-12-31' }, 'basic', now); assert.equal(r.to, '2026-06-15', 'future end is clamped to today');
  assert.throws(() => A.readRange({ from: '2026-06-10', to: '2026-06-01' }, 'basic', now), /valid date range/);
  assert.throws(() => A.readRange({ from: '2024-01-01', to: '2026-06-01' }, 'advanced', now), /one year/);
  assert.throws(() => A.readRange({ days: '90' }, 'overview', now), (e) => e.status === 402);
  assert.throws(() => A.readRange({ from: '2026-06-01', to: '2026-06-05' }, 'overview', now), (e) => e.status === 402);
});

test('traffic sources and bots', () => {
  const req = (ref, query = {}) => ({ query, hostname: 'shop.example.com', get: (h) => (h === 'referer' ? ref : '') });
  assert.equal(A.classifySource(req(undefined)), 'direct');
  assert.equal(A.classifySource(req('https://l.instagram.com/?u=x')), 'instagram'); assert.equal(A.classifySource(req('https://m.facebook.com/')), 'facebook');
  assert.equal(A.classifySource(req('https://www.google.co.in/')), 'google'); assert.equal(A.classifySource(req('https://t.co/abc')), 'x');
  assert.equal(A.classifySource(req('https://shop.example.com/store/a')), null, 'inside the store is not an arrival');
  assert.equal(A.classifySource(req(undefined, { ref: 'wa' })), 'whatsapp'); assert.equal(A.classifySource(req(undefined, { utm_source: 'Newsletter' })), 'other'); assert.equal(A.classifySource(req(undefined, { ref: 'qr' })), 'qr');
  for (const ua of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'Googlebot/2.1', 'curl/8.0', 'Mozilla/5.0 HeadlessChrome/120']) assert.ok(A.BOT.test(ua), ua);
  assert.ok(!A.BOT.test('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'));
});
