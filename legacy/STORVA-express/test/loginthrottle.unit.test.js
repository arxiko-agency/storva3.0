'use strict';
// No database needed: checks the request the throttle sends to MongoDB (key hashing/scoping, limit, window, error handling)
// and that no in-memory throttle remains in the auth route. Real atomic behaviour: throttle.durable.integration.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { admitUnknownLogin, LIMIT, WINDOW_MS, SCOPE } = require('../src/services/loginThrottle');
const { keyOf } = require('../src/utils/identifierThrottle');

function fakeModel({ admit = true, updateErr = null } = {}) {
  const calls = { updateOne: [], findOneAndUpdate: [] };
  return {
    calls,
    async updateOne(...a) { calls.updateOne.push(a); if (updateErr) throw updateErr; return {}; },
    async findOneAndUpdate(...a) { calls.findOneAndUpdate.push(a); return admit ? { _id: 'x' } : null; },
  };
}

test('defaults keep the old policy: 5 failures per 15 minutes', () => {
  assert.equal(LIMIT, 5); assert.equal(WINDOW_MS, 15 * 60 * 1000);
});
test('key is scoped, hashed and never contains the raw identifier', async () => {
  const m = fakeModel(); await admitUnknownLogin('someone@example.com', { model: m });
  const key = m.calls.findOneAndUpdate[0][0]._id;
  assert.equal(key, keyOf(SCOPE, 'someone@example.com'));
  assert.ok(!key.includes('someone') && !key.includes('example'));
  assert.notEqual(key, keyOf('signup', 'someone@example.com'));
  assert.equal(m.calls.updateOne[0][0]._id, key);
});
test('initialisation is an upsert with $setOnInsert only (cannot reset existing hits) and sets a purge date', async () => {
  const m = fakeModel(); await admitUnknownLogin('a@b.co', { model: m });
  const [, update, opts] = m.calls.updateOne[0];
  assert.deepEqual(Object.keys(update), ['$setOnInsert']); assert.equal(opts.upsert, true);
  assert.ok(update.$setOnInsert.purgeAt instanceof Date && update.$setOnInsert.purgeAt > new Date());
});
test('admission is ONE conditional update on MongoDB clock ($$NOW) with the configured limit and window', async () => {
  const m = fakeModel(); await admitUnknownLogin('a@b.co', { model: m, limit: 7, windowMs: 1000 });
  const [filter, pipeline] = m.calls.findOneAndUpdate[0];
  const f = JSON.stringify(filter), p = JSON.stringify(pipeline);
  assert.match(f, /\$lt/); assert.match(f, /\$size/); assert.ok(f.includes('7')); assert.ok(f.includes('"$$NOW"')); assert.ok(f.includes('1000'));
  assert.ok(Array.isArray(pipeline) && p.includes('$concatArrays') && p.includes('purgeAt'));
});
test('returns true when admitted and false when MongoDB refuses (limit reached)', async () => {
  assert.equal(await admitUnknownLogin('a@b.co', { model: fakeModel({ admit: true }) }), true);
  assert.equal(await admitUnknownLogin('a@b.co', { model: fakeModel({ admit: false }) }), false);
});
test('duplicate-key race on first insert is tolerated; any other database error fails closed (propagates)', async () => {
  const dup = Object.assign(new Error('dup'), { code: 11000 });
  assert.equal(await admitUnknownLogin('a@b.co', { model: fakeModel({ updateErr: dup }) }), true);
  await assert.rejects(() => admitUnknownLogin('a@b.co', { model: fakeModel({ updateErr: new Error('db down') }) }), /db down/);
});
test('auth route uses the durable throttle and has no in-memory Throttle left (static)', () => {
  const a = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.match(a, /admitUnknownLogin\(id\.value\)/);
  assert.ok(!/new Throttle\(/.test(a) && !/unknownLoginFails/.test(a));
  const unknown = a.indexOf('admitUnknownLogin('), burn = a.indexOf('burnVerify', unknown);
  assert.ok(unknown > -1 && burn > unknown, 'locked and unlocked unknown identifiers both pay the same hashing cost');
});
