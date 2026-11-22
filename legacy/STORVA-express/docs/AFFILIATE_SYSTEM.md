# Affiliate and referral system (item E)

Anyone with a verified STORVA account can join, get a personal link, and earn a commission whenever a person they referred pays for a plan.

## How it works
| Step | What happens | Code |
|---|---|---|
| 1. Registration | `POST /api/affiliate/register` (logged in, verified, terms accepted). Gets an automatic 8-character code, or a custom one (4-16 letters/numbers). UPI ID optional until the first payout. | `services/affiliates.js` `joinProgram` |
| 2. Link | `https://<app>/r/CODE` counts one click per visitor (cookie), sets a 30-day first-party cookie `sv_ref`, redirects to `/#signup`. Unknown codes redirect too (no probing). Link-preview bots (WhatsApp, Slack...) are not counted. | `routes/referralLink.js` |
| 3. Sign-up | The code (cookie, or `ref` in the register body) is stored on the new user as `referredByCode`. Unknown / suspended codes are ignored silently. | `routes/auth.js` `/register` |
| 4. Attribution | At the first verified login (`startSession`) the code becomes a `Referral`. One affiliate per person, first one wins (unique index). Own code is refused. | `attributeSignup` |
| 5. Earning | `billing.grant()` emits `plan.activated` with the payment id; the listener writes ONE `Commission` per `BillingPayment` (unique index = exactly once). Only real payments (`razorpay` / `subscription`, amount > 0). | `creditPayment` |
| 6. Payout | Commission is held `AFFILIATE_HOLD_DAYS`, then "payable". A platform admin records a payout (UTR reference); all payable commissions flip to `paid` in one guarded update. Admins can void a pending commission (refund, abuse). | `recordPayout`, `voidCommission` |

Commission = floor(amount paid x rate). The base is the amount the customer paid (as stored on the billing row).

## Settings (`.env`)
`AFFILIATE_ENABLED` (true) · `AFFILIATE_COMMISSION_PERCENT` (20) · `AFFILIATE_MAX_PAYMENTS` (12 per referred customer) · `AFFILIATE_HOLD_DAYS` (30) · `AFFILIATE_MIN_PAYOUT_RUPEES` (500) · `AFFILIATE_COOKIE_DAYS` (30) · `AFFILIATE_SYNC_ENABLED` (true). An individual affiliate can have their own rate (`commissionBps` on the Affiliate row).

## API
| Route | Who | Purpose |
|---|---|---|
| `GET /api/affiliate/program` | public | Program facts for the landing page |
| `GET /api/affiliate/me` | login | Program + my affiliate record (or null) |
| `POST /api/affiliate/register` | login | Join (`{acceptTerms:true, code?, upiId?}`) |
| `PATCH /api/affiliate/me` | affiliate | Update UPI ID |
| `GET /api/affiliate/stats` | affiliate | Funnel (clicks, sign-ups, customers), earnings (pending / payable / paid), last 25 referrals (names masked "Anita K.") and commissions |
| `GET /api/affiliate/admin/list` | admin | All affiliates with balances |
| `POST /api/affiliate/admin/:id/status` | admin | `active` / `suspended` |
| `POST /api/affiliate/admin/:id/payout` | admin | `{reference}` record a payout |
| `POST /api/affiliate/admin/commissions/:id/void` | admin | `{reason}` reverse a pending commission |
| `POST /api/affiliate/admin/sync` | admin | Re-run the repair sweep now |

UI: `/affiliate` (offer, join form, link + WhatsApp share, funnel, earnings, referrals, commissions, UPI). Linked from the dashboard header and the landing footer. The admin side is API-only for now.

## Safety rules built in
- Exactly-once: unique `Commission.billingPayment`; a referral's commission slots are reserved atomically (cap cannot be exceeded by racing payments) and returned if the write fails.
- No self-referral (own code refused; own purchases never earn). Free / dev / admin-granted periods earn nothing.
- Hold period before payout; admin void; suspended affiliates stop earning and tracking.
- Payout is one guarded update, so a double click or two admins cannot pay a commission twice.
- Referred people's email / phone are never shown to affiliates; every endpoint check is server-side; all frontend text uses `textContent` under the strict CSP.
- Crash repair: an hourly job (`affiliate-sync`) credits any paid plan payment whose commission is missing.

## Decisions you may want to change
- **Interpretation:** this is a platform program (affiliates promote STORVA and earn on plan payments). It is not a per-store customer-referral discount.
- **Last click wins** (a newer link overwrites the cookie); the first *verified* attribution per person is final.
- **No automatic reversal on refunds:** plan refunds are not modelled in billing today, so an admin voids the commission manually (while still pending).
- Payouts are recorded manually (UPI transfer by you, then enter the reference). No automatic payout API.
- Self-referral by a second account cannot be fully ruled out by code; the hold period + admin review is the control.

## Tests
`test/affiliate.unit.test.js` (14 tests, offline, in-memory model stand-ins) and `test/affiliate.integration.test.js` (needs MongoDB; full flow link -> click -> sign-up -> paid plan -> commission -> payout, plus the admin and concurrency cases).
