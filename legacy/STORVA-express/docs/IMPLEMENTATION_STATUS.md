# STORVA implementation status (2026-11-19, Task 8)

## Task 8 change (authentication throttling)
- Unknown-account password-login throttle (5 failures / 15 min per identifier) moved from a per-process in-memory map to an atomic MongoDB document (`src/services/loginThrottle.js`, stored in the existing hash-keyed `registrationbudgets` collection, expiry on the database clock, TTL cleanup, fails closed on database errors). Behaviour and responses are unchanged: locked unknown identifiers still get the same 429 `too_many_attempts` as locked real accounts.
- Sign-up throttle (5/hour per email and per mobile) was already durable and atomic (Task 2); Task 8 added integration tests for it (concurrency, two-instance sharing, expiry, identical 429 for existing/new emails). No sign-up code changed.
- Test status: `test/loginthrottle.unit.test.js` **7/7 pass**; `test/throttle.durable.integration.test.js` written but **NOT RUN** (no MongoDB/mongoose in the Task 8 sandbox). Run `node scripts/test-registration-security.js` (starts a disposable MongoDB) before deploying.
- Not changed (documented residual): real-account lockout (`failedLogins` counter) is database-backed but not a single atomic gate, so a burst of parallel wrong passwords from many IPs can exceed 5 guesses before the lock lands (per-IP limiter still applies).

---
# STORVA implementation status (2026-11-19, Task 6)

Legend: **VERIFIED** = run and passing. **MOCKED** = run with a fake external service. **NOT RUN** = needs real accounts or a database.

## Already implemented before Task 6
- Modules 1-15: server and security middleware, auth (scrypt, OTP, opaque sessions), multi-tenant stores, products/variants/images, storefront + cart + coupons + orders, Razorpay checkout/webhooks/refunds/reconciliation, store designer, plans and billing (incl. opt-in auto-renew), Gemini AI tools, WhatsApp Cloud API, customers, shipping + GST invoices, notifications, analytics, hardening (strict CSP, readiness, encrypted DB backups + restore).
- Automatic refunds for cancelled paid orders, abandoned-order cleanup, affiliate/referral program, registration-security fixes (Task 2), production integrations checks (`check:env`, `check:integrations`), Task 5 production configuration audit (report only).

## Newly completed in Task 6 / Task 7 (2026-11-19)
- Documentation refreshed: this file, `PROJECT_AUDIT.md`, `ROADMAP.md`, `README.md` status banner.
- Full re-run of installs, syntax checks and unit tests (results below); integration attempt documented honestly.
- Source tree inspected; no real `.env`, logs, backups, uploads or `node_modules` included in the delivery ZIP. All application modules preserved unchanged.
- No application code was changed in this task.

## Test results (Task 7 run, 2026-11-19, sandbox: Node 22.23, `npm ci` from lockfile)
| Check | Result |
|---|---|
| `npm ci --ignore-scripts` (lockfile v3) | OK, installed cleanly |
| `node --check` on every file in `src/`, `scripts/`, `server.js`, `public/js/` | OK, 0 syntax errors |
| `npm run test:unit` (no database) | **324 tests: 313 pass, 0 fail, 11 skipped** (the 11 skips are the Playwright checkout suite; `playwright` is not installed) |
| `npm run test:integration` (needs MongoDB) | **NOT VERIFIED in this run.** The sandbox has no MongoDB; `mongodb-memory-server` downloaded mongod 8.2.6 but its connections timed out in this container (`MongoPoolClearedError`), including with one test file at a time. This is an environment limit, not evidence of an app bug. Last passing record: 2026-11-17, 400 tests, 389 pass, 0 fail, on a real MongoDB 7 replica set. |
| Playwright browser suite | NOT RUN this time (last record 12/12 pass, 2026-11-17) |
| `npm run check:env` (development) | 1 error reported (expected: no `.env` / `MONGODB_URI` in the sandbox) |
| Live Razorpay, WhatsApp, Gemini, SMTP, MSG91 | NOT RUN (no real accounts; never run from a sandbox) |

