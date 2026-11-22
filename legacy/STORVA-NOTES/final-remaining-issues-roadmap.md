# STORVA final remaining issues

- [ ] Inspect the merged source and run the existing test baseline.
- [ ] Replace in-memory signup and unknown-login identifier throttles with atomic MongoDB-backed throttling, expiry, cleanup, safe failure behavior, and multi-instance tests.
- [ ] Preserve pending accounts during registration; bind registration OTP verification to the correct pending account with expiry, concurrency coverage, and no account-enumeration regression.
- [ ] Start idempotent automatic refunds when paid Razorpay orders are cancelled; preserve inventory rules, surface refund state, notify on processed refunds, and test failures/retries/restarts.
- [ ] Run all unit and integration tests plus relevant browser/security checks; record VERIFIED, MOCKED, and NOT RUN accurately.
- [ ] Update PROJECT_AUDIT.md, IMPLEMENTATION_STATUS.md, and README.md.
- [ ] Package and inspect the complete updated STORVA source ZIP in Files, with changes, test results, and limitations.
