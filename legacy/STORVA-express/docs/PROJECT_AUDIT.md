# STORVA project audit (2026-11-19, Task 8 update)

Task 8: unknown-login throttle is now MongoDB-backed and atomic (see `IMPLEMENTATION_STATUS.md` and `TASK-8-FINAL-REPORT.md`); the "throttles in memory" finding below is resolved in code but its integration test is NOT RUN. All Task 5 High findings (P5-01..P5-06) remain open.

# Earlier update (Task 6)

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

## Open findings (carried forward)
| Severity | Finding | Source |
|---|---|---|
| High | No persistent disk declared in `render.yaml` | P5-01 |
| High | Preflight errors do not block startup (`ENV_STRICT` unset) | P5-02 |
| High | No off-site backup or restore drill | P5-03 |
| High | Uploads and manifest not encrypted; plaintext staging | P5-04 |
| High | Manual backup can run unencrypted in production | P5-05 |
| High | Restore can drop a collection before decryption is validated | P5-06 |
| Medium | `WA_TPL_REFUND` mismatch; WhatsApp templates doc missing | P5-07 |
| Resolved (Task 8, integration test not run) | Sign-up / unknown-login throttles in memory per instance | earlier audit |
| Low | Real-account lockout counter is not a single atomic gate under heavily parallel guesses | Task 8 review |

## Remaining limitations
- Integration (MongoDB) and browser suites were not re-run in the Task 7 environment; rely on the 2026-11-17 record until step 1 below is repeated.
- Task 5 findings P5-01 to P5-07 (persistent disk, `ENV_STRICT`, off-site backups, partial backup encryption, manual backup without key, non-atomic restore, WhatsApp template mismatch) are **still open in code/config**; Task 6/7 changed documentation only.
- Live Razorpay, WhatsApp, Gemini, SMTP and MSG91 have only mocked/service tests.
- Per-identifier throttles are now MongoDB-backed; request rate limits can be shared via `RATE_LIMIT_STORE=mongo`.
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

# STORVA project audit (2026-11-16, static review + offline unit tests)

Scope: 94 JS files, 12 routes, 11 models, 10 services, 4 middleware, 25 test files. Method: reading the code, `node --check`, unit tests. **No runtime audit was possible** (no npm registry, MongoDB, Docker or Razorpay). Findings below are from code review; "OK by review" is not "verified".

## Reviewed and OK by review
- Sessions: opaque token, only HMAC stored; HttpOnly + SameSite=Lax (+Secure in prod); origin guard on state-changing requests.
- Passwords scrypt; OTP HMAC-hashed, atomic attempt counting, single-use via compare-and-set.
- Tenancy: `tenantScoped` plugin rejects unscoped queries; owner routes resolve the store with `{_id, owner}`; foreign store = 404. Order/Coupon/Counter code paths contain no `skipTenant` (unit-tested). Intentional global lookups exist only for webhooks and reconciliation (gateway ids, writes store-scoped).
- Payments: server-side HMAC signature check; webhook raw body + constant-time HMAC + idempotent ledger + paymentRev compare-and-set; refunds reserve-first with idempotency key.
- Stock: atomic conditional `$inc`, rollback on failure, release once via `inventoryReleased`.

## Found and fixed this pass (see IMPLEMENTATION_STATUS.md for details)
Account enumeration (register + login lockout), OTP throttle answered 201, no stock return after a full refund, no cleanup of abandoned online orders (stock stayed reserved forever), storefront CSP allowed inline + eval script, `render.yaml` lacked Razorpay/upload variables, unit-test count drift.

## Found, NOT fixed
| Severity | Finding |
|---|---|
| Medium | Dashboard + landing CSP still `unsafe-inline`/`unsafe-eval` (Tailwind CDN + inline handlers) |
| Medium | Throttles in-memory per instance |
| Medium | No `package-lock.json`: installs are not reproducible |
| Low | Registration deletes never-verified accounts that share an email/mobile with a new sign-up (an attacker can reset someone's pending sign-up) |
| Low | Cancelling a paid online order does not trigger a refund |
| Low | README drift (older test counts) beyond the status banner |
| Info | Duplicated concerns: none found that justify merging; webhook, refund and reconciliation share `applyToOrder` by design |

## Not audited (needs a running system)
Real HTTP isolation tests, MongoDB atomicity, Razorpay payload shapes, CSP in browsers, upload handling under load, performance.
