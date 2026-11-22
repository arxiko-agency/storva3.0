# STORVA roadmap
Status per module is in `IMPLEMENTATION_STATUS.md`. "Written" never means "verified".

| # | Module | State |
|---|---|---|
| 1-6 | Skeleton, Auth, Stores/tenancy, Products, Storefront/orders, Razorpay payments + webhooks + refunds + reconciliation | Done; integration-tested on real MongoDB; checkout browser suite passes |
| P0 | Install, lockfile, integration, Playwright, tenant isolation | Done (live Razorpay test-mode payment still to do with real keys) |
| 7 | Store designer and themes | Done, tested |
| 8 | Subscriptions and plan gating | Done, tested (live Razorpay subscription charge not run) |
| 9 | Gemini AI product tools | Done, tested with a mocked Gemini (live key not run) |
| 10 | WhatsApp Cloud API | Done, tested with a mocked Graph API (live number not run) |
| 11 | Customers | Done, tested |
| 12 | Shipping and GST | Done, tested |
| 13 | Notifications | Done, tested (live SMTP/WhatsApp delivery not run) |
| 14 | Analytics and reports | Done, tested |
| 15 | Security + production hardening | Done, tested |
| T5 | Production configuration audit | Report done; findings P5-01..P5-07 open |
| T6 | Documentation refresh | Done (2026-11-19) |
| T7 | Final test run + ZIP delivery | Done: unit 313/324 pass, 0 fail; integration not re-runnable in sandbox |

| T8 | Auth throttling (unknown-login moved to MongoDB; sign-up verified durable) | Code + unit tests done; integration NOT RUN |

## Next (in order)
1. Re-run integration + Playwright suites on a real MongoDB (includes the new `throttle.durable.integration.test.js`).
2. Fix P5-01..P5-07 (disk, `ENV_STRICT` gate, backup key enforcement, safe restore, off-site backups, WhatsApp templates).
3. Live provider checks with real accounts (see the list below and `IMPLEMENTATION_STATUS.md` "Exact steps").
4. Optional: subscription-webhook fallback reconciliation, halted-subscription owner alert.


Before launch (needs real accounts, cannot be done in a sandbox): one Razorpay test-mode order + refund + webhook, one plan purchase,
one WhatsApp message each way, one Gemini call, one SMTP email and MSG91 OTP, a restore drill from a real backup, uptime monitor on `/api/ready`.
