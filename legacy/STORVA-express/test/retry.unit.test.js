'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('../src/utils/retry');

const noSleep = (log) => async (ms) => { log.push(ms); };

test('retry: succeeds after transient failures and waits with exponential backoff', async () => {
  const waits = []; let calls = 0;
  const r = await retry(async () => { calls++; if (calls < 3) throw new Error('down'); return 'ok'; }, { attempts: 5, baseMs: 1000, sleep: noSleep(waits), random: () => 1 });
  assert.equal(r, 'ok'); assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
});
test('retry: jitter keeps each wait between 50% and 100% of the backoff, capped by maxMs', async () => {
  const lo = [], hi = [];
  await retry(async (i) => { if (i < 4) throw new Error('x'); }, { attempts: 4, baseMs: 1000, maxMs: 3000, sleep: noSleep(lo), random: () => 0 });
  await retry(async (i) => { if (i < 4) throw new Error('x'); }, { attempts: 4, baseMs: 1000, maxMs: 3000, sleep: noSleep(hi), random: () => 1 });
  assert.deepEqual(lo, [500, 1000, 1500]); assert.deepEqual(hi, [1000, 2000, 3000]);
});
test('retry: gives up after the last attempt and throws the LAST error', async () => {
  let n = 0;
  await assert.rejects(retry(async () => { throw new Error('fail ' + ++n); }, { attempts: 3, sleep: noSleep([]) }), /fail 3/);
  assert.equal(n, 3);
});
test('retry: an error marked not retryable stops immediately and onRetry sees each retry', async () => {
  let n = 0; const seen = [];
  await assert.rejects(retry(async () => { n++; throw Object.assign(new Error('bad auth'), { permanent: true }); }, { attempts: 5, sleep: noSleep([]), retryable: (e) => !e.permanent }), /bad auth/);
  assert.equal(n, 1);
  await retry(async (i) => { if (i < 2) throw new Error('once'); }, { attempts: 3, sleep: noSleep([]), onRetry: (e, i, d) => seen.push([e.message, i, d]) });
  assert.deepEqual(seen, [['once', 1, 1000]]);
});
