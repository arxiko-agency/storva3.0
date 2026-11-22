# Testing and verification

| Suite | Command | Needs | What it proves |
|---|---|---|---|
| Unit rules | `bunx vitest run src/lib` | nothing | GST maths (inclusive/exclusive, CGST/SGST vs IGST), delivery and COD rules, financial-year invoice years, rupees in words, plan limits, order transitions, theme schema (safe links, colours, image paths, limits), contrast checks, CSV formula-injection guard, AI tool access |
| Webhook | `bunx vitest run src/routes` | nothing (database mocked) | Razorpay webhook refuses when unconfigured (503), rejects missing/wrong signatures (401) without touching the database, accepts a correctly signed event, ignores a replay |
| Backend integration | `bunx vitest run src/test/integration` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auto-skips without them) | against the real database with two throwaway merchants: signup creates profile + Free plan; signed-out visitors read nothing; checkout/rate limiter/tracker are server-only; merchant B cannot read or change A's products, orders, settings, design, notifications or audit log; GST/delivery/COD totals; unserviceable states; COD blocks; input + stock validation; idempotent checkout; sequential invoice numbers; invalid status jumps; stock restored on cancel; notifications + outbox + retries; low-stock alerts; audit log; published-vs-draft design; analytics de-duplication; GST/HSN report; rate limit 10/10 min; Free plan 10-product limit. Cleans up after itself. |
| Routing smoke | `bunx vitest run src/test/app-routing.test.tsx` | nothing | app routes resolve |
| Browser journey | `bun run test:e2e` (`python3 e2e/storva_flow.py`) | dev server on :8080 + the three server variables above + Playwright | signs in, sets shop link, adds a product with photo/sale price/HSN, saves GST & delivery, edits the design with click-to-edit, publishes and checks history, shopper adds to cart and places a COD order (₹236 + ₹40), merchant confirms, invoice shows CGST/SGST, notification appears, analytics loads, AI studio generates a Malayalam title, phone-width shop has no sideways scroll, no page errors. Screenshots in `/tmp/browser/e2e`. |

`bun run test` (or `npm test`) runs every Vitest suite.

## Latest results (2026-11-18, this delivery)
- Vitest: **11 files, 84 tests passed, 0 failed** — 50 rule tests, 3 webhook, 1 routing, 30 backend integration.
- Browser journey: **16 / 16 checks passed**.
- All 12 merchant/shop pages opened at 390 px and 1280 px: no sideways overflow after one fix (Settings on phones), no page errors.
- Security scan: 1 informational note (plan prices are publicly readable — intentional).
- Fresh copy of the delivered ZIP: `npm install` (579 packages), `npx vitest run` (84/84) and `npm run build` all succeeded.
- No pre-existing test failures. Pre-existing install issue: plain `npm install` crashed (`Cannot read properties of null (reading 'edgesOut')`) because of the original `rolldown` override; fixed by the added `.npmrc`.

## Not verified (needs credentials or real-world setup)
- Razorpay Test Mode checkout and real webhook deliveries — keys and webhook secret not configured.
- Email sending (Gmail connector not connected) — emails are queued and marked "skipped" until connected.
- WhatsApp sending, catalog sync, template approval — WhatsApp Business not connected.
- Shiprocket automatic tracking — not built; manual tracking only.
- The hourly notification job has been scheduled but a scheduled run has not yet been observed.
- Migration of the original site's users, orders and photos — no export files supplied.
