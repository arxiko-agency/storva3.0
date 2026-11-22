# STORVA — merged package (2026-11-18)

| Folder | What it is | Built from |
|---|---|---|
| `STORVA/` | Main Node/Express/MongoDB app, modules 1–15 | your original **hardening** zip + everything new from **complete_v2** (complete_1 was the older copy of v2 — fully superseded) |
| `STORVA-NOTES/` | Verification reports, module 7 plan, Codespaces steps, modules 7–15 roadmap | hardening zip + `roadmap.md` from the atelier zip |
| `storva-lovable/` | Lovable / TanStack Start + Supabase (Lovable Cloud) version of STORVA | **complete-project** zip (full-project_2 was an earlier copy missing 5 migration files) |
| `_archive/storage-organizer-landing/` | The newer "smart storage organizer" landing page (Sora/Manrope, green accent, hero image) from the Lovable `STORVA-project` / `storva-source` zips (they were the same code; kept once). Not wired into `storva-lovable`, which keeps its working store app | STORVA-project zip |
| `_archive/atelier-landing-source/` | The original placeholder "Atelier" landing page files that were later replaced inside storva-lovable | atelier zip |
| `_archive/superseded-from-hardening/` | `tailwind-config.js` (in-browser Tailwind CDN config), replaced in module 15 by the compiled `public/css/tailwind.css` | hardening zip |

Run the Express app: `cd STORVA && npm install && npm test`.
Run the Lovable app: `cd storva-lovable && bun install && bun run dev`.

Update 2026-11-18: `STORVA/` now also contains the **automatic refund system** (cancelled paid Razorpay orders; see the README section inside `STORVA/`). `STORVA-NOTES/final-remaining-issues-roadmap.md` is the task list that came with the new zips: its refund item is done; its throttling and registration-OTP items are not part of this package.

Update 2026-11-19: `STORVA/` now also contains the **security & performance pass** (audit log, auth/password hardening, job reliability; see `STORVA/docs/SECURITY_PERFORMANCE_PASS.md`) and the **affiliate / referral system** (see `STORVA/docs/AFFILIATE_SYSTEM.md`). Both came from `STORVA-security-performance.zip` and `STORVA-affiliate-system.zip`, which only changed files inside `STORVA/`; the affiliate zip was built on top of the security zip, so it carries both. `storva-lovable/`, `_archive/` and `STORVA-NOTES/` are unchanged.

Update 2026-11-19 (Task 2): `STORVA/` now also contains the **registration OTP & pending-account security** change (see `STORVA/docs/TASK-2-REGISTRATION-SECURITY.md` and `STORVA/docs/TASK-2-VERIFICATION.md`). It came from `STORVA-task2-secured.zip`, which differed from this package in exactly 11 files inside `STORVA/`; those 11 files were copied over. After deployment, legacy registration codes need a resend. Not added: `STORVA-task2.patch` (same change as the secured zip, but the file is cut off at the end), `STORVA-task2-verification.md` (identical to `docs/TASK-2-VERIFICATION.md`), `STORVA-project__1_.zip` (the Lovable landing page, already in `_archive/storage-organizer-landing/`). `storva-lovable/`, `_archive/` and `STORVA-NOTES/` are unchanged.


Update 2026-11-19 (Task 8): `STORVA/` now also contains the **durable unknown-login throttle** (`src/services/loginThrottle.js`) and new throttle tests, plus Task 7's refreshed docs and `docs/TASK-8-FINAL-REPORT.md`. Read that report before deploying: integration suites were not run and Task 5 findings P5-01..P5-07 are still open. `storva-lovable/`, `_archive/` and `STORVA-NOTES/` are unchanged.
