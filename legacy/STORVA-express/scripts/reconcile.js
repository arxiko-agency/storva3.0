'use strict';
// One-off / cron entry point for payment reconciliation (e.g. a Render Cron Job running `node scripts/reconcile.js` every 15 minutes).
//   node scripts/reconcile.js              fix what can be fixed safely
//   node scripts/reconcile.js --dry-run    only print what WOULD change; writes nothing
//   node scripts/reconcile.js --limit=100  orders per pass (max 200)
// Exit code: 0 = ran (issues are logged, not failures), 1 = could not run or stopped early (credentials rejected, Razorpay down, no configuration).
const { env, assertEnv } = require('../src/config/env');
const { connectDb, disconnectDb } = require('../src/config/db');

(async () => {
  const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
  const lim = args.find((a) => a.startsWith('--limit=')), limit = lim ? Number(lim.split('=')[1]) : undefined;
  assertEnv();
  if (!env.razorpay.enabled) { console.error('Online payments are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET): nothing to reconcile.'); process.exit(1); }
  await connectDb();
  const { reconcileBatch } = require('../src/services/reconciliation');
  const s = await reconcileBatch({ dryRun, limit });
  console.log(JSON.stringify({ dryRun: s.dryRun, scanned: s.scanned, applied: s.applied, unchanged: s.unchanged, issues: s.issues, errors: s.errors, aborted: s.aborted, orders: s.orders }, null, 2));
  await disconnectDb();
  process.exit(s.aborted ? 1 : 0);
})().catch((e) => { console.error('[fatal]', e.message); process.exit(1); });
