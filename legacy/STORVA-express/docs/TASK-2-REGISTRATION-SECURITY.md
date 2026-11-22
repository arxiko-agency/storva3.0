# Task 2 — Registration OTP and pending account security

## Changes

- Pending accounts are retained with their original ID, name, email, mobile, password hash and referral attribution. Re-registration never deletes, merges or overwrites an account.
- Unique email and mobile indexes arbitrate concurrent account creation. Duplicate-index errors produce the same registration response, not a revealing 409.
- Registration OTP hashes bind the immutable account ID, normalized identifier and delivery channel. Verification never resolves a different owner after consuming a code.
- One atomic MongoDB update checks eligibility, expiry and attempt budget, consumes the challenge and verifies its owner. Concurrent requests have one winner, so they create one registration session.
- MongoDB's server clock enforces ten-minute expiry in the write predicate; TTL cleanup is not used for security.
- Five incorrect guesses exhaust the challenge. Resends replace the previous challenge, reset its guess budget and retain durable send history.
- Durable hash-keyed budgets enforce the existing 30-second cooldown and five-per-hour send cap, shared across registration, login and reset. Existing OTP history seeds the budget on upgrade. Signup retains its five-per-hour limit for each supplied email and mobile.
- Registration/resend replies remain generic for pending, existing and unknown identifiers and for provider failures. SMS and email providers, login methods, screens, cookies and session behavior are preserved.

## Deployment

1. Back up your existing deployment, then deploy the revised STORVA source with the existing configuration.
2. Ensure MongoDB has the existing unique email/mobile indexes and the new `registrationbudgets` TTL index. Mongoose initializes indexes normally; deployments disabling automatic index creation must provision these indexes before enabling traffic.
3. **Legacy registration OTPs are invalidated deliberately:** they cannot be safely associated with their original pending account. Pending accounts are preserved; affected users must resend a code. Already-issued login/reset codes remain compatible.
4. Never manually delete pending accounts to resolve collisions. Users who know the original pending password can resume through the existing login-and-verify flow.
5. Confirm a real email and SMS registration against your configured delivery providers after deployment. Production delivery and deployment were not available here.

Registration activation and OTP consumption are atomic without requiring a replica set or multi-document transaction. Session creation follows activation; if it fails, the account remains verified and can use normal login. The OTP remains consumed.

## Verification

```sh
npm ci
node scripts/test-registration-security.js
```

The runner starts a disposable real MongoDB, runs the original authentication unit/integration tests and new registration security tests, then shuts down the database. No production credentials are used. Provider delivery is stubbed only at its boundary in the new suite; OTP generation, hashing, expiry, MongoDB writes and session creation are real.

Coverage: success, expiry boundaries, invalid OTP, five-attempt exhaustion, repeated OTP, concurrent verification, concurrent incorrect guesses, immutable-account/channel binding, pending preservation, duplicate creation races, partial collisions, cooldown, hourly cap, concurrent resend admission, account enumeration and suspended-account rejection.

Source migration guidance informed archive inspection and credential filtering only; this scoped task is not a whole-app migration.