## Remaining limitations
- Integration (MongoDB) and browser suites were not re-run in the Task 7 environment; rely on the 2026-11-17 record until step 1 below is repeated.
- Task 5 findings P5-01 to P5-07 (persistent disk, `ENV_STRICT`, off-site backups, partial backup encryption, manual backup without key, non-atomic restore, WhatsApp template mismatch) are **still open in code/config**; Task 6/7 changed documentation only.
- Live Razorpay, WhatsApp, Gemini, SMTP and MSG91 have only mocked/service tests.
- Per-identifier sign-up and unknown-login throttles are now MongoDB-backed (Task 8; integration test not yet run). Request rate limits are shared across instances only with `RATE_LIMIT_STORE=mongo`.
- No fallback reconciliation for permanently lost subscription-charge webhooks; no owner alert for a halted subscription.
- GST rates/HSN codes are the store owner's responsibility.

## Exact steps before production deployment
1. Use Node 22 LTS locally and on Render; run `npm ci` then `npm test` with `MONGODB_URI` pointing at a **test** database (name must contain `test`), e.g. `docker compose -f docker-compose.test.yml up -d && MONGODB_URI=mongodb://127.0.0.1:27018/storva_test?directConnection=true npm test`. Require 0 failures.
2. Install Playwright (`npm i -D playwright && npx playwright install chromium`) and run `node --test test/module6.browser.test.js`. Require 12/12.
3. Fix the open High findings from `docs/TASK-5-PRODUCTION-CONFIGURATION-AUDIT.md` (P5-01 to P5-06): add a persistent disk at `/var/data` in `render.yaml`, set `ENV_STRICT=true` and gate start on `npm run check:env`, enforce `BACKUP_KEY` in the manual backup script, validate decryption before `restore --drop`, and set up an off-site backup copy.
4. Fix P5-07: align `WA_TPL_REFUND` in `.env.example` with the code default (`storva_refund_processed`) and write the missing WhatsApp templates document.
5. Create MongoDB Atlas cluster with a dedicated least-privilege user, TLS and network allowlisting for Render.
6. On Render, enter every variable from `.env.example` in the dashboard (never commit a real `.env`). Generate fresh `SESSION_SECRET`, `OTP_SECRET`, `SECRETS_KEY`, `BACKUP_KEY`, `HEALTH_TOKEN`; store `SECRETS_KEY` and `BACKUP_KEY` outside Render as well. Set `APP_URL` to the final HTTPS domain, `PLATFORM_ADDRESS`, `RATE_LIMIT_STORE=mongo`.
7. Run `NODE_ENV=production npm run check:env` with the production values; require 0 errors.
8. Razorpay: complete KYC, register webhook `APP_URL/webhooks/razorpay` with the same secret, then in test mode do one order, one full refund, one plan purchase and confirm the webhooks arrive. Switch to live keys only afterwards.
9. WhatsApp: register `APP_URL/webhooks/whatsapp` with the verify token and app secret, get templates approved, send one message each way.
10. Gemini: one product-description call. SMTP: one real email (SPF/DKIM/DMARC set). MSG91: one OTP with DLT-approved template.
11. Run `npm run check:integrations` (review output before sharing; do not use send flags without approval).
12. Take one backup, restore it into a scratch database, compare counts.
13. Add an uptime monitor on `GET /api/ready` and an `ALERT_WEBHOOK_URL` receiver; monitor backup age.
14. Only then point DNS at Render and announce.

---
Historical record follows.

# STORVA implementation status (2026-11-17)

Legend: **VERIFIED** = actually run and passing. **MOCKED** = run with a fake external service. **NOT RUN** = needs real accounts.

Environment of this pass: Node 22, MongoDB 7 replica set (real transactions/unique indexes), Playwright + Chromium.

