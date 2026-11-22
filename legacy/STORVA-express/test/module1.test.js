'use strict';
// Run with: npm test   (needs `npm install` first; no database required for these checks)
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test';
process.env.SUPPORT_WHATSAPP = '919876543210';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server; let base;
test.before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('GET /api/health reports DB down (503) when Mongo is not connected', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).db, 'down');
});

test('GET /api/config/public exposes only non-secret settings', async () => {
  const r = await fetch(`${base}/api/config/public`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(j).sort(), ['brand', 'instagramUrl', 'supportEmail', 'supportWhatsapp']);
  assert.equal(j.supportWhatsapp, '919876543210');
});

test('unknown /api route returns JSON 404', async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, 'not_found');
});

test('malformed JSON body returns 400 JSON, not a stack trace', async () => {
  const r = await fetch(`${base}/api/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'bad_json');
});

test('static pages are served and security headers are set', async () => {
  for (const p of ['/', '/terms', '/privacy']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
  const r = await fetch(base + '/');
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal(r.headers.get('x-powered-by'), null);
});
