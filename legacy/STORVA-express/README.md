> **Status (2026-11-19, Task 8):** Modules 1-15 plus refunds, affiliates and production checks are implemented. Task 8 moved the last in-memory auth throttle (unknown-account login) into MongoDB; sign-up was already durable (Task 2). `npm run test:unit` in the Task 8 sandbox: **303 tests, 284 pass, 7 test files could not load** (no `express`/`mongoose` in that sandbox; the same 7 files fail identically on the unmodified Task 7 source), 12 skipped. MongoDB integration suites, including the new `test/throttle.durable.integration.test.js`, were **NOT RUN**. **Not production-ready:** Task 5 findings P5-01..P5-07 are open, integration suites must be run on a real MongoDB, and live providers are untested. See `docs/TASK-8-FINAL-REPORT.md` and `docs/IMPLEMENTATION_STATUS.md`.

> **Status (2026-11-17): Modules 1 to 15 are implemented and runtime-verified against a real MongoDB replica set.**
> `npm test` with `MONGODB_URI` set: **400 tests, 389 pass, 0 fail, 11 skipped**; the 11 skipped are the Playwright checkout suite, which was run separately with Playwright installed: **12/12 pass**. A manual browser walk-through of the landing page, dashboard (Home, Analytics, Shipping & tax, order + GST invoice) and storefront checkout was done under the new strict security policy.
> **Not verified (needs real accounts):** live Razorpay payments/subscriptions, live WhatsApp Cloud API delivery, live Gemini AI, live MSG91 SMS and SMTP email. Those paths are covered by mocked/service tests only. Older status notes further down are kept as a historical record.

# STORVA SaaS – WhatsApp-to-Web store builder

Node.js + Express + MongoDB (Mongoose). Vanilla JS admin UI (`public/`). EJS renders the Module 5 storefront from `views/storefront/`.

## Run locally
```bash
npm install
cp .env.example .env      # then fill in the values (see below)
npm run dev               # http://localhost:3000
npm test
```

## MongoDB Atlas setup
1. Create a free account at https://www.mongodb.com/cloud/atlas and a free **M0** cluster.
2. **Database Access** → Add user (username + password, "Read and write to any database").
3. **Network Access** → Add IP. For local dev add your IP; for Render add `0.0.0.0/0` (and keep the password strong).
4. **Connect → Drivers** → copy the `mongodb+srv://...` string into `MONGODB_URI` in `.env`, replacing `<password>` and adding the database name (`/storva`) before the `?`.

## Deploy on Render
1. Push this project to a GitHub repo (the repo root is the folder containing `package.json`).
2. Render → New → **Blueprint** (uses `render.yaml`) or New → Web Service: build `npm ci --omit=dev`, start `npm start`, health check `/api/ready`.
3. Add every variable from `.env.example` in the Render dashboard (Environment). Set `APP_URL` to your Render URL.
4. Webhook URLs: Razorpay (implemented in Module 6 Step 3) → `POST /webhooks/razorpay`, i.e. `APP_URL/webhooks/razorpay` (not under `/api`); WhatsApp → `APP_URL/webhooks/whatsapp` (platform number; stores that connect their own number get a private URL shown in the dashboard).

## Authentication (Module 2)
Sessions are opaque random tokens in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production); only an HMAC of the token is stored in MongoDB, so a database leak cannot be replayed. Passwords use scrypt. OTPs are 6 digits, HMAC-hashed, valid 10 minutes, single-use, burned after 5 wrong guesses, 30 s resend cooldown, 5 sends/hour per identifier. 5 wrong passwords lock the account for 15 minutes. State-changing requests with a foreign `Origin` are rejected.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | `{name,email,phone,password,verifyVia:"email"|"phone"}`, sends a code |
| POST | `/api/auth/register/verify` | `{identifier,code}`, verifies and logs in |
| POST | `/api/auth/login` | `{identifier,password}` (identifier = email or mobile) |
| POST | `/api/auth/otp/send` | `{identifier,purpose:"login"|"register"|"reset"}`, same response whether or not the account exists |
| POST | `/api/auth/otp/login` | `{identifier,code}` |
| POST | `/api/auth/password/forgot` / `/reset` | `{identifier}` then `{identifier,code,password}` (revokes all sessions) |
| POST | `/api/auth/password/change` | logged in: `{currentPassword,newPassword}` |
| GET/PATCH | `/api/auth/me` | current user / update name |
| POST | `/api/auth/logout`, `/logout-all` | end this / all sessions |
| GET/DELETE | `/api/auth/sessions`, `/sessions/:id` | list / revoke devices |

