'use strict';
// Retry with exponential backoff and jitter. Pure: sleep/random are injectable so tests run instantly.
//   await retry((attempt) => doThing(), { attempts: 5, baseMs: 1000, maxMs: 15000, retryable: (e) => true, onRetry: (e, attempt, delayMs) => {} })
// Waits 50-100% of min(maxMs, baseMs * 2^(attempt-1)) between tries; throws the LAST error when attempts run out or the error is not retryable.
async function retry(fn, { attempts = 5, baseMs = 1000, maxMs = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, onRetry = () => {}, retryable = () => true } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i === attempts || !retryable(e)) break;
      const delay = Math.min(maxMs, baseMs * 2 ** (i - 1));
      onRetry(e, i, delay);
      await sleep(Math.round(delay / 2 + random() * (delay / 2)));
    }
  }
  throw last;
}
module.exports = { retry };
