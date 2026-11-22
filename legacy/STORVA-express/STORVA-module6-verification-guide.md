# STORVA – Module 6 verification guide (run on your own computer)

Checkpoint: `STORVA-module6-step4-checkpoint.zip` (sha256 `09770b1d14b7186e4ef4796bf6c7d51c4c3350955a57fb0498589d54fa16c30b`).
Nothing in this guide has been run against MongoDB, a browser or Razorpay. Expected results below are what the checkpoint's own README and test files say should happen. They are **expectations, not results**.

Rules while you verify
- Use a **throwaway database** whose name contains `test` (the suites refuse otherwise).
- Use **Razorpay Test Mode keys only** (`rzp_test_...`). Never put live keys in `.env` while testing.
- A **skipped test is not a pass.** Always read the `# skipped` line.
- If something fails, copy the exact output and send it back. Do not edit tests or code to make it green.

---

## 0. Prerequisites

| Need | Why | Check |
|---|---|---|
| Node.js 20 or newer (`package.json` engines) | everything | `node -v` |
| npm and internet access | `npm install` | `npm -v` |
| MongoDB 6/7: Docker **or** a local `mongod` | integration tests, running the app | `docker -v` or `mongod --version` |
| Chromium via Playwright | browser suite | installed in step 4 |
| Razorpay account in **Test Mode** | step 5, 6 | Dashboard → toggle "Test Mode" |
| A public HTTPS tunnel (ngrok / cloudflared) | Razorpay must reach `/webhooks/razorpay` | `ngrok -v` or `cloudflared -v` |

Unzip into a fresh folder and work there. Keep the original ZIP untouched.

---

## 1. `npm install`

```bash
cd storva-checkpoint
npm install
```
**Expected:** finishes without `ERR!`; a `node_modules/` folder and a new `package-lock.json` appear (none exists in the checkpoint; keep and commit it).
**Failure signs:** `ENOTFOUND` / `ETIMEDOUT` (network/proxy), `EBADENGINE` (Node too old). Send the last 30 lines.

---

## 2. Unit tests

```bash
npm run test:unit
```
Look at the summary lines at the bottom: `# tests`, `# pass`, `# fail`, `# skipped`.

| | Sandbox result (reproduced independently on this checkpoint) | Expected on your machine after `npm install` |
|---|---|---|
| tests | 201 | 201 |
| pass | 189 | 190 |
| fail | 1 (`module1.test.js`: `Cannot find module 'express'`) | 0 |
| skipped | 11 (browser suite, needs Playwright) | 11 until step 4 is done |

**Pass condition for this step:** `# fail 0`. The 11 skips are *not* passes; they are closed in step 4.
**Failure signs:** any line starting `not ok`. If `module1.test.js` still fails after install, it is a real finding (it was never run before). `Cannot find module` for another package means install is incomplete.

---

## 3. MongoDB integration tests

Start a disposable database (port 27018, data in RAM):
```bash
docker compose -f docker-compose.test.yml up -d
```
Run the suites:

macOS / Linux
```bash
MONGODB_URI=mongodb://127.0.0.1:27018/storva_test npm run test:integration
```
Windows PowerShell
```powershell
$env:MONGODB_URI="mongodb://127.0.0.1:27018/storva_test"; npm run test:integration
```
(Without Docker: start your own `mongod` and use `mongodb://127.0.0.1:27017/storva_test`.)

Eight files run: modules 2, 3, 4, 5 and the four Module 6 files (`integration`, `webhook`, `refund`, `reconcile`). The README declares about 77 tests; the runner's own total is the number that counts.

**Pass condition:** `# fail 0` **and** `# skipped 0`.
**Signs it did not really run:** `# skipped 8`-ish, or lines ending `# SKIP set MONGODB_URI...` (URI missing or database name lacks `test`); exit code 2 with "No MongoDB available".
**Failure signs:** `ECONNREFUSED` / `MongooseServerSelectionError` (database not up: `docker compose -f docker-compose.test.yml ps`); `not ok` lines (note the test name and the assertion diff).
These suites have **never run**, so a first-run failure is plausible and would be useful information, not a surprise. They stub only `api.razorpay.com`, so they never contact Razorpay.

Clean up: `docker compose -f docker-compose.test.yml down -v`

---

## 4. Playwright browser tests (11 tests)

```bash
npm i -D playwright --no-save      # --no-save keeps package.json unchanged; a later `npm install` removes it again
npx playwright install chromium
node scripts/run-tests.js unit     # or only: node --test test/module6.browser.test.js
```
On Linux, if Chromium will not launch: `npx playwright install-deps chromium`.

**Pass condition:** the 11 browser tests show `ok` with no `# SKIP`, and the overall run shows `# fail 0 / # skipped 0`.
**Failure signs:** still `# SKIP needs the ejs and playwright packages` (Playwright not installed in this folder); `browserType.launch` errors (Chromium or system libraries missing); assertion failures (send the test name and message).
Scope: this drives the real checkout/order pages against a mock API and a fake Razorpay window. It does **not** test the dashboard, and it is not a real Razorpay test.

---

## 5. Razorpay Test Mode verification