**Delivery.** SMS goes through MSG91 (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`; the template must contain the `##OTP##` variable and be DLT-approved for India). Email goes through SMTP (`SMTP_*`). In development, if a provider is not configured the code is printed to the server console (`[dev-otp]`); in production a missing provider returns HTTP 503. Codes are never returned in API responses.

## Stores and multi-tenancy (Module 3)
- `Store` is the tenant root; `owner` is set from the session only. Every owner route resolves the store with one query `{_id, owner}` (`middleware/tenant.js`), so another user's store is always **404**, identical to a non-existent id.
- Every tenant-owned collection in later modules MUST use `models/tenantScoped.js`: it adds a required `store` field and makes any query without a plain `store` filter (including `findById`, operators like `$ne`, unscoped aggregates) throw. Opt-out is explicit: `.setOptions({ skipTenant: true })`.
- Later modules mount under `/api/stores/:storeId/...` (see `scoped` router in `routes/stores.js`) and register delete cleanup with `registerCascade`.
- Slugs: 3 to 30 chars, `a-z 0-9 -`, reserved words blocked, old slugs stay reserved (last 5) so links cannot be hijacked.

| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/stores/slug-check?slug=` | public |
| POST/GET | `/api/stores` | owner (verified) |
| GET/PATCH/DELETE | `/api/stores/:storeId` | owner only |
| GET | `/api/stores/:storeId/overview` | owner only |
| GET | `/api/showcase` (alias `/api/public/showcase`, used by the landing page) | public, opted-in stores; only name, slug, tagline, logoUrl, cover, url |

Dashboard UI: `/dashboard.html`. Env: `MAX_STORES_PER_USER` (default 1).

## Storefront, cart, checkout, orders and coupons (Module 5, implemented, runtime-unverified)
Public pages are server-rendered with EJS (`views/storefront/`), styled by `public/css/storefront.css` (same palette, Bricolage Grotesque font and STORVA logo badge as the main site, mobile first) and made interactive by `public/js/storefront.js`. They read the same service (`src/services/storefront.js`) as the public JSON API, so pages and API can never disagree.

| Page | URL |
|---|---|
| Store home: branding, logo, tagline, collections chips, search, sort, product grid, pagination | `/store/:slug` (`?collection=<slug>&q=&sort=&page=`) |
| Product detail: gallery, variant pickers, live price and stock, quantity, add to cart, WhatsApp link, related products | `/store/:slug/product/:productSlug` |
| Cart (priced by the server, quantity edit, remove, coupon) | `/store/:slug/cart` |
| Checkout (delivery form, order summary) | `/store/:slug/checkout` |
| Order confirmation (needs the secret token from checkout) | `/store/:slug/order/:orderNumber?t=<token>` |

A renamed store's old address answers **301** to the new one. Unknown or suspended stores, draft products and other stores' products give a 404 page.

**Public API** (no login, `/api/public/stores/:slug/...`; the store is taken from the slug, only `active` products are returned):

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | branding (name, tagline, description, logo, WhatsApp, email, address) + collections with product counts |
| GET | `/products` | `collection`, `q`, `category`, `sort` (`newest|price_asc|price_desc|title`), `page`, `limit` (max 48) |
| GET | `/products/:productSlug` | one product (variants expose `maxQty`, never exact stock) |
| POST | `/cart/quote` | `{items:[{productId,variantId?,qty}], couponCode?}` returns server-priced lines, subtotal, discount, total, `canCheckout` |
| POST | `/coupons/validate` | `{code, items}` same engine as checkout |
| POST | `/orders` | checkout: `{name,phone,email?,address:{line1,line2?,city,state,pincode},note?,items,couponCode?,idempotencyKey?}` returns `201 {order, token, url}` (`200 replayed:true` for a repeated key) |
| GET | `/orders/:orderNumber?t=` | the buyer's own order |

**Owner API** (login + own store only, under `/api/stores/:storeId/...`):

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/orders?status=&q=&page=` | list (search by number, name, phone) |
| GET/PATCH | `/orders/:orderNumber` | detail; PATCH `{status?, paymentStatus?}` |
| GET/POST | `/coupons` | list / create `{code,type:"percent"|"fixed",value,minOrder?,maxDiscount?,usageLimit?,startsAt?,expiresAt?,description?}` |
| GET/PATCH/DELETE | `/coupons/:couponId` | the code itself is immutable; `active` toggles it |

Dashboard (`/dashboard.html`): new **Orders** and **Coupons** tabs (`public/js/dashboard-m5.js`) and a link to the live storefront.

**How it works**
- **Cart.** The browser keeps only product ids and quantities (`localStorage`, per store). Names, prices, stock, coupon and totals always come from `POST /cart/quote`, and `POST /orders` re-prices everything; a price sent by the browser is ignored.
- **Tenant isolation.** `Order`, `Coupon` and `Counter` use the `tenantScoped` plugin; every query in Module 5 carries `{store}` and no Module 5 file uses `skipTenant` (unit-tested). A cart line whose product belongs to another store is simply "no longer available". An order link only works under its own store's address and with its token.
- **Stock.** Reserved with an atomic conditional `$inc` per line (never below zero, also for parallel orders). If any later step fails, everything already reserved is given back. Cancelling an order returns stock and the coupon use exactly once (compare-and-set on `inventoryReleased`).
- **Coupons.** Percent (optional cap) or fixed; minimum order; start/expiry; total-use limit enforced atomically (`usedCount < usageLimit`); codes unique per store, case-insensitive. A fixed coupon can never push the total below zero.
- **Orders.** Per-store numbers from 1001 (atomic counter); line items are snapshots, so later product edits or deletion do not change old orders; `pending -> confirmed -> shipped -> delivered`, `cancel` only from pending/confirmed; status changes are compare-and-set. `idempotencyKey` makes a double submit return the same order.
- **Safety.** All page output is escaped (`<%=`); `<%-` is only used for includes and a `<`-escaped JSON data block (unit-tested); client code never builds HTML strings. Checkout is rate limited per IP (`CHECKOUT_RATE_LIMIT`, default 20 per 10 min; `QUOTE_RATE_LIMIT`, default 60 per min).

**Not in Module 5 (deliberately)**
- Payment is **cash on delivery** only (`paymentMethod: "cod"`); online payments (Module 6 Step 2) and webhooks (Module 6 Step 3) were added afterwards, see the Module 6 sections below.
- No shipping charges or taxes (shipping is always Rs 0); no per-customer coupon limits; no customer accounts or customer list yet (customer details are stored on each order); no order emails/WhatsApp notifications (Module 10); no store designer/themes (Module 7).
- The storefront CSS is hand-written (no Tailwind dependency); the existing CSP keeps its relaxed script rules until the final hardening module.

**Existing files touched (mount points and UI hooks only; Modules 1-4 logic unchanged):** `src/routes/stores.js` (enabled the `orders` mount and added `coupons`), `src/routes/index.js` (mounted the public API), `src/app.js` (mounted `/store` pages before the static handler), `public/js/dashboard.js` (two extra tabs and a storefront link), `public/dashboard.html` (one script tag), `public/css/dashboard.css` (appended rules), `.env.example` (two rate-limit variables).

## MSG91 check (against MSG91's v5 OTP docs)
`POST https://control.msg91.com/api/v5/otp` with `authkey` header and `template_id`, `mobile`, `otp`, `otp_expiry` as query parameters matches the documented contract. The mobile number must be digits with country code and no `+` (we send `91XXXXXXXXXX`). MSG91 can answer HTTP 200 with `{"type":"error"}` for a bad key; `delivery.js` already treats that as a failure. Not yet verified with a live key and an approved DLT template.

## Testing
```bash
npm test                    # every test/*.test.js; integration suites self-skip when MONGODB_URI is unset (they show as SKIP, not pass)
npm run test:unit           # unit tests + module1 (module1 needs `npm install`; no database)
npm run test:integration    # needs a real MongoDB; exits with code 2 and instructions if none is available
```
`npm test` uses `scripts/run-tests.js`. The old script `node --test test/` fails on Node 21+ (a directory is no longer expanded), so it was replaced.

Ways to get a test database (database name must contain `test`; the suites refuse otherwise):
```bash
# a) Docker (port 27018)
docker compose -f docker-compose.test.yml up -d
MONGODB_URI=mongodb://127.0.0.1:27018/storva_test npm run test:integration
# b) your own mongod
MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration
# c) in-memory (downloads a mongod binary on first run)
npm i -D mongodb-memory-server && npm run test:integration
```
Declared tests: module1 5 | module2 unit 6, integration 10 | module3 unit 4, integration 13 | module4 unit 8, integration 13 | module5 unit 16, integration 11. Total 86, of which 34 unit tests have been executed (see Verification status).

## Module checklist
Legend: `[x]` implemented; `[~]` implemented but runtime-unverified (integration and browser runs not done); `[ ]` not started. "Implemented" means the code is written and unit/statically checked, not run end to end (see "Verification status").

- [x] **1. Skeleton, frontend split, landing additions** (server, config, security middleware, health, Terms/Privacy, About, gallery shell, WhatsApp button)
- [x] 1b. Landing redesign pass (services marquee with pause, step bullets, extended FAQ, footer contact/Instagram, placeholder testimonials removed)
- [~] 2. Auth: MSG91 + email OTP, sessions, rate limits. Code complete; 6 unit tests pass; integration suite (10 tests) NOT executed
- [~] 3. Stores and slugs, multi-tenant isolation, showcase API. 4 unit tests pass; integration suite (13 tests) NOT executed
- [~] 4. Products, variants, collections, image uploads. 8 unit tests pass; integration suite (13 tests) NOT executed
- [~] 5. Public EJS storefront, cart, checkout, orders, coupons. Implemented (code written); 16 unit tests pass (pure logic + static view/client checks); integration suite (11 tests) NOT executed; pages and UI never run in a browser. Customers list and shipping/tax not included (see Module 5 section); online payment was added later in Module 6
- [~] 6. Razorpay customer payments + webhook. **Partly implemented:** Step 2 (online payment at checkout + payment API) and Step 3 (webhooks, `POST /webhooks/razorpay`) are implemented, runtime-unverified (unit and in-memory service tests pass; MongoDB integration, browser and real Razorpay runs NOT done). Step 4 not started; refund initiation, owner payment screens and reconciliation not built
- [x] 7. Store designer and themes saved to DB (sections, colours, fonts, draft/publish, version history)
- [x] 8. Subscriptions (Razorpay) and plan gating (Free / Pro / Advanced limits and features, GST plan invoices, grace period)
- [x] 9. Gemini AI product tools (descriptions, titles, tags, translations, product from photo, monthly credits)
- [x] 10. WhatsApp Cloud API (owner commands, photo → draft product, shopper order lookup, STOP opt-out, own number, QR, share kit)
- [x] 11. Customers (built from orders, segments, search, notes/tags, COD block, CSV export, data erasure)
- [x] 12. Shipping & GST (regions, delivery days, PIN blocks, COD fee/limit, GST incl/excl, CGST+SGST / IGST, HSN, numbered tax invoices)
- [x] 13. Notifications (in-app bell, email + WhatsApp with retries, per-store preferences, message log, daily summary)
- [x] 14. Analytics & reports (cookie-less visitors, sales, funnel, sources, states, busy hours, top products, CSV + GST filing exports)
- [x] 15. Security & production hardening (strict CSP everywhere, compiled Tailwind, request ids, readiness check, alerts, shared rate limits, encrypted backups/restore, lockfile)

## Modules 11–15 in short (what an owner gets)

**Customers (11).** Every order creates/updates one customer per phone number; totals are recomputed from orders (cancellations and refunds included). Segments: new, repeat, VIP (3+ orders or ₹5,000+), inactive (90+ days), COD-blocked. Search, tags, private notes, COD block per number, CSV export (Pro, formula-injection safe), and erasure of a customer's personal data (only when no open orders).
API: `GET/PATCH/DELETE /api/stores/:id/customers[/:customerId]`, `GET .../customers/export.csv`.

**Shipping & GST (12).** Delivery: free / flat / by region (states, charge, free-above, delivery days, COD per region) plus blocked PIN codes. COD: on/off, extra fee, maximum order value. GST: GSTIN (check-digit validated; the business state comes from it), legal name, address, default rate (0, 0.25, 3, 5, 12, 18, 28, 40 %), per-product rate + HSN, prices incl./excl. GST, GST on delivery fees. Checkout re-prices live as the shopper picks the state / PIN / payment method; same-state orders get CGST + SGST, other states IGST. A tax invoice number (`PREFIX/26-27/00001`, sequential per financial year, never duplicated even under parallel requests) is created when the order ships or with "Create invoice"; owner and buyer can open a printable invoice (Rule 46 fields, amount in words, CANCELLED stamp).
API: `GET/PUT /api/stores/:id/shipping`, `POST .../shipping/preview`, `POST/GET .../orders/:n/invoice`, buyer `GET /store/:slug/order/:n/invoice?t=…`.

**Notifications (13)** and **WhatsApp (10)**: see the dashboard tabs; email/WhatsApp messages go through a queue with retries (1, 5, 30, 120, 360 min) and a per-store log.

**Analytics (14).** Visitors are counted without cookies and without storing IPs (keyed daily hash; bots, link previews, prefetches and draft previews ignored). Free: last 7/30 days overview (sales, orders, average order, visitors, conversion, daily chart, comparison). Pro: any range up to a year, top products, payment split, new vs returning, best weekdays, coupons, CSV exports. Advanced: funnel (visit → product → cart → checkout → order → paid), traffic sources (WhatsApp/Instagram/Facebook/Google/QR…; share links and the QR code are tagged automatically), sales by state, busy-hours heat map, product conversion, and a GST filing summary (B2B / B2C / HSN, CSV) by invoice date. Sales = non-cancelled orders except unpaid online ones; net = total − refunds; days are India time. The dashboard also has a new **Home** tab (today, what needs attention, last 7 days).
API: `GET /api/stores/:id/analytics?days=7|30|90|365` or `?from=&to=`, `GET .../analytics/export/{orders,products}.csv`, `GET .../analytics/gst[/b2b|b2c|hsn.csv]`.

**Hardening (15).**
- Strict Content-Security-Policy on every page: no inline/eval/third-party script except Razorpay Checkout; inline event handlers removed; Tailwind is compiled (`npm run build:css` → `public/css/tailwind.css`, committed). `APP_CSP=relaxed` is an emergency escape hatch only.
- `X-Request-Id` on every response; server errors return `requestId` + `ref` matching one JSON log line. `ALERT_WEBHOOK_URL` sends de-duplicated alerts (Slack/Discord) for server errors, failed background jobs and crashes.
- `GET /api/health` (liveness) and `GET /api/ready` (database ping; with `Authorization: Bearer $HEALTH_TOKEN` also jobs, message queue, error counters, memory). Point UptimeRobot / Render at `/api/ready`.
- `RATE_LIMIT_STORE=mongo` shares rate limits across instances. `LOG_HTTP=json` gives structured access logs.
- `package-lock.json` is committed; deploy with `npm ci --omit=dev`.

### Backups
```bash
BACKUP_KEY=<32+ random characters> npm run backup        # -> backups/storva-YYYYMMDD-HHMMSS/ (db + uploads, checksummed, encrypted)
npm run restore -- backups/storva-20261117-020000 --yes                # into an EMPTY database (MONGODB_URI)
npm run restore -- backups/storva-20261117-020000 --drop --yes          # replace existing collections
npm run restore -- <folder> --only=orders,products --drop --yes         # just some collections
```
Checksums are verified before anything is written; non-empty collections are never overwritten without `--drop`; restoring with `NODE_ENV=production` also needs `--i-know-this-is-production`. Sessions, OTPs and rate-limit counters are not backed up. Old backups beyond `BACKUP_KEEP` (14) are deleted. Run it daily (cron) and **copy the folder off the server** (Google Drive, S3, another disk). Keep `BACKUP_KEY` safe: without it an encrypted backup cannot be read. Test a restore into a scratch database once a month.

## Verification status (historical record, 2026-11-15; superseded by the status at the top)
Last verification pass: 2026-11-15, in a sandbox with **no network** (`npm install` fails with ENOTFOUND on registry.npmjs.org) and **no MongoDB**. Nothing below was run against Express, Mongoose or a database.

| Check | Result |
|---|---|
| `node --check` on every `.js` file (`src/`, `server.js`, `public/js/`, `test/`, `scripts/`) | passed |
| Unit tests (module2 6, module3 4, module4 8, module5 16) | **34 passed, 0 failed** |
| `npm install` | **NOT run successfully** (no network); no `package-lock.json` exists yet |
| `test/module1.test.js` (5 tests, needs express) | **FAILS here: `Cannot find module 'express'`** (dependencies not installed; not a code verdict) |
| Module 2 integration (10 tests) | **NOT run** (needs MongoDB) |
| Module 3 integration (13 tests) | **NOT run** (needs MongoDB) |
| Module 4 integration (13 tests) | **NOT run** (needs MongoDB) |
| Module 5 integration (11 tests: public API, isolation, quote, coupons, checkout, stock/coupon races, rollback, owner orders, cascade) | **NOT run** (needs MongoDB) |
| Module 5 EJS templates | **NOT rendered by the real `ejs`** (not installable). Structure checked by unit tests, and once smoke-rendered with a throwaway minimal EJS-compatible shim (8 templates, tags balanced, hostile titles escaped); this is weaker evidence than the real engine |
| Module 5 storefront and dashboard in a browser (responsive layout, cart, checkout) | **NOT run** (server cannot start without dependencies) |
| Dashboard against the real API in a browser | **NOT run** (server cannot start without dependencies; only statically cross-checked) |
| Live MSG91 / SMTP delivery | **NOT run** (needs credentials) |

`npm test` in this sandbox reports 39 tests: **34 pass, 1 fails (module1, `Cannot find module 'express'`), 4 skipped (the four integration suites; module5's suite holds 11 tests that did not run).** Exact command: `npm test` (= `node scripts/run-tests.js`), run 2026-11-15; `# tests 39 / # pass 34 / # fail 1 / # skipped 4`.

Module 5 additionally: `node --check` passes on every `.js` file; every API path used by `public/js/storefront.js` exists in `src/routes/public.js` (unit-tested); dashboard calls were cross-checked by hand against `routes/orders.js` and `routes/coupons.js`. A code review pass found and fixed two bugs before delivery (the order API's `shipping` key overwrote the address; `router.param` lost the slug argument through `asyncHandler`), which shows how much remains unproven until the integration suite runs.

Static cross-check done: every API path called by `public/js/auth.js`, `landing-extras.js` and `dashboard.js` maps to an existing route with a matching method and body shape.

Fixed in the 2026-11-15 pass:
- `npm test` (`node --test test/`) failed on Node 21+; replaced by `scripts/run-tests.js`.
- Image upload cap: the atomic guard checked `images.9` and would have allowed up to 10 images under concurrent uploads; it now follows `MAX_IMAGES` (8).
- Dashboard `showErrors` silently dropped server field errors that had no matching input (for example `collections`); it now falls back to a toast.
- In development, `originGuard` rejected every browser POST when `PORT` was not 3000 and `APP_URL` was unset; it now also accepts an Origin equal to the request Host (production behaviour unchanged).
- README test counts corrected (integration suites declare 13 tests for Module 3 and 13 for Module 4, not 15).

Modules 1 to 4 stay marked **unverified** until `npm install && npm test && npm run test:integration` pass on a machine with internet and MongoDB.

### Known issues (not fixed)
- Registration returns 409 `account_exists` for a verified email or mobile, which reveals that the account exists (the OTP and password-reset endpoints are generic).
- `POST /auth/register` answers 201 even when the code send was throttled (cooldown or hourly cap), so the UI can say "code sent" when none was.
- The `helmet` default CSP includes `upgrade-insecure-requests`; some browsers (Safari) may fail to load assets over plain `http://localhost`. Not reproduced.
- CSP still allows `'unsafe-inline'` and `'unsafe-eval'` (Tailwind CDN and inline handlers); scheduled for Module 10.
- `/store/:slug` (linked from the showcase) is now served by Module 5 code, but it has never been run (see Module 5 section).
- Module 5 known gaps (online payment was added later, in Module 6): no shipping/tax, no per-customer coupon limit, no customers list, no order notifications; the cart is per browser (`localStorage`), so it is not shared across devices.
- Uploaded images live on local disk (`UPLOAD_DIR`); on Render this needs a persistent disk.
- No `package-lock.json`; run `npm install` once online and commit it.

## Branding: STORVA logo
The uploaded logo is stored byte-for-byte at `public/images/storva-logo.png` (verified identical to the upload). `public/css/logo.css` shows it at its true aspect ratio (4.03:1) using CSS only; the file is never edited. Used in: landing header (top-left), login/register panels, dashboard sidebar, `/dashboard.html`, Terms and Privacy headers. The wordmark is white, so on light backgrounds it sits on a dark (#14122B) badge; on the dark login panel it is shown directly. Verified in headless Chromium: image loads (577px natural width), no failed requests, frame 156x39 on desktop and 132x33 on mobile. Page title, footer and copy text still say "STORVA" (set via `BRAND_NAME` / `CONFIG.brand`); change those if you want the name to read STORVA everywhere.

Logo coverage (verified in headless Chromium, desktop and mobile): the full STORVA logo appears 5 times on the landing page (header, login panel, mobile login, app sidebar, footer) plus `/dashboard.html`, Terms and Privacy; all load at 577px natural width. Favicons (`favicon.ico`, 32px, 180px apple-touch) are the cart mark cropped from your uploaded file, not redrawn, because the full wordmark is unreadable at 16 to 32px. Also fixed: the landing gallery called `/api/public/showcase`, which did not exist; it is now served (response shape also fixed). The landing page requests `/api/*` which 404'd in my static-only check, so the live gallery/auth flow is still unrun.

## Module 4: products, variants, collections, images (written, integration NOT run)
All routes are owner-only under `/api/stores/:storeId/...`; every query carries `store` (tenantScoped plugin). Money is sent/received in rupees, stored as integer paise.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/products?q&status&category&collection&minPrice&maxPrice&inStock&sort&page&limit` | search/filter/sort/paginate |
| POST | `/products` | create (title, price; optional options+variants, collections, tags, stock) |
| GET/PATCH/DELETE | `/products/:productId` | read / edit / delete (variant ids stay stable across edits) |
| PATCH | `/products/:productId/stock` | `{stock}` or `{delta}` (+`variantId`), atomic, never below zero |
| POST | `/products/:productId/images` | raw JPEG/PNG/WebP body (max 5 MB, 8 per product), validated by magic bytes, random server filename |
| DELETE | `/products/:productId/images/:imageId` | remove image and file |
| GET / POST | `/products/categories`, `/products/categories/rename` | categories derived from products |
| CRUD | `/collections`, `PUT /collections/:id/products` | collections and membership (own products only) |

Env: `UPLOAD_DIR` (use a persistent disk in production; Render's default disk is wiped on deploy), `MAX_PRODUCTS_PER_STORE` (default 50; replaced by plan limits in Module 8).
Dashboard: `/dashboard.html` has real Products, Collections and Store settings tabs; the old demo dashboard tabs (fake data) are no longer reachable after login. Customers, Payments, Designer, Billing, WhatsApp and Analytics tabs do not exist yet because their modules are not built (the Orders and Coupons tabs came with Module 5).

## Branding
Brandly was renamed to STORVA everywhere (env default, titles, metadata, footer, cookie name `storva_sid`, slug reservation keeps both names). Existing users are signed out once because the cookie name changed.

## Project status (honest)
| Module | State |
|---|---|
| 1 to 3 | implemented (code written); **runtime-unverified**; 18 unit tests pass (module2 6, module3 4, with module4 8); integration suites never executed |
| 4 | implemented (code written); **runtime-unverified**; 8 unit tests pass; integration suite (13 tests) never executed |
| 5 Storefront, cart, checkout, orders, coupons | **Implemented, runtime-unverified**; 16 unit tests pass; integration suite (11 tests) never executed; no browser run; payment was COD only until Module 6 Step 2 |
| 6 Razorpay payments | **Code-complete: Step 2 (checkout + payment API), Step 3 (webhooks), Step 4 part 1 (refunds + owner Payments tab) and part 2 (payment reconciliation) implemented, runtime-UNVERIFIED** (unit and in-memory service tests pass; MongoDB integration, browser and real Razorpay runs NOT done: see the Step 4 part 2 section for the exact list) |
| 7 Designer and themes | **NOT STARTED** |
| 8 Subscriptions and plan gating | **NOT STARTED** |
| 9 Gemini AI | **NOT STARTED** |
| 10 WhatsApp Cloud API + final hardening | **NOT STARTED** |

**Runtime verification is still incomplete.** Implemented does not mean verified: none of the integration suites (Modules 2 to 6) have been run against MongoDB, the browser suite (`test/module6.browser.test.js`) has not been run, nothing has been exercised against a real Razorpay account (test or live), and `npm install` has not succeeded in the sandbox (no `package-lock.json`). Only unit tests, in-memory service tests and static checks have run (84 tests: 72 passed, 1 failed (`module1.test.js`, dependencies not installed), 11 skipped; see "Verification status" and the Module 6 sections).

## Module 6 (step 2): online payment at checkout (written, NOT run against MongoDB, a browser or Razorpay)

**Shopper flow.** Checkout offers *Pay online* (Razorpay window: UPI, debit card, credit card, net banking) and *Cash on delivery*. Online is preselected only when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set; otherwise checkout is COD only and nothing from Razorpay is loaded. The order is saved first (`paymentMethod: razorpay`, `paymentStatus: pending`), then the Razorpay window opens. Payment is never retried by placing a second order; a failed or closed payment is retried from the order page.

**Security.** The secret is read only in `src/services/razorpayApi.js` and `src/services/payments.js`. The browser receives the public key id, the Razorpay order id and the amount taken from the saved order. An order becomes `paid` only when `POST .../payment/verify` confirms the HMAC-SHA256 signature (`order_id|payment_id`) with the server secret and the Razorpay order id matches the one created for that order. Browser-reported success is never trusted. CSP allows only `checkout.razorpay.com`, `api.razorpay.com` and `lumberjack.razorpay.com`; Razorpay's script loads only when the shopper pays online.

| Method | Endpoint (public, needs the order `token`) | Purpose |
|---|---|---|
| POST | `/api/public/stores/:slug/orders` | now accepts `paymentMethod: "cod" \| "razorpay"` (default `cod`) |
| POST | `/api/public/stores/:slug/orders/:n/payment` | creates (once) and returns the Razorpay order for Checkout; retries reuse it |
| POST | `/api/public/stores/:slug/orders/:n/payment/verify` | verifies the signature; idempotent; marks `paid` + `paidAt` |

Errors: `payments_unavailable` 503, `already_paid` 409, `order_cancelled` 409, `not_online_order` 400, `amount_too_low` 400 (< Rs 1), `invalid_signature` 400, `gateway_error` / `gateway_unreachable` 502/503.

**UI states.** paid (success page), pending ("Almost there": Pay now / "I have already paid, check status", auto-checks for about a minute after a payment attempt), failed (retry), refunded and cancelled (info). If the connection drops while confirming, the page says "Still confirming" and never "failed", and finishes the confirmation on the order page.

**Owner dashboard.** Orders show `COD · unpaid`, `Online · paid` and so on. "Mark paid" exists only for COD; the API also refuses it for online orders.

**Files changed.** `src/models/Order.js` (new enum values, `paidAt`, `razorpayOrderId`, `razorpayPaymentId`), `src/utils/checkoutInput.js`, `src/services/storefront.js` (placeOrder), `src/routes/public.js`, `src/routes/orders.js`, `src/config/env.js` (`env.razorpay`, startup check), `src/app.js` (CSP), `src/routes/storefrontPages.js`, `views/storefront/{checkout,order}.ejs`, `public/js/{storefront,dashboard-m5}.js`, `public/css/{storefront,dashboard}.css`. New: `src/utils/razorpay.js`, `src/services/razorpayApi.js`, `src/services/payments.js`, `test/module6.{unit,integration,browser}.test.js`. No new npm dependency (the Razorpay API is called with Node's built-in `fetch`).

**Verified in the sandbox:** syntax of every JS file; 40 unit tests (signature maths, proof parsing, checkout validation, CSP/no-secret static check); a smoke test of `payments.js` against an in-memory fake Order and fake gateway (amount from DB, order reuse, bad/foreign signature refused, idempotent verify, already_paid, cancelled, COD, amount_too_low).

**NOT verified (run these before relying on it):**
1. `module6.integration.test.js` (real MongoDB, fake gateway): `npm run test:integration`.
2. `module6.browser.test.js` (11 headless-browser tests with a fake Razorpay window): `npm i -D playwright && npx playwright install chromium && node --test test/module6.browser.test.js`.
3. A real payment in Razorpay **test mode** (UPI, card, net banking), including the ad-blocker / blocked script path.
4. Razorpay's live API response shape for `POST /v1/orders` and the CSP in a real browser with the real Razorpay window (extra Razorpay origins may be needed).
5. `module1.test.js` fails here only because `npm install` was not run (no `dotenv`); it fails identically on the untouched Module 5 zip.

**Not built in step 2 (the webhook arrived in step 3, see below):** the Razorpay webhook (`RAZORPAY_WEBHOOK_SECRET` was unused), so `failed` and `refunded` were displayed but never set by the server; refunds; owner payments/settlements view; auto-cancel of abandoned online orders (their stock stays reserved until the owner cancels them); live key rotation; payment capture-status check via the Razorpay API (verification relies on the Checkout signature, which assumes Razorpay's default auto-capture).

**Note on Step 1:** the uploaded files did not contain the Step 1 backend (no payment routes, models or `env.razorpay`). The payment API above was written to the contract the Step 2 frontend and its mock server expect. If you have a separate Step 1 implementation, merge it against `src/services/payments.js`, `src/models/Order.js` and `src/routes/public.js` instead of keeping both.

## Module 6 (step 3): Razorpay webhooks (written; unit + in-memory tests executed, everything else NOT run)

Webhooks make payment state independent of the shopper's browser: a payment captured after the tab was closed, a failed payment, and refunds all update the order.

### Setup
1. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (step 2) and **`RAZORPAY_WEBHOOK_SECRET`** (a long random string you choose; it is NOT the API key secret). With payments on and no webhook secret the app logs a warning at start and the endpoint answers 503.
2. Razorpay Dashboard -> Account & Settings -> Webhooks -> Add new webhook (use Test mode first):
   - URL: `https://<your APP_URL host>/webhooks/razorpay` (must be public HTTPS; for local work expose the port with a tunnel such as ngrok or cloudflared)
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Active events: `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed` (other events are acknowledged and ignored)
3. Keep payment capture on **automatic**. This build reacts to `payment.captured`; with manual capture the money stays authorized and nothing marks the order paid (the buyer's verify call still does, on the Checkout signature).
4. Dashboard -> Webhooks lists each delivery with its HTTP status, which is the first place to look when something does not sync.

### How an event is handled (`src/routes/webhooks.js`, `src/services/webhooks.js`, `src/utils/razorpayWebhook.js`)
1. **Raw body.** `POST /webhooks/razorpay` is mounted before `express.json()` and read as bytes, because the signature covers the exact bytes. It is outside `/api` (no cookies, no CORS, no origin check) and has its own rate limit (`WEBHOOK_RATE_LIMIT`, default 300/min/IP) and a 256 KB limit.
2. **Signature.** `X-Razorpay-Signature` must equal hex `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` (constant-time compare). Missing, malformed or wrong -> `400`, nothing written, nothing stored. Secret not configured -> `503`. Signed but malformed JSON/entity -> `400`.
3. **Idempotency.** The key is `X-Razorpay-Event-Id` (same for every retry of one event; a body hash if absent). It is claimed with a unique insert into `WebhookEvent` (`src/models/WebhookEvent.js`, 60-day TTL, ids and outcome only, no payload). A processed event answers `200 {duplicate:true}` without touching anything; one being processed right now answers `409` (Razorpay retries); a `failed` claim, or a `processing` claim older than 2 minutes (crashed worker), is taken over.
4. **Compare-and-set.** The order is read, a pure decision is made, and the write succeeds only if `paymentRev` is unchanged (it also protects against the buyer's verify call writing at the same moment). On conflict it re-reads and re-decides, up to 6 times. A webhook can never overwrite a newer state.
5. **Result.** `200` for anything understood, including ignored anomalies (so Razorpay does not retry forever); `409`/`500` when a retry can help.

| Event | Effect |
|---|---|
| `payment.captured` | order `pending`/`failed` -> `paid` (`paidAt`, `razorpayPaymentId`, clears the failure text). Only if the Razorpay order id is ours, amount equals the saved order total, currency is INR and status is `captured`. |
| `payment.failed` | `pending` -> `failed` with the gateway's reason (`paymentError`, owner API only). Never downgrades `paid` or `refunded`; a failed order can be paid again (same Razorpay order). |
| `refund.created` | refund recorded as `created`; order status unchanged. |
| `refund.processed` | refund `processed`; `refundedPaise` = sum of processed refunds; when it reaches the order total the order becomes `refunded`. A partial refund leaves the order `paid` and shows in `refundedAmount` (owner API). |
| `refund.failed` | refund recorded as `failed`; counts for nothing. |

Refund states are one-way: `created` -> `processed` or `failed`; the first terminal state wins. Refunds whose payment we have not recorded yet (their capture has not arrived) get `409`, so Razorpay re-delivers them later.

### Safety rules (what a forged or odd event can and cannot do)
- Without the secret nobody can change an order: unsigned or wrongly signed requests are rejected before any database access.
- A genuine but inconsistent event (wrong amount, other order id, a second different payment on a paid order, refund above the total, changed refund amount) is acknowledged, logged and recorded as `ignored:<reason>` on its `WebhookEvent` row, and changes nothing. Search the ledger for `outcome: /^ignored:(second_payment|amount|refund)/` to find cases needing a human.
- Replayed old events are harmless: idempotency plus state guards (the signature has no timestamp, so replay protection is state-based, not time-based).
- **Stock and lifecycle:** webhooks never touch stock, coupons or the order `status`. Stock is still returned only when the owner cancels (once, by the existing Module 5 code); a failed payment does not release stock (the buyer can retry); a refund does not restock (a refund is not a return). A cancelled order that is paid anyway becomes `paid` so the owner can see money must be refunded; capture-then-refund on a cancelled order ends `refunded` with stock unchanged.
- Model changes (`src/models/Order.js`): `refunds[]`, `refundedPaise`, `paymentError`, `paymentRev`, and **globally unique partial indexes** on `razorpayOrderId` and `razorpayPaymentId` (webhooks look orders up by gateway id before the store is known; those lookups use the explicit `skipTenant` opt-out and every write is store-scoped). If your database already has orders with duplicate gateway ids, index creation fails: none can exist from step 2 code.
- The step 2 verify endpoint now also increments `paymentRev` and clears `paymentError`; no other step 2 behaviour changed.

### Verification status (honest)
Executed in the sandbox (Node 22, no MongoDB, no npm registry, no browser):
- `node scripts/run-tests.js unit`: 84 tests, 72 pass, 11 skipped (browser suite needs Playwright), **1 fail: `module1.test.js`, because `npm install` was not run here (no `dotenv`/`express`); it fails identically on the untouched Module 5 zip.**
- New and executed: `test/module6.webhook.unit.test.js` (18: signature, parsing, every decision branch) and `test/module6.webhook.service.test.js` (14: the real service code against in-memory FAKES of the two models: forged requests, idempotency, 10 parallel deliveries, compare-and-set races, retry/takeover, refund ordering, stock fields untouched). The fakes imitate only the Mongo operations the service uses, so this is evidence for the logic, not for MongoDB behaviour. Deliberately breaking the signature check, amount check, downgrade guard, idempotency claim, both compare-and-set branches, terminal-refund rule and refund-retry rule each made at least one of these tests fail.
- Syntax of every JS file.

**NOT executed / NOT verified:**
1. `test/module6.webhook.integration.test.js` (11 tests: real route, raw body, real MongoDB, stock): needs a database: `MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration`. Until it has run, treat unique-index creation, `$or`/`$exists` filters on real documents, 20-way concurrent delivery, the 413 body limit and the 404 on `/api/webhooks/razorpay` as unproven. The step 2 `module6.integration.test.js` and `module6.browser.test.js` are also still unrun.
2. A real webhook from Razorpay: payload shapes were written from Razorpay's documented format (`payload.payment.entity`, `payload.refund.entity`, `X-Razorpay-Signature`, `X-Razorpay-Event-Id`) and not checked against live deliveries. Verify with Razorpay's "send test webhook" in Test mode and watch `WebhookEvent` outcomes.
3. Behind a proxy that re-encodes the body (some CDNs/WAFs) the signature would fail: the app needs the raw bytes unchanged.

**Not built (later work):** issuing refunds from the dashboard (this step only records refunds made in the Razorpay dashboard or elsewhere); owner screens for refund/failed details and for `ignored` anomalies; `payment.authorized` / `order.paid` / dispute events; a reconciliation job that asks Razorpay about orders stuck `pending`; automatic cancellation of abandoned online orders (their stock stays reserved until the owner cancels); alerting on webhook failures.

---

## Module 6 – Step 4 (Part 1 of 2): Refund management and owner payment dashboard

### What was added
| Area | Files |
|---|---|
| Pure rules (tested without DB) | `src/utils/refundMath.js` (rupee parsing, refundable amount, eligibility, input validation, idempotency keys), `src/utils/paymentView.js` (one place decides the status label) |
| Razorpay refund call | `src/services/razorpayApi.js` -> `createRefund()` (only file that uses the secret; sends `X-Refund-Idempotency`) |
| Refund flow | `src/services/refunds.js` (`initiateRefund`, `retryRefund`) |
| Owner API | `src/routes/payments.js`, mounted in `routes/stores.js` at `/api/stores/:storeId/payments` |
| UI | `public/js/dashboard-m6.js`, new **Payments** tab in `dashboard.js`, a "Payment & refunds" link on online orders (`dashboard-m5.js`), styles in `dashboard.css` |
| Reused/extended | `Order.refunds[]` entries gained optional fields (`idempotencyKey`, `reason`, `source`, `requestedBy`, `error`, status `pending`); `decideRefund` (webhooks) keeps those fields and adopts a pending dashboard entry; `webhooks.applyToOrder` is now exported |

No new collection and no new dependency. Existing webhook behaviour and tests are unchanged.

### Endpoints (all need login + ownership of `:storeId`; another owner's store is always `404`)
- `GET  /payments/summary` – successful / pending / failed counts and amounts, refunded amount, refunds in progress, net collected, COD paid/unpaid.
- `GET  /payments/transactions?status=&method=&q=&page=&limit=` – history. `status`: paid, pending, failed, partially_refunded, refund_pending, refunded. `method`: online (default) or cod. Only whitelisted values reach the query.
- `GET  /payments/:orderNumber` – payment detail with refund ledger, refundable amount, `canRefund` and the reason when not.
- `POST /payments/:orderNumber/refunds` body `{ type: "full"|"partial", amount?: "100.50", reason?, idempotencyKey }`.
- `POST /payments/:orderNumber/refunds/:idempotencyKey/retry` – re-sends a refund whose outcome was never confirmed.

### How a refund stays safe
1. **Server-side validation** against the saved order: online + paid + has a Razorpay payment id; amount parsed from text to integer paise (max 2 decimals, > 0); `amount <= total - processed refunds - in-flight refunds`. "Full" means "everything still refundable", decided by the server. The browser never sends a limit.
2. **Reserve first.** A `pending` ledger entry is pushed with compare-and-set on `paymentRev` before Razorpay is called. Only one refund may be in flight per order, so two different clicks cannot promise the same money.
3. **Idempotency.** The browser sends a request key (kept until the server gives a final answer). The same key again returns the existing refund (`200 replayed`), never a second one; the same key with a different amount is `409`. Razorpay gets a stable `X-Refund-Idempotency` header derived from store + order + key.
4. **Failures.** Razorpay clearly refuses (4xx) -> entry `failed`, money released, owner may start a new refund. Unknown outcome (timeout, network, 5xx, 429) -> entry stays `pending` and reserved; the dashboard shows **Check / retry**, which re-sends with the same key. An answer that does not match what was asked (amount/payment) is not trusted: entry stays reserved with a flag.
5. **Webhook sync.** Dashboard answers and webhooks use the same `decideRefund`. If `refund.created/processed` arrives before our API call returns, it adopts the pending entry (no duplicate, owner's reason kept); a late "pending" answer never downgrades `processed`. Order becomes `refunded` only when processed refunds reach the total; partial refunds keep it `paid` and show as "Partially refunded".
6. **Isolation.** Routes sit behind `requireAuth` + `loadOwnedStore`; every query filters `store: req.store._id` (the Order tenant guard throws otherwise, including for aggregates). Refund requests are rate-limited (`REFUND_RATE_LIMIT`). Responses never contain Razorpay credentials; gateway error text is replaced by fixed messages.

A refund does not restock and does not change the order lifecycle status (same rule as step 3). Suspended stores cannot start refunds (existing non-GET rule).

### Verification status (honest)
Executed here (Node 22, no MongoDB, no npm registry, no browser, no Razorpay):
- `node scripts/run-tests.js unit`: **98 tests, 97 pass, 11 skipped (browser suite), 1 fail: `module1.test.js`**, which fails only because `npm install` was not run here (same as before this step).
- New: `test/module6.refund.unit.test.js` (8: money parsing, limits, eligibility, labels, webhook adoption) and `test/module6.refund.service.test.js` (17: the real refund + webhook services against in-memory fakes and a fake Razorpay: double clicks, 10-20 parallel requests, in-flight blocking, refusal, timeout + safe retry, webhook-first race, compare-and-set, mismatched gateway answer, other-store orders). One real bug (concurrent duplicate clicks all calling the gateway) was found by these tests and fixed.

**NOT executed / NOT verified:**
1. `test/module6.refund.integration.test.js` (real HTTP + real MongoDB + fake Razorpay, includes two-owner isolation on every endpoint): `MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration`.
2. The real Razorpay Refund API. Written from its documented shape (`POST /v1/payments/:id/refund`, `amount`, `speed`, `receipt`, `notes`, `X-Refund-Idempotency` header, statuses `pending/processed/failed`). Try a partial and a full refund in **Test mode** and confirm that the idempotency header is accepted on your account.
3. The dashboard UI was not opened in a browser (syntax-checked only).
4. Razorpay can only refund captured payments; keep auto-capture on (see step 3 notes).

**Done in Part 2:** the reconciliation job that asks Razorpay about refunds stuck `pending`/`created` (see below). **Still not built:** CSV export, refund notifications to buyers, owner screens for `ignored` *webhook* anomalies (reconciliation has its own "Needs your review" list).

---

## Module 6 – Step 4 (Part 2 of 2): Payment reconciliation, testing and finalize

### What it does
Webhooks and the buyer's verify call normally settle every payment within seconds. Reconciliation is the safety net for when they both fail (webhook not configured, Razorpay could not deliver for a day, server down during the capture). It **only reads from Razorpay** (`GET`), compares with the saved order, and moves an order **forward** when Razorpay clearly shows the newer truth. It never captures, refunds, cancels, restocks or changes the order lifecycle `status`.

| Looks at | Selection rule (all must hold) | Can do |
|---|---|---|
| Online orders `pending` or `failed` | has a Razorpay order id; created 15 min to 30 days ago; not checked in the last 30 min | `pending/failed -> paid` (captured payment), `pending -> failed` (every attempt failed, none in progress); a capture that was already refunded is brought up to date with its refunds |
| Paid orders with a refund `pending`/`created` | refund untouched for 10+ min; not checked in the last 30 min | `created/pending -> processed` or `failed`, add a refund made in the Razorpay dashboard, adopt a dashboard refund whose answer was lost (matched by amount) |

### Safety rules (each one has a test that fails if the rule is removed)
1. **Same brain as the webhooks.** Every change goes through `decideCaptured` / `decideFailed` / `decideRefund` (the pure webhook decisions) and the same compare-and-set writer (`applyToOrder`, guarded by `paymentRev`). If a webhook or the buyer's verify call changes the order while we are talking to Razorpay, our write is re-decided from the fresh state (a stale "failed" cannot undo a fresh "paid").
2. **Never downgrades.** The decisions refuse it; in addition `safeDecide` (`src/utils/reconcile.js`) re-checks every change: `paid`/`refunded` can never go back, a recorded payment id is never replaced, `refundedPaise` never decreases, and a refund that reached `processed`/`failed` can never change or vanish. A blocked change is logged as `would_downgrade`.
3. **Idempotent.** A second run (or ten at once, or the background timer plus the cron script) finds the order settled and writes nothing (`noop:already_paid`, `paymentRev` unchanged). Several instances are safe; the worst case is duplicate Razorpay reads.
4. **Razorpay's answer is validated** (id formats, integer amounts, currency, status, which order/payment it belongs to). Amount mismatch, a payment of another order, a second captured payment, an authorized-but-never-captured payment, a refund above the total, a refund Razorpay does not list, a dashboard refund Razorpay never confirmed, a 404 for our order id (typically test/live key mix-up) and unreadable answers all change **nothing**.
5. **Unresolved discrepancies are logged for manual review**: a `console.warn` line (`[reconcile] DISCREPANCY needs review: ...`, once per new issue, not on every run) and a `ReconciliationIssue` row (one per order + code + reference; repeats only bump `occurrences`/`lastSeenAt`). Rows hold fixed text, ids and amounts only (no customer data), are tenant-scoped and are deleted with the store. Issues the same pass can observe again close themselves when the problem disappears; money anomalies (`amount_mismatch`, `second_payment_for_paid_order`, `multiple_captured_payments`) stay open until the owner dismisses them. A dismissed issue is not reopened.
6. **Gateway trouble changes nothing.** Timeout, network error, 429 or 5xx: the order is not marked checked and is retried next run; three in a row stop the run. HTTP 401/403 (rejected credentials) stops the whole run immediately. One failing order never blocks the others.
7. **Bounded load.** At most `RECONCILE_BATCH` (default 50, max 200) orders per pass, one Razorpay call at a time, no re-check of the same order within 30 minutes, nothing older than 30 days. `Order.reconcileCheckedAt` is only a scheduling hint: it is not payment state and never bumps `paymentRev`.
8. **Tenant isolation.** The only cross-store read is the platform scan (explicit `skipTenant`, read-only, in `services/reconciliation.js`); every write is filtered by `store`. Owner endpoints use the normal `requireAuth` + `loadOwnedStore` chain, so another owner always gets `404`.

### How it runs
- **In the web process:** `src/services/reconcileJob.js` starts from `server.js` (first run after 60 s, then every `RECONCILE_INTERVAL_MINUTES`). It does nothing unless `RAZORPAY_KEY_ID/SECRET` are set and `RECONCILE_ENABLED` is not `false`. On Render's free plan the web service sleeps, so also use the cron route below.
- **As a cron job:** `node scripts/reconcile.js` (e.g. a Render Cron Job every 15 min; set `RECONCILE_ENABLED=false` on the web service in that case). `--dry-run` prints what *would* change and writes nothing; `--limit=100`. Exit code 1 if it could not run or stopped early (credentials rejected, Razorpay unreachable).
- **From the dashboard:** Payments tab -> payment detail -> **Check with Razorpay** (any age, any time, safe to press repeatedly) and a **Needs your review** card with a **Dismiss** button.

| Method | Endpoint (login + own store) | Purpose |
|---|---|---|
| POST | `/api/stores/:storeId/payments/:orderNumber/reconcile` | check one order now; `{changed, issues[], nothingToCheck, payment}`; 503 `gateway_unreachable` changes nothing; 400 for COD; 409 `nothing_to_reconcile` if no online payment was ever started |
| GET | `/api/stores/:storeId/payments/issues` | open discrepancies of this store |
| POST | `/api/stores/:storeId/payments/issues/:issueId/dismiss` | owner acknowledges one |

New env (all optional, see `.env.example`): `RECONCILE_ENABLED` (true), `RECONCILE_INTERVAL_MINUTES` (15, min 5), `RECONCILE_MIN_AGE_MINUTES` (15, min 2), `RECONCILE_BATCH` (50), `RECONCILE_RATE_LIMIT` (owner checks per IP per minute, 20).

### Files
New: `src/utils/reconcile.js` (pure rules), `src/services/reconciliation.js`, `src/services/reconcileJob.js`, `src/models/ReconciliationIssue.js`, `scripts/reconcile.js`, `test/module6.reconcile.{unit,service,integration}.test.js`. Changed: `src/services/razorpayApi.js` (two read-only calls), `src/models/Order.js` (`reconcileCheckedAt` + two indexes), `src/routes/payments.js`, `src/config/env.js`, `server.js`, `public/js/dashboard-m6.js`, `.env.example`. No new dependency.

### Verification status (honest)
Executed in the sandbox (Node 22, no MongoDB, no npm registry, no browser, no Razorpay):
- `node scripts/run-tests.js unit`: **156 tests: 144 pass, 1 fail (`module1.test.js`: `Cannot find module 'express'`, dependencies not installed; unchanged from before), 11 skipped (browser suite)**. (The earlier "98 tests" figures in this README did not count skipped tests; this one does.) New: 14 unit tests and 33 service tests (the real reconciliation + webhook code against in-memory fakes and a fake Razorpay that returns raw gateway-shaped JSON, so the real parsing runs; it throws if reconciliation ever tries to create an order or a refund).
- The unit file proves, over a matrix of 1,920 order variants, that the real MongoDB filters select exactly the same orders as the JS selection rules.
- Mutation check: removing each of these made at least one test fail: the in-progress-attempt guard, the downgrade guard, auto-close of issues, the "checked" mark, the dry-run guard, the credential-rejected stop, treating a refunded capture as captured, and the missing-refund report.
- Syntax (`node --check`) of every JS file.

**NOT executed / NOT verified:**
1. `test/module6.reconcile.integration.test.js` (6 tests: real batch with the real query filters on real documents, owner routes, two-owner isolation, tenant guard on the new model): `MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration`. The in-memory fake ignores date filters, so the real `$lte/$gte/$or/$type/$elemMatch` behaviour on documents (including the `reconcileCheckedAt` missing-field case) is unproven until this runs. Same for index creation and the 90-day TTL on closed issues.
2. The real Razorpay read API. The two endpoints, the `{ entity: "collection", count, items }` answer, the payment/refund field names and statuses and the `count` limit (default last 10, max 100, hence `?count=100`) were checked against Razorpay's public API docs on 2026-11-16, but no call was ever made against a live or test account. Shape used: `GET /v1/orders/:id/payments` and `GET /v1/payments/:id/refunds?count=100`, each answering `{ entity: "collection", items: [...] }`; payment `status` (`created`, `authorized`, `captured`, `refunded`, `failed`), `captured`, `amount_refunded`, `error_description`; refund `status` (`pending`, `processed`, `failed`). Try it in **Test mode**: place an online order, close the tab before paying, pay in Razorpay's test checkout, delete the webhook, then run `node scripts/reconcile.js --dry-run` and then without it. A list answer that is not an `items` array is treated as "unreadable" and changes nothing.
3. The dashboard additions (Check with Razorpay, Needs your review) were syntax-checked only, never opened in a browser.
4. `module1.test.js` and the other integration suites (Modules 2 to 6), `npm install`, and the Playwright browser suite are still unrun (see above); nothing here changes that.

### Known limits (not built)
- Only orders still `pending`/`failed` and refunds still in progress are examined. An order that is `paid` here but refunded or never captured at Razorpay is not audited (no full ledger audit / settlement report).
- A payment that Razorpay shows as captured while the local order is `cancelled` and `pending` becomes `paid` (same rule as the webhook): the owner must refund it. Stock is not changed.
- Abandoned unpaid online orders are not cancelled automatically (their stock stays reserved until the owner cancels); reconciliation stops looking at them after 30 days.
- No alerting beyond logs and the dashboard card. `GET /orders/:id/payments` is read without pagination (Razorpay documents none); an order with a very large number of attempts is not expected.
- Running web instances with `RECONCILE_ENABLED=true` on several replicas multiplies Razorpay reads (never changes). Prefer one cron job and `RECONCILE_ENABLED=false` on the web replicas.

---

## Module 6 – Step 4 (final): extra test suites and honest wrap-up

No application code changed in this pass: `src/`, `public/`, `views/`, `scripts/` and every earlier test are byte-identical to `STORVA-module6-step4-part2.zip`. Only three test files were added (and this README updated).

### The three added test files (re-created, not recovered)
The first versions of these three files were written in a scratch copy of the project that no longer existed when this pass started (the sandbox filesystem is reset between tasks, and the Part 2 ZIP did not contain them). They could **not** be recovered, so they were **written again from scratch** against the real code. They are new files that cover the same three areas; they are not the originals, and nothing was copied from memory of the originals.

| File | Tests | What it runs | What it proves |
|---|---|---|---|
| `test/module6.gateway.unit.test.js` | 16 | the real `src/services/razorpayApi.js` with a stubbed `fetch` | URL, Basic auth, `X-Refund-Idempotency`, integer-paise body; ids are URL-encoded; refund answers are classified correctly (4xx = definite refusal; 5xx / 429 / network / timeout / unusable 2xx = **unknown**, money stays reserved); read calls classify `auth` / `not_found` / `transient` / `bad_response`; neither the secret, the auth header nor Razorpay's raw error text ever appears in an error or a log line |
| `test/module6.concurrency.service.test.js` | 12 | the real `refunds.js` + `webhooks.js` against in-memory fakes with deterministic random delays on every read, write and gateway call | 15 parallel clicks with different keys: one gateway call; 20 with the same key: one; parallel partial refunds never promise more than the total; parallel retries reuse one gateway key; a refusal under load releases the money once; a webhook (even delivered 5x at once) racing the API answer adopts the entry once; 30 orders refunded in parallel do not mix; another store's parallel attempt gets 404. After every scenario an invariant check runs (promised money <= total, no duplicate key or refund id, `refundedPaise` = sum of processed entries). One test fails if the revision check is never actually contended |
| `test/module6.routes.unit.test.js` | 17 | the real `src/routes/payments.js` with a fake `express.Router` and fake services (express is not installed) | route table and registration order (`/issues` before `/:orderNumber`); rate limiters on refund, retry and reconcile; the owner's `req.store` / `req.user` are what reach the services (never ids from URL or body); 201 vs 200 for a new refund vs a replay; errors reach `next()`; `method` / `status` filters are whitelisted; pagination is clamped; search text is regex-escaped; every aggregation has a store `$match`; reconcile answers only its four documented fields; store deletion cascades to reconciliation issues |

All three run under `npm run test:unit` (that mode runs every test file except the `.integration.` ones, so no runner change was needed).

**Mutation check (executed):** 13 deliberate breakages of the real code were each caught by at least one of these tests, then reverted (verified byte-identical afterwards): 4xx treated as unknown, 429 treated as a refusal, idempotency header renamed, `count=100` dropped, 401/403 not detected, in-flight guard removed, compare-and-set removed from the reservation, a repeated key always re-sending, detail route removed, `method` filter not whitelisted, search not escaped, refund rate limiter removed, summary without the store filter.

**What these tests cannot prove:** the fakes replace Express, Mongoose and the network. The routes test never ran Express's real routing, middleware order or body parsing; the concurrency test models MongoDB's single-document compare-and-set in-process, it is not MongoDB; the gateway test never talked to Razorpay. They show that the logic is right, not that the deployed system works.

### Final verification status (honest)
Executed in the sandbox (Node 22.23, no MongoDB, no npm registry, no Docker, no browser, no Razorpay):
- `node scripts/run-tests.js unit`: **201 tests: 189 pass, 1 fail, 11 skipped.** The one failure is `module1.test.js` (`Cannot find module 'express'`, because `npm install` could not be run here); it is unchanged from every earlier step. The 11 skipped are the Playwright browser suite. Skipped tests are not claimed as passing. (Before this pass: 156 tests. This pass added 45.)
- `node --check` on every `.js` file in `src/`, `scripts/`, `public/js/`, `test/` and `server.js`.

**NOT executed / NOT verified (unchanged by this pass):**
1. All integration suites for Modules 2 to 6 (real HTTP + real MongoDB): `MONGODB_URI=mongodb://127.0.0.1:27017/storva_test npm run test:integration`.
2. `npm install` and therefore `module1.test.js`, and the real Express / Mongoose / EJS stack.
3. The Playwright browser suite and every dashboard / storefront screen in a real browser.
4. Every Razorpay call against a real Test-mode or Live account (orders, checkout, webhooks, refunds, reconciliation reads). The refund idempotency header in particular must be confirmed on your account.

**First things to run on your machine:** `npm install`, `npm run test:unit` (expect module1 to pass once dependencies exist), then the integration command above with a local MongoDB, then a Razorpay Test-mode walk-through (pay, partial refund, full refund, a missed webhook plus `node scripts/reconcile.js --dry-run`).

Module 6 is code-complete. Modules 7 to 10 are not started.

### Verification pass after the Step 4 tests (what was and was not done)
Base: `STORVA-module6-step4-part2.zip` (a second upload, `..._1.zip`, is byte-identical). The Step 3 ZIP never reached the sandbox, so it was not used.

**Executed (sandbox: Node 22, no network, MongoDB, Docker, browser or Razorpay):**
- `node scripts/run-tests.js unit`: **201 tests: 189 pass, 1 fail (`module1.test.js`, `Cannot find module 'express'`), 11 skipped (browser suite)**. All 8 integration files self-skipped without `MONGODB_URI` (0 run).
- Static review of all 91 JS files: every relative `require` resolves; every third-party package that is required appears in `package.json` (`playwright` and `mongodb-memory-server` are used by test suites only and are intentionally not dependencies: install them to run the browser / in-memory-DB suites); every query on a tenant model (`Order`, `Product`, `Collection`, `Coupon`, `ReconciliationIssue`) filters on `store`, except the deliberate, `skipTenant` platform scan used by reconciliation. This is a read-through plus grep, not a proof.
- Index definitions were READ in the models (tenant-leading compound indexes, partial unique indexes on Razorpay ids, TTL on `ReconciliationIssue` and `WebhookEvent`). They were NOT created or checked in a real MongoDB.
- Finding: four optional env variables (`LOG_HTTP`, `PAYMENT_RATE_LIMIT`, `WEBHOOK_RATE_LIMIT`, `RECONCILE_RATE_LIMIT`) were read by the code but missing from `.env.example`. Documentation fix only: they are now listed (commented out) there. No application code changed. No functional bug was found, but none of the runtime checks below could be performed, so this is not evidence that none exist.

**Still pending (blocked by the environment, nothing here is claimed as passed):**
1. `npm install`, then `module1.test.js` (fails only with `Cannot find module 'express'` here).
2. All integration suites for Modules 2 to 6 against a real MongoDB; index creation, TTL behaviour, real `$or/$type/$elemMatch` filters and tenant isolation over real HTTP.
3. The Playwright browser suite (11 tests, skipped) and a manual look at the Payments tab, refund dialog and "Check with Razorpay".
4. Razorpay Test-mode: checkout, webhooks (signature, retries), partial and full refunds (including acceptance of the `X-Refund-Idempotency` header), reconciliation reads, `node scripts/reconcile.js --dry-run`.
5. Real concurrency against MongoDB (the parallel tests use in-memory fakes).

## Automatic refunds for cancelled paid orders

When an owner cancels (dashboard or WhatsApp `CANCEL`) an order that was **paid online with Razorpay**, STORVA refunds the money automatically. It reuses the existing refund pipeline, so nothing is duplicated:

- **Trigger:** the `order.status_changed → cancelled` event (and a late `order.paid` on an already cancelled order). A 5-minute background sweep (`services/autoRefundJob.js`) repairs anything missed (server down, missed webhook).
- **No duplicates:** every attempt has a fixed request key (`auto-<orderId>-<n>`); `refunds.initiateRefund` reserves the money with a compare-and-set, refuses while another refund is in flight, and Razorpay receives the same idempotency header on every re-send. A new attempt starts only after the previous one *failed*.
- **Records:** each attempt is a normal entry in `order.refunds` with `source: "auto"`, shown in Dashboard → Payments as "automatic (order cancelled)".
- **Status:** refused → `failed` (retry after a growing back-off, up to `AUTO_REFUND_MAX_ATTEMPTS`); unreachable/timeout → stays reserved and is re-sent with the same key; accepted but not finished → checked against Razorpay (`reconciliation`) until `processed` / `failed`. Processed refunds set the order to `refunded` (partial refunds keep it `paid`).
- **Notifications:** buyer email when the refund starts and when it completes (WhatsApp when completed, as before); owner in-app alerts on every failed attempt, plus an email and a buyer email if all attempts fail. The buyer's order page shows the refund state.
- **Manual refunds are unchanged.** After the last failed attempt the order is flagged (`autoRefundExhausted`) and the owner can refund by hand. `AUTO_REFUND_ENABLED=false` turns the automation off.
- **Not covered:** cash-on-delivery orders (money is returned by the owner) and orders already shipped/delivered (they cannot be cancelled).
- Tests: `test/autorefund.unit.test.js`, `test/autorefund.service.test.js` (in-memory fakes; a real-MongoDB + Razorpay test-mode run is still recommended).

## Production integrations (final pass)
Audit of the 12 external integrations, what was added (auto-renew via Razorpay Subscriptions, scheduled backups, MongoDB connect retry, production environment check, live integration check) and what is still not verified: see [`docs/PRODUCTION_INTEGRATIONS.md`](docs/PRODUCTION_INTEGRATIONS.md). Quick start: `npm run check:env`, then `npm run check:integrations` with your real credentials.

## Affiliate and referral program
Personal links (`/r/CODE`), affiliate registration (`/affiliate`), and referral tracking through to commissions on paid plan payments, with admin payouts. Setup, API, rules and decisions: `docs/AFFILIATE_SYSTEM.md`. Settings are the `AFFILIATE_*` keys in `.env.example`.
