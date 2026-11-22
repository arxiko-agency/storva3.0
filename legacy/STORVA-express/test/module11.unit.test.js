'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cell, toCsv } = require('../src/utils/csv');
const Customer = require('../src/models/Customer');

test('csv cells: quoting, formula injection, numbers and dates', () => {
  assert.equal(cell('plain'), 'plain'); assert.equal(cell('a,b'), '"a,b"'); assert.equal(cell('say "hi"'), '"say ""hi"""'); assert.equal(cell('line\nbreak'), '"line\nbreak"');
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(cell('+91 98'), "'+91 98"); assert.equal(cell('@cmd'), "'@cmd"); assert.equal(cell('-5'), '-5'); assert.equal(cell(-12.5), '-12.5');
  assert.equal(cell(null), ''); assert.equal(cell(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
  assert.equal(toCsv(['a', 'b'], [[1, 'x']]), '\uFEFFa,b\r\n1,x\r\n');
});

test('customer segments', () => {
  const now = new Date('2026-06-01');
  const seg = (x) => new Customer({ store: '0'.repeat(24), phone: '919', ...x }).segment(now);
  assert.equal(seg({ orderCount: 1, lastOrderAt: new Date('2026-05-30') }), 'new');
  assert.equal(seg({ orderCount: 2, totalSpentPaise: 100000, lastOrderAt: new Date('2026-05-30') }), 'repeat');
  assert.equal(seg({ orderCount: 3, lastOrderAt: new Date('2026-05-30') }), 'vip');
  assert.equal(seg({ orderCount: 1, totalSpentPaise: 600000, lastOrderAt: new Date('2026-05-30') }), 'vip');
  assert.equal(seg({ orderCount: 5, lastOrderAt: new Date('2026-01-01') }), 'inactive');
});
