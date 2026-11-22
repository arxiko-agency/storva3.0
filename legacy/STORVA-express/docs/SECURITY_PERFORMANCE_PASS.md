# Security and performance pass (2026-11-18)

## Changed
| Area | File | Change |
|---|---|---|
| Payment idempotency | `src/services/billing.js` | `grant()` takes the invoice number only after winning the claim, so racing verify/webhook calls no longer burn numbers (no gaps in the GST invoice series). |
| Background jobs | `src/services/jobs.js` | Each tick has a timeout (`JOB_TIMEOUT_MS`, default 10 min). A hung call is counted as a failure and the job runs again. |
| Authentication | `src/utils/password.js`, `src/routes/auth.js` | scrypt cost raised to N=65536, r=8, p=2. Old hashes still verify and are upgraded at the next successful login (`needsRehash`). |
| CSRF | `src/middleware/auth.js` | A request with no Origin header is refused when the browser says `Sec-Fetch-Site: cross-site`. |
| Audit logging | `src/models/AuditLog.js`, `src/services/audit.js` | Append-only audit trail. Wired to: login, password change, logout-all, refund initiated, order updated. Never throws; strips credential-like keys. |
| Queries | `src/models/Order.js` | Three new indexes for the auto-refund sweep, the refunded-stock repair pass and the Payments tab list. |

## Tests
`test/securityperf.unit.test.js` (5 tests: 4 pass, 1 skipped until `npm install`). Existing offline suites re-run: 53/53 pass. `node --check` passes on every JS file.
**Not run:** MongoDB integration tests, the browser suite, real Razorpay. Run `npm install && npm test` before deploying.

## Notes
- New hashes use about 64 MB per login attempt: keep the login limiter on, and check memory on small instances.
- New indexes are built at startup (`autoIndex`); on a large production database create them in a quiet period.

## Still open (from the review, not changed here)
Image re-encoding / EXIF stripping (needs the `sharp` package), per-store upload quota, fail-closed rate limits for login, cross-tenant route test, `$lookup` guard in the tenant plugin, regex search without index, analytics caching, Sentry-style monitoring, stale-job alerts.
