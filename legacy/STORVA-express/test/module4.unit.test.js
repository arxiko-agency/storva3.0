'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPaise, toInt, readProduct, sniffImage, escapeRegex } = require('../src/utils/productInput');

test('toPaise converts rupees exactly and rejects bad money', () => {
  assert.equal(toPaise(199), 19900); assert.equal(toPaise('49.99'), 4999); assert.equal(toPaise(0), 0); assert.equal(toPaise(0.1 + 0.2), 30);
  for (const bad of [-1, 10.999, NaN, Infinity, 'abc', '', null, undefined, {}, [], 10000001]) assert.equal(toPaise(bad), null, String(bad));
});
test('toInt', () => { assert.equal(toInt('5', 0, 10), 5); assert.equal(toInt(1.5, 0, 10), null); assert.equal(toInt(11, 0, 10), null); assert.equal(toInt({}, 0, 10), null); });

test('readProduct: valid simple product', () => {
  const { data, fields } = readProduct({ title: ' Silk Saree ', price: 1499.5, compareAtPrice: 1999, tags: ['Silk', 'silk', 'Saree'], status: 'active', stock: 5 });
  assert.deepEqual(fields, {}); assert.equal(data.title, 'Silk Saree'); assert.equal(data.pricePaise, 149950); assert.deepEqual(data.tags, ['silk', 'saree']);
});
test('readProduct: required fields on create, optional on patch', () => {
  assert.ok(readProduct({}).fields.title && readProduct({}).fields.price);
  assert.deepEqual(readProduct({}, { partial: true }).fields, {});
});
test('readProduct: rejects objects/operators and bad values', () => {
  const { fields } = readProduct({ title: { $ne: 1 }, price: 'x', status: 'live', stock: -1, tags: 'a', compareAtPrice: 5, trackInventory: 'yes' });
  for (const k of ['title', 'price', 'status', 'stock', 'tags', 'trackInventory']) assert.ok(fields[k], k);
  assert.ok(readProduct({ title: 'Abc', price: 100, compareAtPrice: 50 }).fields.compareAtPrice);
});
test('readProduct: variants must match options, no duplicates, ids preserved', () => {
  const opts = [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red'] }];
  const ok = readProduct({ title: 'Tee', price: 10, options: opts, variants: [{ options: { Size: 'S', Color: 'Red' }, stock: 3, price: 12 }, { options: { Size: 'M', Color: 'Red' } }] },
    { existingVariants: [{ key: 'S|Red', _id: 'keep-me' }] });
  assert.deepEqual(ok.fields, {}); assert.equal(ok.data.variants[0]._id, 'keep-me'); assert.equal(ok.data.variants[0].pricePaise, 1200); assert.equal(ok.data.variants[1].pricePaise, null);
  const bad = (variants) => readProduct({ title: 'Tee', price: 10, options: opts, variants }).fields.variants;
  assert.ok(bad([{ options: { Size: 'XL', Color: 'Red' } }]), 'unknown value');
  assert.ok(bad([{ options: { Size: 'S' } }]), 'missing option');
  assert.ok(bad([{ options: { Size: 'S', Color: 'Red' } }, { options: { Size: 'S', Color: 'Red' } }]), 'duplicate');
  assert.ok(bad([{ options: { Size: 'S', Color: 'Red' }, stock: -1 }]), 'negative stock');
  assert.ok(readProduct({ title: 'Tee', price: 10, options: opts }).fields.variants, 'options without variants');
  assert.ok(readProduct({ title: 'Tee', price: 10, options: [], variants: [{ options: {} }] }).fields.variants, 'variants without options');
  assert.ok(readProduct({ title: 'Tee', price: 10, options: Array(4).fill({ name: 'a', values: ['x'] }), variants: [] }).fields.options, 'too many options');
});
test('sniffImage trusts bytes only', () => {
  const pad = Buffer.alloc(20);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])).ext, 'jpg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])).ext, 'png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])).ext, 'webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<?php system($_GET[0]); ?>   ')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null); assert.equal(sniffImage('x'), null);
});
test('escapeRegex neutralises search injection', () => { assert.equal(new RegExp(escapeRegex('a.*(b')).test('a.*(b'), true); assert.equal(new RegExp(escapeRegex('.*')).test('abc'), false); });
