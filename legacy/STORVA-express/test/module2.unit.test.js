'use strict';
// Pure-logic tests: no database, no network, no npm packages required.
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/utils/password');
const { generateOtp, hashOtp, safeEqualHex, newSessionToken, hashSessionToken } = require('../src/utils/secure');
const v = require('../src/utils/validate');

test('password: hash verifies, wrong password and garbage hashes fail', async () => {
  const h = await hashPassword('Secret123');
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword('Secret123', h), true);
  assert.equal(await verifyPassword('secret123', h), false);
  assert.equal(await verifyPassword('Secret123', 'nonsense'), false);
  assert.equal(await verifyPassword('Secret123', undefined), false);
  assert.notEqual(h, await hashPassword('Secret123'), 'salted: same password hashes differently');
});

test('otp: always 6 digits, hash is bound to identifier, purpose and code', () => {
  for (let i = 0; i < 500; i++) assert.match(generateOtp(), /^\d{6}$/);
  const h = hashOtp('pepper', 'a@b.co', 'login', '123456');
  assert.equal(safeEqualHex(h, hashOtp('pepper', 'a@b.co', 'login', '123456')), true);
  assert.equal(safeEqualHex(h, hashOtp('pepper', 'a@b.co', 'reset', '123456')), false, 'login code cannot be replayed as reset');
  assert.equal(safeEqualHex(h, hashOtp('pepper', 'x@b.co', 'login', '123456')), false);
  assert.equal(safeEqualHex(h, hashOtp('other', 'a@b.co', 'login', '123456')), false);
  assert.equal(safeEqualHex(h, 'zz'), false);
  assert.equal(safeEqualHex('', ''), false);
});

test('session tokens: unique, long, hashed deterministically with the secret', () => {
  const a = newSessionToken(), b = newSessionToken();
  assert.notEqual(a, b); assert.ok(a.length >= 40);
  assert.equal(hashSessionToken('s', a), hashSessionToken('s', a));
  assert.notEqual(hashSessionToken('s', a), hashSessionToken('t', a));
  assert.notEqual(hashSessionToken('s', a), a);
});

test('validate: phone normalisation', () => {
  for (const ok of ['9876543210', '+91 98765 43210', '919876543210', '09876543210', '(98765) 43210']) assert.equal(v.normalizePhone(ok), '919876543210', ok);
  for (const bad of ['1234567890', '98765', '98765432101234', 'abcdefghij', '', null, {}, ['9876543210x']]) assert.equal(v.normalizePhone(bad), null, String(bad));
});

test('validate: email, identifier and injection-shaped input', () => {
  assert.equal(v.normalizeEmail('  Me@Example.COM '), 'me@example.com');
  assert.equal(v.normalizeEmail('no-at'), null);
  assert.equal(v.normalizeEmail({ $gt: '' }), null, 'object (NoSQL operator) rejected');
  assert.equal(v.parseIdentifier({ $ne: null }), null);
  assert.deepEqual(v.parseIdentifier('A@b.io'), { type: 'email', value: 'a@b.io' });
  assert.deepEqual(v.parseIdentifier('98765 43210'), { type: 'phone', value: '919876543210' });
  assert.equal(v.parseIdentifier('bad@'), null);
});

test('validate: password policy, names and OTP format', () => {
  assert.ok(v.passwordProblem('short1'));
  assert.ok(v.passwordProblem('onlyletters'));
  assert.ok(v.passwordProblem('12345678'));
  assert.ok(v.passwordProblem('a1'.repeat(70)));
  assert.equal(v.passwordProblem('Passw0rdOK'), null);
  assert.equal(v.cleanName('  Asha   K '), 'Asha K');
  assert.equal(v.cleanName('A'), null);
  assert.equal(v.isCode('123456'), true);
  for (const bad of ['12345', '1234567', 'abcdef', '12 456', null]) assert.equal(v.isCode(bad), false);
});
