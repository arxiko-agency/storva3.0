'use strict';
// Background interval jobs with overlap protection and run statistics (Module 15 health/metrics read `stats()`).
// Every job must be safe to run on several instances at once (compare-and-set writes, idempotent effects).
const registry = new Map();

function startJob(name, fn, { intervalMs, firstDelayMs = 30 * 1000, enabled = true, timeoutMs = Number(process.env.JOB_TIMEOUT_MS) || 10 * 60 * 1000 } = {}) {
  if (!enabled) return null;
  const st = { name, intervalMs, runs: 0, failures: 0, lastRunAt: null, lastOkAt: null, lastError: '', lastDurationMs: 0, running: false };
  registry.set(name, st);
  const tick = async () => {
    if (st.running) return;
    st.running = true; const t0 = Date.now(); st.lastRunAt = new Date();
    let timer;
    try {
      // A hung network call must not leave `running` true forever: after timeoutMs the tick counts as failed and the next one may start.
      await Promise.race([Promise.resolve().then(fn), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`job ${name} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs); })]);
      st.lastOkAt = new Date(); st.lastError = '';
    }
    catch (e) { st.failures++; st.lastError = String((e && e.message) || e).slice(0, 200); require('./monitor').captureError(e, { kind: 'job', job: name }); }
    finally { clearTimeout(timer); st.runs++; st.lastDurationMs = Date.now() - t0; st.running = false; }
  };
  const first = setTimeout(tick, firstDelayMs), every = setInterval(tick, intervalMs);
  first.unref(); every.unref();
  return { name, tick, stop() { clearTimeout(first); clearInterval(every); registry.delete(name); } };
}
const stats = () => [...registry.values()].map((s) => ({ ...s }));
module.exports = { startJob, stats };
