# Task 8 final report (2026-11-19)

## Scope
Source: Task 5 audited package (full merged layout) + Task 7 documentation refresh. Application code of both was byte-identical; Task 7 changed documentation only. The two authentication items from `STORVA-NOTES/final-remaining-issues-roadmap.md` were interpreted as the two identifier throttles named there: **sign-up** and **unknown-account login**. (The registration-OTP item was already delivered in Task 2.)

## What was changed
1. `src/services/loginThrottle.js` (new): atomic, MongoDB-backed throttle for password logins against identifiers with no account. 5 failures / 15 min, enforced in one conditional update on the database clock, TTL cleanup (`purgeAt`), hashed keys, fails closed on database errors.
2. `src/routes/auth.js`: the in-memory `unknownLoginFails` Throttle replaced by `admitUnknownLogin()`. Same responses (401 invalid credentials, then 429 `too_many_attempts`), same hashing cost on every path.
3. `src/utils/identifierThrottle.js`: comment only. The `Throttle` class is kept (not deleted) but no route uses it.
4. Sign-up throttle: **no code change**. It was already durable and atomic (`registrationService.reserve(..., 'signup', 0)`, Task 2). Added tests for it.
5. Tests: `test/loginthrottle.unit.test.js` (new, 7 tests); `test/throttle.durable.integration.test.js` (new, 8 tests, real MongoDB); `test/hardening.unit.test.js` (one static assertion updated from "unknownLoginFails exists" to "durable throttle used, no in-memory Throttle in auth route"); `scripts/test-registration-security.js` now also runs the new integration file.
6. Docs: README banner, IMPLEMENTATION_STATUS, PROJECT_AUDIT, ROADMAP, README-MERGED, this report.

## Tests that passed
- `node --check` on every file in `src/`, `scripts/`, `server.js`, `public/js/`: 0 errors.
- `test/loginthrottle.unit.test.js`: 7/7.
- Unit suite (`npm run test:unit`): 303 tests, 284 pass, 12 skipped (Playwright), **7 test files fail to load** (`module1`, `module7`, `module8`, `module9`, `module10_13`, `module11`, `module14`) with `Cannot find module 'express'/'mongoose'`. The sandbox had no network, so dependencies could not be installed. The **same 7 files fail identically on the unmodified Task 7 source** (277 pass / 296 tests there), so this is environmental, not caused by the change. They passed 313/324 in the Task 7 sandbox that had dependencies.

## What remains unverified
- `test/throttle.durable.integration.test.js` and every other MongoDB integration suite: NOT RUN (no MongoDB, mongoose or express here). The atomic update pipeline is the same construct already used by `registrationService.reserve`, but it has not been executed for the new key scope.
- Playwright browser suite: NOT RUN.
- The 7 unit files above: NOT RUN in this sandbox (passed in Task 7).
- All live providers (Razorpay, WhatsApp, Gemini, SMTP, MSG91): NOT RUN.
- Residual auth weakness, not changed: real-account lockout uses a database counter that is not one atomic gate, so heavily parallel wrong guesses from many IPs can exceed 5 before the lock lands.

## Is it ready to deploy?
**No.** Evidence does not support it:
- The new database-backed code has never been executed against MongoDB.
- Task 5 High findings P5-01..P5-06 are still open (no persistent disk in `render.yaml`, `ENV_STRICT` not enforced, no off-site backup/restore drill, partial backup encryption, manual backup can run unencrypted, restore can drop before validating decryption), plus P5-07 (WhatsApp template mismatch). They were outside this task's scope and were not touched.
- Live provider checks have not been done.

The ZIP name was requested as `STORVA-FINAL-PRODUCTION-READY.zip`; the name does not mean it is production-ready.

## Steps to reach "ready" (from `docs/IMPLEMENTATION_STATUS.md`)
1. `npm ci`, then `node scripts/test-registration-security.js` and `npm test` against a test MongoDB; require 0 failures.
2. Playwright suite 12/12.
3. Fix P5-01..P5-07.
4. Complete the external configuration and live-provider checks (Atlas, Render env vars, Razorpay/WhatsApp/Gemini/SMTP/MSG91, backup restore drill, uptime monitor).
