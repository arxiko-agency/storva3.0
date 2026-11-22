# STORVA P0 verification report (2026-11-16)
Checked on the unzipped project in a sandbox with no network. No project file was changed.

| Check | Result | Status |
|---|---|---|
| Node / npm | Sandbox: Node v22.23.4, npm 10.9.9 (project needs Node >= 20) | PASS (sandbox only; Codespace NOT checked) |
| package-lock.json | does not exist | FAIL (known) |
| npm install | timed out (exit 124), no network | BLOCKED |
| Unit tests | 201 tests: 189 pass, 1 fail, 11 skip. Fail = module1.test.js "Cannot find module 'express'" (dependencies not installed) | FAIL (caused by npm install) |
| Integration tests | 8 suites, all skipped (no MongoDB) | BLOCKED |
| Browser tests | 11 skipped (needs ejs + playwright) | BLOCKED |
| Razorpay Test Mode | not tested | NOT TESTED |
| Secret scan | only placeholder in .env.example; no .env | PASS (pattern scan only, no git history) |
| Tenant isolation | static review only (tenantScoped plugin, loadOwnedStore) | NOT TESTED |

Known open issues (README): account-existence disclosure at registration, throttled OTP returns 201, CSP allows unsafe-inline/unsafe-eval, render.yaml lacks Razorpay vars.

## To finish P0 (run in a Codespace or a computer with internet + Docker)
1. node --version ; npm --version
2. npm install   (then commit package-lock.json)
3. npm run test:unit            (want: fail 0)
4. docker compose -f docker-compose.test.yml up -d
   MONGODB_URI=mongodb://127.0.0.1:27018/storva_test npm run test:integration   (want: fail 0, skipped 0)
5. Browser suite, then Razorpay Test Mode.
