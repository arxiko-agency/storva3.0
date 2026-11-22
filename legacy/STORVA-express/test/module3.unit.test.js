'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, slugProblem } = require('../src/utils/slug');

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('Priya\'s Boutique & Co.'), 'priya-s-boutique-and-co');
  assert.equal(slugify('  Café  Délice '), 'cafe-delice');
  assert.equal(slugify('---x---'), 'x');
  assert.equal(slugify(null), '');
  assert.ok(slugify('a'.repeat(100)).length <= 30);
});

test('slugProblem accepts good slugs', () => {
  for (const s of ['abc', 'my-store', 'shop123', 'a1b', 'a'.repeat(30)]) assert.equal(slugProblem(s), null, s);
});

test('slugProblem rejects bad slugs', () => {
  for (const s of ['ab', 'a'.repeat(31), '-abc', 'abc-', 'a--b', 'ABC', 'a b', 'a_b', 'a.b', '../etc', 'ab/cd', '', null, undefined, {}, ['abc'], 'दुकान']) {
    assert.ok(slugProblem(s), `should reject ${JSON.stringify(s)}`);
  }
});

test('reserved platform words cannot be claimed', () => {
  for (const s of ['api', 'admin', 'dashboard', 'login', 'www', 'checkout', 'storva', 'showcase']) assert.ok(slugProblem(s), s);
});
