'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { promisify } = require('util');
const { hashPassword, verifyPassword, needsRehash } = require('../src/utils/password');
const { startJob, stats } = require('../src/services/jobs');
const { cleanMeta } = require('../src/services/audit');

test('new password hashes use the stronger cost and do not need a rehash', async () => {
  const h = await hashPassword('Sup3rSecret');
  assert.ok(h.startsWith('scrypt$65536$8$2$'));
  assert.equal(needsRehash(h), false);
  assert.equal(await verifyPassword('Sup3rSecret', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
});

test('an old N=16384 hash still verifies and is flagged for rehash', async () => {
  const salt = crypto.randomBytes(16);
  const key = await promisify(crypto.scrypt)('OldPass1', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const old = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
  assert.equal(await verifyPassword('OldPass1', old), true);
  assert.equal(needsRehash(old), true);
});

test('a hung job times out, is counted as failed and can run again', async () => {
  process.env.NODE_ENV = 'test';
  let calls = 0;
  const j = startJob('hang-test', () => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve(); }, { intervalMs: 3600e3, firstDelayMs: 3600e3, timeoutMs: 30 });
  await j.tick();
  let s = stats().find((x) => x.name === 'hang-test');
  assert.equal(s.failures, 1); assert.match(s.lastError, /timed out/); assert.equal(s.running, false);
  await j.tick();
  s = stats().find((x) => x.name === 'hang-test');
  assert.equal(calls, 2); assert.equal(s.lastError, '');
  j.stop();
});

test('audit meta drops credential-like keys and clips values', () => {
  const m = cleanMeta({ status: 'shipped', password: 'x', otpCode: '123', token: 't', note: 'a'.repeat(500), n: 5 });
  assert.deepEqual(Object.keys(m).sort(), ['n', 'note', 'status']);
  assert.equal(m.note.length, 120);
  assert.equal(cleanMeta(null), undefined);
});

const hasMongoose = (() => { try { require.resolve('mongoose'); return true; } catch { return false; } })();
test('originGuard blocks cross-site browser requests even without an Origin header', { skip: !hasMongoose && 'mongoose not installed (runs after npm install)' }, () => {
  process.env.APP_URL = 'https://app.example.com';
  const { originGuard } = require('../src/middleware/auth');
  const run = (headers) => { let err = 'none'; originGuard({ method: 'POST', get: (h) => headers[h.toLowerCase()] }, {}, (e) => { err = e; }); return err; };
  assert.equal(run({ 'sec-fetch-site': 'cross-site' }).code, 'bad_origin');
  assert.equal(run({}), undefined);                              // curl / server-to-server
  assert.equal(run({ 'sec-fetch-site': 'same-origin' }), undefined);
});