## Test results (`MONGODB_URI=mongodb://127.0.0.1:27018/storva_test?directConnection=true npm test`)
**400 tests: 389 pass, 0 fail, 11 skipped.** The 11 skipped are `module6.browser.test.js`, which needs the `playwright` package; run separately with it installed: **12/12 pass** (`NODE_PATH=<dir with playwright> node --test test/module6.browser.test.js`).
Manual browser walk-through (Chromium, strict CSP): landing page + login button, dashboard Home / Analytics / Shipping & tax, order detail + GST tax invoice, storefront checkout re-pricing by state (South India zone, COD fee, GST included, COD blocked for an excluded region). No CSP violations or page errors.

| Area | Status |
|---|---|
| 1-6 Core, auth, stores, products, storefront, Razorpay | VERIFIED (integration + browser suite); live Razorpay NOT RUN |
| 7 Designer | VERIFIED |
| 8 Plans & billing | VERIFIED; live subscription charge NOT RUN |
| 9 AI tools | MOCKED (Gemini); live key NOT RUN |
| 10 WhatsApp | MOCKED (Graph API + signed webhooks); live number NOT RUN |
| 11 Customers | VERIFIED |
| 12 Shipping & GST, invoices | VERIFIED (incl. parallel invoice numbering) |
| 13 Notifications | VERIFIED queue/retries/preferences; live SMTP/WhatsApp delivery NOT RUN |
| 14 Analytics | VERIFIED (visitor counting, sales maths, plan tiers, exports, GST summary) |
| 15 Hardening | VERIFIED (CSP on all pages, readiness, encrypted backup → restore round trip incl. tamper detection, shared rate-limit store) |

## Production-readiness pass (2026-11-18)
Added: opt-in auto-renew (Razorpay Subscriptions), scheduled encrypted backups, MongoDB connect retry, production environment check (`check:env`), live read-only integration check (`check:integrations`), SMTP timeouts/TLS. Status: 23 new unit tests pass; MongoDB-backed tests, the dashboard UI and all live services NOT RUN in the environment that wrote this. Details: `docs/PRODUCTION_INTEGRATIONS.md`.

## Still open / by design
- (Resolved in Task 8) Per-identifier sign-up / unknown-login throttles were in memory per instance; both are now MongoDB-backed. Request rate limits can be shared with `RATE_LIMIT_STORE=mongo`.
- Cancelling a paid online order does not refund automatically; the owner refunds from the order page.
- GST rates/HSN are the owner's responsibility; the app validates format and calculates, it does not give tax advice.

---
Historical record of the 2026-11-16 pass follows.

# STORVA implementation status (2026-11-16)

Legend: **VERIFIED** = actually run and passing. **UNIT** = covered by offline unit/in-memory tests only. **WRITTEN** = code exists, never run. **BLOCKED** = could not be run here. Nothing is "complete" merely because code exists.

Environment of this pass: no npm registry, no MongoDB, no Docker daemon, no Razorpay, no browser tests possible. Result: **nothing at integration level is VERIFIED.**

## Test results (this pass, `npm run test:unit`)
219 tests: 207 pass, 1 fail, 11 skipped. The one failure is `module1.test.js` ("Cannot find module 'express'", dependencies not installed). The 11 skips are the Playwright suite. 18 of the 219 are new (`test/hardening.unit.test.js`).
Not run: 8 MongoDB integration files, 11 Playwright tests, any Razorpay call, `package-lock.json` generation.

## Modules 1-6
| Area | Status |
|---|---|
| 1 Server, security middleware, landing | WRITTEN (syntax-checked) |
| 2 Auth, OTP, sessions, recovery | UNIT (6) + WRITTEN; integration BLOCKED. Enumeration + throttle fixes below: UNIT/static only |
| 3 Stores, tenant isolation | UNIT (4) + WRITTEN; isolation over real HTTP + MongoDB BLOCKED |
| 4 Products, variants, images | UNIT (8) + WRITTEN; BLOCKED |
| 5 Storefront, cart, orders, coupons | UNIT (16) + WRITTEN; BLOCKED |
| 6 Razorpay, webhooks, refunds, reconciliation | UNIT + in-memory service tests (~150); live Razorpay BLOCKED |

