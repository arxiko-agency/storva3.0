# Production integrations: audit and what changed (2026-11-18)

Scope: section 2 of the production-readiness brief (12 integrations). Method: every integration was read in the existing code first; only real gaps were filled, additively. No existing route, model field, API shape or test was removed or renamed.

**What was and was not run.** This environment has no MongoDB, no npm registry and no network. Run here: the 23 new pure-logic unit tests (all pass) and the existing suites that need no installed packages (`module6.webhook` 18, `module6.unit` 5, `module6.gateway` 16, `module15` 2, `hardening` 18: all pass). **Not run:** every MongoDB-backed integration test (including the new `module8.subscription.integration.test.js`), `module8.unit` (needs `mongoose`), the dashboard UI in a browser, and every call to a real Razorpay / Meta / Google / MSG91 / SMTP account. Run `npm test` and `npm run check:integrations` on a machine with dependencies and your credentials before going live.

## Matrix

| # | Integration | State found in the code | Changed in this pass |
|---|---|---|---|
| 1 | Razorpay live payments | Complete: server-side order, amount from the DB, HMAC checkout proof, reconciliation job | Nothing. Live key check: `check:integrations` |
| 2 | Subscriptions / recurring billing | **Prepaid periods only, by design** (no auto-charge) | **Added opt-in auto-renew** with Razorpay Subscriptions (see below). Off by default |
| 3 | Automatic refunds | Complete (`autoRefund*`, retry, verification, ledger) | Nothing |
| 4 | Razorpay webhooks | Complete: HMAC on raw body, event-id idempotency, compare-and-set | Added `subscription.*` events; payments that belong to an invoice/subscription (no order id) are acknowledged instead of rejected with 400 |
| 5 | WhatsApp send / receive | Complete: outbox with retries, error classification, media download | Nothing |
| 6 | WhatsApp webhook verification | Complete: GET challenge with verify token, POST HMAC-SHA256, unsigned refused in production | Nothing |
| 7 | Gemini | Complete: key server-side, credits reserved and refunded, error mapping | Nothing (no retry on 429: it is reported as "busy") |
| 8 | MSG91 OTP | Send complete (v5 OTP API). Verification is local (hashed code, attempts, single use), correct for this design | Live test flag in `check:integrations`. `MSG91_SENDER_ID` in `.env.example` is not read by the code (documented) |
| 9 | SMTP | Complete (Nodemailer, shared by OTP and the outbox) | Connection/socket timeouts; `requireTLS` on port 587; `verifySmtp()` |
| 10 | MongoDB | Single connect attempt, basic event logging | Retry with backoff (permanent errors like bad credentials fail at once), URI validation, credential redaction, listeners attached once, tunable timeouts |
| 11 | Backup / restore | Encrypted backup + checksummed restore existed, **manual script only** | **Scheduler** (`services/backupJob.js`), shown in `/api/ready` jobs; refuses unencrypted production backups |
| 12 | Production env config | Required-secret checks only | `config/preflight.js`, boot-time report, `ENV_STRICT`, `npm run check:env`, `.env.example` and `render.yaml` completed |

## Auto-renew (Razorpay Subscriptions)

- Prepaid checkout is unchanged. Auto-renew is a second button ("Pay & auto-renew") on the Plan tab, shown only when `RAZORPAY_SUBSCRIPTIONS_ENABLED=true`.
- Flow: `POST /billing/subscribe` creates (once per plan, cycle and price) a Razorpay Plan, then a Subscription; the owner authorises it in Razorpay Checkout; `POST /billing/subscription/verify` checks the `payment_id|subscription_id` HMAC. Every charge then arrives as a signed `subscription.charged` webhook.
- Every charge goes through the existing `grant()`, so periods, upgrade credit, invoice numbers and "exactly once" are the same as for a prepaid purchase. One Razorpay payment id maps to one `BillingPayment` row (partial unique index), so a duplicate webhook, a retry, or the browser racing the webhook cannot extend a plan twice.
- A renewal of the current plan is scheduled to start when the paid period ends (`start_at`); anything else is charged at checkout.
- "Turn off auto-renew" cancels at the end of the cycle; the paid period is never shortened. Renewal reminders are skipped for stores whose auto-renew is on and resume when it is off or halted.
- Rules: one live subscription per store; to change plan, turn auto-renew off first.

### Razorpay dashboard setup
1. Activate **Subscriptions** on your Razorpay account (it is a separate activation).
2. Webhook URL `https://<your-domain>/webhooks/razorpay`, same secret as `RAZORPAY_WEBHOOK_SECRET`. Tick the existing `payment.*` and `refund.*` events **and** `subscription.authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed`.
3. Set `RAZORPAY_SUBSCRIPTIONS_ENABLED=true`, redeploy, run `npm run check:integrations`.
4. Test with `rzp_test_` keys first: subscribe, check the plan activates, cancel.

### Known limits of auto-renew (not built)
- No fallback reconciliation: if a `subscription.charged` webhook is lost for good, that period is not granted until Razorpay redelivers it (the existing order reconciliation does not cover subscriptions). The immediate first charge is also granted by the browser verify step.
- No email to the owner when a charge fails (`halted`): the event `plan.subscription_halted` is emitted and the Plan tab shows it, but no notification template listens yet.
- `total_count` (120 monthly, 10 yearly) and the `start_at` rules follow Razorpay's documented API but were **not confirmed against the Razorpay sandbox**: confirm them in step 4.
- Plan prices come from `src/config/plans.js`. Changing a price creates a new Razorpay Plan; existing subscribers keep the price they signed up for.

## Backups
- Scheduler: on by default in production when `BACKUP_KEY` (32+ chars) is set. `BACKUP_SCHEDULE_ENABLED=false` turns it off; `BACKUP_INTERVAL_HOURS` (24) and `BACKUP_HOUR_IST` tune it. Checked every 30 minutes; retention is the existing `BACKUP_KEEP`.
- Restore (unchanged): `node scripts/restore.js backups/storva-YYYYMMDD-HHMMSS --yes` into an empty database; `--drop` to replace; production needs `--i-know-this-is-production`. Checksums are verified before anything is written.
- **Not built: off-site copy.** A backup on the same disk does not survive losing that disk. Copy `BACKUP_DIR` to another place (S3 / Drive / another host) with your host's tooling.
- A restore drill on a scratch database is the only real proof backups work: do one before launch.

## Commands
- `npm run check:env`: offline; exit 1 on configuration errors (`NODE_ENV=production` for production rules).
- `npm run check:integrations`: live, read-only (never charges, refunds, subscribes or messages). Options: `--only=mongo,razorpay,whatsapp,gemini,smtp,backup`, `--send-test-sms=<mobile>`, `--send-test-email=<address>` (these two send ONE real message).
- Boot: in production the same rules print as `[env]` lines; `ENV_STRICT=true` makes errors stop the server from starting.
