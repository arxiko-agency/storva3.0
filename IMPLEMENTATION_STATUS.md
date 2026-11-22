# Implementation status — 2026-11-18

Legend:
- **Tested** — exercised by an automated test in this delivery (see [docs/TESTING.md](docs/TESTING.md)).
- **Implemented, untested** — code is in place and builds, but no test exercised it end to end.
- **Credential-dependent** — code is in place; it cannot work or be verified until the named credential/connection is added.

| Module | Tested | Implemented, untested | Credential-dependent |
|---|---|---|---|
| Sign-in & accounts | email/password sign-in (browser), signup creates profile + Free plan (integration), signed-out access blocked (integration) | Google and Lovable sign-in buttons, password reset email, "sign out everywhere" | — |
| Products & store link | add/edit with photo, sale price, HSN, category (browser); per-store isolation (integration); private photo storage + signed URLs (browser) | delete product, bulk edits | — |
| 7 Store designer | presets, live preview, click-to-edit, publish, version history (browser); schema/contrast/safe-link rules (unit); draft not visible to shoppers, cross-store overwrite blocked (integration) | drag-and-drop reordering in the browser (rule tested only), restore & restore-and-publish, logo/banner upload, all section types individually | — |
| 8 Subscriptions | plan limits (unit + integration: Free stops at 10 products); webhook signature, refusal and replay handling (webhook test) | trial start, plan change, cancel screens | **Razorpay** keys + webhook secret: paid checkout, renewals and real webhook deliveries are **not verified** |
| 9 AI studio | real Malayalam title generation counted against the Free quota (browser); tool access by plan (unit) | other 7 tools, photo extraction, history panel | — (uses Lovable AI) |
| 10 WhatsApp | message rules (unit) | drafts and template screens | **WhatsApp Business** connection: sending, templates, catalog sync, webhook — **not verified** |
| 11 Customers | COD block enforced at checkout, isolation (integration) | edit, erase, order history screens | — |
| Orders | COD checkout, confirm, invoice (browser); totals, idempotency, stock, transitions, cancel restores stock (integration) | live-update indicator, resend alert | email alert needs **Gmail** |
| 12 Shipping & GST | settings save, CGST/SGST invoice ₹236 + ₹40 (browser); IGST, state rates, free delivery, COD rules, unserviceable states, FY invoice numbering, HSN report (unit + integration) | manual tracking entry screen, print-to-PDF output | Shiprocket automatic tracking **not built** (needs Shiprocket credentials) |
| 13 Notifications | in-app new-order notice (browser); notification + outbox rows, low-stock alert, retry/give-up after 5 attempts (integration) | preferences screen, delivery log, daily summary, hourly job run (scheduled but not yet observed) | **Gmail** for email delivery; **WhatsApp** for WhatsApp delivery — messages are queued and marked skipped until connected |
| 14 Analytics | funnel, sources, visitor de-duplication, GST report, 1-year range limit (integration); page loads (browser); CSV rules (unit) | CSV download buttons, charts over multiple days | — |
| 15 Security | server-only checkout/rate limiter/tracker, rate limit 10 per 10 min, audit log, row-level isolation (integration); security scan (1 informational note) | security headers in production, health endpoint output after publish | — |

## Known issues / limitations
- Not published yet; the production URL, published webhooks and the scheduled job's real runs are unverified.
- Original site's users, orders and photos were not migrated (no export provided). Imported users would need to verify their email and choose a new password.
- Content-Security-Policy is intentionally moderate (no `script-src`) so the app's streaming hydration keeps working.
- Delivery and COD fees are treated as non-taxable on invoices; confirm with your accountant.
- This is **not** declared production-ready: payments, email and WhatsApp have not been verified.