## Fixed in this pass (code written; unit/static tested only, NOT run against MongoDB/browser)
1. **Account enumeration at registration.** Registering with an existing verified email/mobile now answers exactly like a new sign-up (201, same body, same hashing cost) and sends nothing. Per-identifier sign-up cap (5/hour) gives a real 429 for new and existing identifiers alike.
2. **Account enumeration at login.** Locked real accounts and repeatedly-failed unknown identifiers now give the same 429 `too_many_attempts` after the same 5 failures. (Code changed from `account_locked`; `module2.integration.test.js` updated to match; not run.)
3. **Throttled OTP answered 201.** The 30 s resend cooldown silently keeps the earlier still-valid code; the response now carries `resendAfterSec: 30`. The hourly cap returns 429. (Same answer for existing accounts, so it cannot be used to probe.)
4. **Stock restoration after refund.** A FULL refund of a pending/confirmed order now cancels it and returns stock + coupon use exactly once (compare-and-set on `inventoryReleased`). Shipped/delivered orders are deliberately NOT restocked (goods may be with the buyer). Partial refunds never restock.
5. **Abandoned pending-order cleanup.** Unpaid online orders older than `ABANDON_ORDER_MINUTES` (default 120, min 30) are cancelled and their stock released, only after Razorpay confirms no captured/authorized payment exists; skipped on any gateway error or when Razorpay is not configured. A payment landing mid-run wins (paymentRev compare-and-set). A late capture on a cancelled order is flagged by the existing "paid_on_cancelled_order" logic and needs a manual refund. Runs as a background timer (`ABANDON_CLEANUP_ENABLED=false` to disable) and repairs missed post-refund stock returns.
6. **CSP.** Public storefront (`/store/*`) now sends a strict CSP: no `unsafe-inline`/`unsafe-eval` in `script-src`, `script-src-attr 'none'`, `object-src 'none'`, `base-uri 'self'`. The only inline script was moved into `storefront.js`. `STOREFRONT_CSP=relaxed` restores the old policy if Razorpay Checkout turns out to need it. **UNVERIFIED in a real browser, including the real Razorpay window. Run the Playwright suite and one real test payment before relying on it.**
7. `render.yaml`: added Razorpay variables and `UPLOAD_DIR`.

## Still open (not fixed; do not treat as done)
- **CSP on dashboard/landing is still relaxed** (`unsafe-inline` + `unsafe-eval`): they use Tailwind's CDN build and inline `onclick` handlers (`index.html`, `app.js`, `auth.js`, dashboard). Needs a Tailwind build step and handler rewrite; testable only in a browser.
- Throttles are in-memory per instance (multi-instance deployments multiply the limits).
- `scripts/reconcile.js` (separate process) does not return stock itself; the web process's background sweep does.
- `package-lock.json` missing; `npm install` BLOCKED here.
- Cancelling a paid online order does not start a refund automatically.
- Tenant-isolation, idempotency and atomic-stock claims are backed by code review and fake-store tests only; real MongoDB atomicity is unproven.
- Module 3 unverified: Step 3 ZIP provenance gap noted in the handoff report.
- Modules 7-15: NOT STARTED.

## Automatic refund system (added after the merge audit)
Audit result: manual refunds, webhooks and Razorpay reconciliation already existed; cancelling a paid online order did **not** refund it, refund progress notifications were limited to "processed" (and only when a webhook won the race), and the buyer's order page just said "contact the store".
Added: `services/autoRefund.js` + `autoRefundJob.js` (trigger, sweep, retry, verification, exhaustion), `services/refundEvents.js` (one place that turns ledger changes into `order.refund_initiated / refunded / refund_failed`), `source: 'auto'` ledger entries, buyer refund state on the order page, owner/buyer messages. Status: unit + fake-backed service tests pass (20 new tests); **not yet run against real MongoDB / Razorpay test mode**.
