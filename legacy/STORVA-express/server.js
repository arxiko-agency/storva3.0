'use strict';
const { env, assertEnv } = require('./src/config/env');
const { connectDb, disconnectDb } = require('./src/config/db');
const { createApp } = require('./src/app');

async function main() {
  assertEnv();
  require('./src/services/monitor').installProcessHandlers(); // Module 15: crashes and unhandled promise errors are logged (and alerted) before exit
  await connectDb();
  const server = createApp().listen(env.port, () => console.log(`[server] ${env.brandName} listening on :${env.port} (${env.nodeEnv})`));

  const reconcileJob = require('./src/services/reconcileJob').start(); // no-op unless online payments are configured and RECONCILE_ENABLED is not "false"

  const abandonedJob = require('./src/services/abandonedJob').start(); // cancels unpaid online orders and returns their stock; ABANDON_CLEANUP_ENABLED=false turns it off

  const autoRefundJob = require('./src/services/autoRefundJob').start(); // cancelled paid online orders are refunded automatically; AUTO_REFUND_ENABLED=false turns it off

  const planJob = require('./src/services/billing').startPlanJob(); // Module 8: plan expiry + renewal reminders (PLAN_EXPIRY_ENABLED=false turns it off)

  const outboxJob = require('./src/services/outbox').startOutboxJob(); // Modules 10 + 13: email/WhatsApp delivery with retries (OUTBOX_ENABLED=false turns it off)
  const digestJob = require('./src/services/notifications').startDigestJob(); // Module 13: optional 9 pm daily summary emails
  const backupJob = require('./src/services/backupJob').startBackupJob(); // scheduled encrypted backups: on in production when BACKUP_KEY is set (BACKUP_SCHEDULE_ENABLED=false turns it off)

  const affiliateJob = require('./src/services/affiliates').startAffiliateJob(); // repairs a missed commission after a crash (AFFILIATE_SYNC_ENABLED=false turns it off)

  const shutdown = async (sig) => {
    console.log(`[server] ${sig} received, shutting down`);
    if (reconcileJob) reconcileJob.stop();
    if (abandonedJob) abandonedJob.stop();
    if (autoRefundJob) autoRefundJob.stop();
    if (planJob) planJob.stop();
    if (outboxJob) outboxJob.stop();
    if (digestJob) digestJob.stop();
    if (backupJob) backupJob.stop();
    if (affiliateJob) affiliateJob.stop();
    server.close(async () => { await require('./src/services/events').drain().catch(() => {}); await disconnectDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
}

main().catch((e) => { console.error('[fatal]', e.message); process.exit(1); });