### 5.1 Setup
1. `cp .env.example .env`, then set: `MONGODB_URI` (a test database, e.g. `mongodb://127.0.0.1:27018/storva_dev`), `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (Test Mode keys), `RAZORPAY_WEBHOOK_SECRET` (a long random string you invent), and `APP_URL` = your tunnel URL (the origin check compares against it).
2. Start the tunnel to port 3000, e.g. `ngrok http 3000`.
3. In Razorpay Dashboard (Test Mode) → Webhooks → add `https://<tunnel-host>/webhooks/razorpay`, the same secret, events `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`. Keep payment capture on **automatic**.
4. `npm run dev`. Startup must not print a `[env]` warning about the webhook secret. Open the **tunnel URL** in your browser (not localhost).
5. Register an account. With no SMS/SMTP configured the OTP is printed in the server console as `[dev-otp]`. Create a store and one product (price ≥ Rs 1), then open `/store/<slug>`.

Use the test payment details from Razorpay's Test Mode documentation (success and failure UPI IDs, test cards, net banking). Do not invent card numbers.

### 5.2 Checklist (record result and the order number for each)

| # | Action | Expected | Where to confirm |
|---|---|---|---|
| A | Checkout with **Pay online**, pay successfully | Order page shows paid; owner Orders shows `Online · paid` | Dashboard → Orders / Payments |
| B | Same, with a **failing** payment, then retry and pay | failed message, then paid on retry (same Razorpay order) | order page |
| C | After A: Razorpay Dashboard → Webhooks → deliveries | `payment.captured` delivered with HTTP **200** | Razorpay Dashboard |
| D | Same event delivered twice (use "resend") | second answer is 200 `duplicate` | server log; `webhookevents` collection |
| E | Forged call (below) | HTTP **400**, nothing written | terminal |
| F | **Partial** refund from Payments tab | refund `processed`, order stays paid, shows partially refunded | Payments tab; Razorpay Dashboard → Refunds |
| G | **Full** (remaining) refund | order becomes `refunded`; stock unchanged | Payments tab |
| H | Double-click Refund | exactly one refund at Razorpay | Razorpay Dashboard |
| I | Reconciliation scenario (section 6) | see section 6 | script output |
| J | Confirm the refund **idempotency header is accepted** | no Razorpay error on F/G | server log; Razorpay API logs |

Forged webhook (E):
```bash
curl -i -X POST https://<tunnel-host>/webhooks/razorpay \
  -H "Content-Type: application/json" -H "X-Razorpay-Signature: deadbeef" \
  -d '{"event":"payment.captured"}'
```
Expected: `HTTP/... 400`. A `200` here would be a serious bug.

**Failure signs:** webhook deliveries showing 400 (secret mismatch, or a proxy re-encoding the body), 503 (webhook secret not set), 409 (retry will follow; check for refund-before-capture ordering); `payments_unavailable` 503 at checkout (keys missing); `gateway_error` / 502 (keys wrong or Test/Live mix-up); refund stuck `pending` (see reconcile); Razorpay rejecting `X-Refund-Idempotency` (J).

Optional inspection (`mongosh storva_dev`):
```js
db.orders.find({paymentMethod:"razorpay"},{orderNumber:1,paymentStatus:1,refundedPaise:1,refunds:1}).sort({_id:-1}).limit(5)
db.webhookevents.find().sort({_id:-1}).limit(10)
db.reconciliationissues.find()
```

---

## 6. Reconciliation dry-run

Create the "missed webhook" situation (Test Mode):
1. Place an online order. In the Razorpay checkout window pay successfully, but **before** STORVA confirms, stop it from hearing the result: easiest is to delete (or disable) the webhook in Razorpay Dashboard first and close the browser tab right after paying. The order stays `pending` locally.
2. Reconciliation only looks at orders 15+ minutes old (`RECONCILE_MIN_AGE_MINUTES`, minimum 2). For a quick test set `RECONCILE_MIN_AGE_MINUTES=2` in `.env`, and wait 2 minutes.
3. Stop `npm run dev` if you want to avoid the background job acting first (it starts 60 s after boot), or set `RECONCILE_ENABLED=false`.

Dry-run (writes nothing):
```bash
node scripts/reconcile.js --dry-run
```
**Expected:** JSON with `"dryRun": true`, `scanned >= 1`, your order listed as one that *would* change to paid, `"aborted": false`, exit code 0 (`echo $?`). Confirm in `mongosh` the order is **still** `pending`.

Real run:
```bash
node scripts/reconcile.js
```
**Expected:** `applied >= 1`; the order is now `paid`. Run it again: the order is unchanged (`noop`, `paymentRev` not bumped).

**Failure signs:** exit code 1 with "Online payments are not configured" (keys missing); `aborted: true` (credentials rejected or Razorpay unreachable); `scanned: 0` (order too young, already settled, or checked in the last 30 min); an entry under `issues` (needs a human; also see the Payments tab → "Needs your review"); the order changing during `--dry-run` (serious bug: stop and report).
Also try the dashboard button: Payments → order detail → **Check with Razorpay**.

---

## 7. What to send back

For each step: pass/fail, the `# tests / # pass / # fail / # skipped` lines (steps 2–4), the failing test names with output, and for step 5 the A–J table filled in. Anything not run stays "unverified".
