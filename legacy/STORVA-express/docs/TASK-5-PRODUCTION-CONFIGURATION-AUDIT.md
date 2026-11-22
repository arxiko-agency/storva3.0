# TASK 5 — Production Configuration Audit

**Audit date:** 19 November 2026  
**Source:** `STORVA-tested_v2.zip`  
**Verdict:** **Not ready for production sign-off.** Configuration support exists, but deployment persistence, enforcement, backup safety, and external-service verification remain incomplete.

## Scope and evidence

The archive contains two separate applications. Its `README-MERGED.md` identifies `STORVA/` as the main Node/Express/Mongoose application; this is the primary scope because it contains `render.yaml`, MongoDB, SMTP, MSG91, and Gemini. The separate `storva-lovable/` Cloud application is reviewed for configuration differences below. Archived landing pages are not production targets.

This was an inspection-only audit: no source application was imported into the preview, no production configuration was changed, and no external account was contacted. Private environment files and package credential files were excluded. No real secret values are included in this report.

**Verified offline:** 13 existing tests passed: eight in `STORVA/test/preflight.unit.test.js` and five in `STORVA/test/backupjob.unit.test.js`. Additional synthetic probes confirmed gaps in configuration validation and the readiness bearer comparison. Dependencies, package scripts, server startup, database-backed flows, and real provider calls were not run. These results do not establish deployment readiness.

## Prioritized findings

| ID | Priority | Finding and impact | Required action | Evidence |
|---|---|---|---|---|
| P5-01 | High | Render sets uploads and backups under `/var/data` but declares **no persistent disk**. A fresh Blueprint does not provision durable storage. Files may be unwritable or disappear on redeploy without an existing manually attached disk. | Declare/attach a paid persistent disk at `/var/data`; verify both directories are writable and survive deployment. Record any existing manual disk configuration. | `STORVA/render.yaml:45–47,73–75`; no `disk` block |
| P5-02 | High | Production preflight errors normally **do not stop startup**. Render neither sets `ENV_STRICT=true` nor runs the offline environment check as a deployment/start gate. Missing OTP delivery or payment webhook configuration can coexist with a healthy database. | Set `ENV_STRICT=true` in production and gate startup using the offline production check. Keep the unconditional core checks already present. | `src/config/env.js:80–85`; `render.yaml:6–7`; `scripts/check-env.js` |
| P5-03 | High | Backups remain on the same app disk; **no off-site copy or recovery drill** is implemented. Daily scheduling alone cannot protect against losing that disk. | Configure an independently stored, access-controlled copy, retention and failure monitoring; preserve encryption keys outside the host; restore to a scratch database before launch. | `src/services/backupJob.js`; `docs/PRODUCTION_INTEGRATIONS.md:44–49` |
| P5-04 | High | Only database payloads are encrypted. Uploads and the manifest, including collection counts and index metadata, are not. Database files are also briefly written in plaintext before encryption. The manifest's `encrypted` flag does not mean the entire backup is encrypted. | Encrypt the complete backup or use suitably encrypted/restricted backup storage; address plaintext staging, permissions, and sensitive uploaded files. Document the actual encryption boundary. | `src/services/backup.js:47–62` |
| P5-05 | High | Manual `scripts/backup.js` bypasses the scheduled job's production encryption requirement. It can write an unencrypted production backup with no key. | Enforce the production key requirement in the shared backup function and manual entry point, not only the scheduler. | `scripts/backup.js:12`; `services/backup.js:40–41`; `backupJob.js:44` |
| P5-06 | High | Restore checks file hashes before writing, but does **not validate decryption/parseability before `--drop`**. A wrong encryption key can fail after a collection has been dropped. Restore is not atomic, index failures are merely logged, and uploads have no manifest checksums. | Fully authenticate/decrypt and validate every selected file before destructive changes; prefer scratch-database restore plus controlled cutover; fail on required index errors and checksum uploads. | `src/services/backup.js:80–98` |
| P5-07 | Medium | `.env.example` advertises `WA_TPL_REFUND=storva_refund`, while the actual default is `storva_refund_processed`. The referenced `docs/WHATSAPP_TEMPLATES.md` is **absent**. Incorrect approved names or parameter ordering cause notification failures. | Reconcile the example with the approved template, supply exact template bodies, languages and parameter order, and verify them in Meta. | `.env.example:104–105`; `src/utils/messages.js:4,11`; archive docs listing |
| P5-08 | Medium | `/api/ready` returns 200 based on MongoDB alone; unhealthy jobs produce only authenticated warnings. SMTP, Razorpay, WhatsApp, Gemini and backup age are not readiness gates. The 2-second timeout applies to the ping, not authenticated queue queries. `/api/health` is also database-dependent, not pure process liveness. | Define separate liveness/readiness expectations; add bounded dependency/backup monitoring, and alert on warnings instead of interpreting HTTP 200 as all integrations working. | `src/routes/system.js:7–40` |
| P5-09 | Medium | The bearer check compares character lengths before `timingSafeEqual`, which requires equal **byte** lengths. A non-ASCII supplied bearer string can cause an exception rather than a clean rejection. Synthetic byte-comparison probe reproduced the exception. | Compare buffer lengths first and return false for malformed credentials; use an ASCII random monitor token. | `src/routes/system.js:16` |
| P5-10 | Medium | Preflight checks presence/basic patterns, not complete production validity. Synthetic probes were not rejected for malformed Mongo URI, `APP_URL=https://`, negative Mongo pool/SMTP port, invalid rate-store name, disabled SMTP TLS, or forced backup scheduling without a key. Some fail later in another layer; others silently degrade. | Validate URL structure, numeric ranges, enum/boolean settings, secure SMTP policy and scheduler dependencies. Verify mounted paths and providers separately. | `src/config/preflight.js`; offline synthetic probes |
| P5-11 | Medium | Secret masking is inconsistent. Mongo's main connector masks URI userinfo, but manual scripts/live checks log raw errors, the monitor logs messages/stacks and forwards messages to alerts, and job errors appear in authenticated readiness details. No universal scrubber is applied. | Redact credentials, tokens and credential-bearing URLs centrally before logging, monitoring, alerting or health output. Do not assume URI-userinfo masking covers all secret formats. | `config/db.js:9`; `scripts/check-integrations.js:20`; `scripts/restore.js:16,22`; `services/monitor.js:35–41`; `services/jobs.js:19` |

## Configuration coverage and external requirements

### 1. `.env.example` and Render

Both exist for the main application. The example is a **development template**, not a ready-to-deploy production configuration. Its local public URL/database defaults and empty integration credentials require replacement in the host's environment settings. The Render template requests manual values using `sync:false` and generates auth, monitor and backup secrets; it is not proof those values exist on a deployed service.

Render correctly sets production mode, starts the Node application, uses `/api/ready`, sets shared Mongo rate limits and JSON access logs, and uses `npm ci --omit=dev` with an existing version-3 lockfile. Static CSS is already bundled; that build command does not regenerate CSS.

**Missing or operationally important Render settings:**

- Persistent disk definition and a durable storage/backup capacity plan.
- `ENV_STRICT=true` and an enforced environment-check gate.
- Explicit Node runtime pin. `package.json` specifies only `>=20`; choose a supported LTS release rather than relying on an open-ended minimum.
- `PLATFORM_ADDRESS`, omitted although the environment example documents it for plan invoices.
- `WHATSAPP_DISPLAY_NUMBER` if the platform number must be shown to users.
- Explicit backup timing/retention if defaults are unsuitable: `BACKUP_SCHEDULE_ENABLED`, `BACKUP_INTERVAL_HOURS`, `BACKUP_HOUR_IST`, `BACKUP_KEEP`.
- Explicit `SECRETS_KEY` and durable custody/rotation procedure. Render requests it but does not generate it automatically; it must be a valid encryption key configuration.
- Approved `WA_TPL_*` and `WA_TEMPLATE_LANG` overrides where Meta-approved values differ from the application's defaults.

The remaining absent tunables generally have code defaults and are not automatically blockers. `MSG91_SENDER_ID` is documented but deliberately unused. The comment referring to `npm run check:integrations` as read-only is imprecise: its backup check may create a directory, SMTP verification authenticates, and explicit SMS/email flags send messages.

**External requirement:** Render account with the required paid service/disk, final HTTPS domain and DNS/TLS setup, plus monitoring and off-site storage accounts where used. Actual host settings, billing, network egress and disk attachment are unverified.

### 2. MongoDB

**Required:** `MONGODB_URI`. **Tunables:** `MONGO_CONNECT_ATTEMPTS`, `MONGO_SERVER_SELECTION_MS`, `MONGO_POOL_SIZE`, `MONGO_SOCKET_TIMEOUT_MS`.

Implemented: Mongo URI scheme validation at connection time, retry/backoff for transient failures, immediate rejection of recognized authentication/parse failures, connection event logging and driver-managed reconnection. Production preflight flags local database addresses. Render uses `RATE_LIMIT_STORE=mongo`; this rate-limit store **fails open** if the database is unavailable.

**External requirements/actions:** provision MongoDB Atlas or a compatible MongoDB service, a dedicated least-privilege application database user, suitable network allowlisting/private access from Render, TLS, and capacity/backup policy. Verify application reads/writes, required unique/TTL indexes and backup list/read/index access. Restore credentials additionally need target database write/drop/index privileges. No production connection or index readiness has been verified. Do not interpret the connector's successful ping as proof that application indexes or writes work.

### 3. Razorpay

**Required for online payments:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Leaving both API credentials unset disables online checkout, permitting cash-on-delivery behavior. A half pair prevents startup. A missing webhook secret returns 503 at the webhook; it is fatal at preflight only when strict enforcement is enabled. Production test-mode credentials currently produce a warning rather than a refusal.

**External requirements/actions:** activate the merchant account and complete required business/KYC and settlement setup. Configure live credentials securely. In Razorpay, register **`<APP_URL>/webhooks/razorpay`** with the matching webhook secret and payment/refund events. Keep `RAZORPAY_SUBSCRIPTIONS_ENABLED=false` unless Subscriptions is activated; when enabled, register the relevant `subscription.*` lifecycle events listed in `docs/PRODUCTION_INTEGRATIONS.md`.

The application's documentation explicitly notes missing fallback reconciliation for permanently lost subscription-charge webhooks and no owner notification listener for a halted subscription. The read-only integration script cannot prove webhook registration/delivery, charging, refunds or renewal behavior. Verify signed delivery and representative payment/refund/subscription journeys before enabling real money movement.

### 4. WhatsApp Cloud API

**Platform settings:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`; optional `WHATSAPP_DISPLAY_NUMBER`, `WHATSAPP_GRAPH_VERSION`, `WA_TEMPLATE_LANG`, five `WA_TPL_*` variables. Store-owned connection tokens and app secrets are stored encrypted; configure a stable separate `SECRETS_KEY` to avoid breaking them when `JWT_SECRET` rotates.

The default Graph version is `v21.0`; current support must be confirmed with Meta. Production refuses unsigned incoming webhooks. Platform webhook: **`<APP_URL>/webhooks/whatsapp`**. Store-owned numbers use **`<APP_URL>/webhooks/whatsapp/<connection-key>`** and their own verification/app-secret configuration. Store connection creation permits an omitted app secret, so “connected” does not alone prove incoming webhooks are usable.

**External requirements/actions:** Meta developer/business account, WhatsApp-enabled app, WhatsApp Business Account and registered number, a suitably scoped system-user token, required business/app permissions or review, and approved message templates with correct language/parameters. Subscribe the app to messages, complete the GET challenge, verify signed POST delivery and actual send/receive. Confirm account billing, permitted recipients, consent/opt-out and messaging limits. None of these account settings are verified from source presence.

### 5. Gemini

**Required:** `GEMINI_API_KEY`; optional `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GEMINI_TIMEOUT_MS` (default 25 seconds, capped at 60 seconds).

The key is supplied server-side using the `x-goog-api-key` header. Missing configuration disables AI tools. Requests have timeouts; quota/rate limits and provider errors are mapped to application errors, and failed AI calls return reserved credits. The environment validator does not test model availability or key validity.

**External requirements/actions:** Google AI Studio/Google project access, enabled Gemini API, compatible key restrictions, sufficient quota and billing where required. Confirm model availability and a representative text/image generation request. The live check only reads model metadata and does not prove generation quotas or output behavior.

### 6. SMTP and MSG91

**SMTP:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; optional `SMTP_CONNECTION_TIMEOUT_MS`, `SMTP_REQUIRE_TLS`. Port 465 uses implicit TLS; port 587 requires STARTTLS unless explicitly disabled. Other ports are not automatically required to upgrade. Missing `MAIL_FROM` defaults to a localhost sender and generates only a warning.

**SMTP external requirements/actions:** an SMTP-capable email provider, sender/domain verification, correct host/port/login, SPF/DKIM and an appropriate DMARC policy, provider sending limits, and permitted SMTP egress. Verify SMTP authentication **and actual delivery** of a registration/reset and queued notification email. Connection verification alone cannot prove mailbox delivery.

**MSG91:** `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`. The application sends via the v5 OTP API but verifies the OTP locally. `MSG91_SENDER_ID` is not read.

**MSG91 external requirements/actions:** active funded MSG91 account, approved OTP template and applicable Indian DLT entity/header/template approvals, authentication/network restrictions and valid recipient format. The default “MSG91 OK” check establishes only credential presence; it does not contact MSG91. A separately authorized single test SMS and receipt confirmation are needed.

At least one complete OTP channel is required by production preflight. If only SMS works, email sign-up/verification and order/plan email delivery remain unavailable; if only email works, phone OTP flows remain unavailable. Configure both if both signup channels are offered.

### 7. Backup and restore

**Settings:** `BACKUP_DIR`, `BACKUP_KEY`, `BACKUP_KEEP`, `UPLOAD_DIR`; scheduler settings as listed above. Production scheduling defaults on when a valid backup key is set. It checks every 30 minutes, with its first check two minutes after startup; the default desired backup interval is 24 hours and retention is 14 complete folders. `BACKUP_HOUR_IST` is a preferred hour, not an exact cron guarantee, and a first backup runs as soon as due.

Backup preserves BSON data types through Extended JSON, compresses collection payloads, records database checksums/counts/indexes, skips sessions/OTPs/rate-limit counters/visitor marks, and optionally copies uploads. Independent scans of collections are not a database-wide point-in-time snapshot; documents and media can change during backup. Restore invalidates previously skipped sessions by not bringing them back.

**Actions:** address P5-03 through P5-06, define recovery point/time objectives, verify disk space and backup age independently, and use database-native consistent snapshots if the application requires cross-collection point-in-time consistency. Store the original `BACKUP_KEY` and any WhatsApp token-encryption key in controlled recovery custody; losing or changing them can make backups or restored connections unusable.

The Render cron example is commented out and cannot share the web service disk. An actual external scheduler requires accessible storage and separately provisioned configuration. No backup was created and no restore was performed during this audit.

### 8. Production validation and health endpoints

- Offline check: from the main application's directory, `NODE_ENV=production npm run check:env`; nonzero exit on preflight errors. It uses host values and any locally present environment file.
- Live diagnostic: `npm run check:integrations`. Review/redact output first; its raw exception reporting is not uniformly secret-safe. Message-send flags must not be used without explicit approval.
- **`GET /api/health`**: 200/503 from Mongoose connection state; reports database state and uptime, no actual ping.
- **`GET /api/ready`**: 200/503 from a database ping with a 2-second ping deadline. Public response includes `ok`, `db`, `dbPingMs`. Outside production or with the configured `HEALTH_TOKEN` bearer, adds jobs, queue/errors, memory and runtime details. `Cache-Control: no-store` is set.
- Both are before session loading but behind the general API limiter (120 requests/minute per IP) and origin guard. A sufficiently busy shared IP can cause monitoring 429s. Health failures may include database-rate-store overhead before reaching the ping.
- Readiness does not prove production preflight passed, external accounts work, background delivery succeeds, or backups are recent.

**External requirements/actions:** uptime monitor with public readiness checks and secure bearer-based diagnostics; a functioning `ALERT_WEBHOOK_URL` receiver if alerts are required. Monitor stale backups/failed jobs explicitly. No deployed endpoint, monitor configuration, alert delivery or restart behavior was verified.

## Separate bundled Cloud application's configuration

`storva-lovable/` is not interchangeable with `STORVA/render.yaml`. It uses Cloud database/auth/storage, Lovable AI, Gmail/WhatsApp connectors and a different deployment/runtime setup—not MongoDB, SMTP, MSG91 or a direct Gemini key.

- Browser template: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`; only publishable configuration belongs in browser variables.
- Server needs Cloud URL/publishable/service credentials, `LOVABLE_API_KEY`, connector keys `GOOGLE_MAIL_API_KEY` and `WHATSAPP_API_KEY`, Razorpay credentials/webhook secret, and `LOVABLE_CRON_SECRET` for the notification job. These are variable names, not supplied values.
- Its deployment guide additionally requires ordered migrations, a private `product-images` bucket, signup/email verification settings and a notification schedule. Claims in bundled documents that settings are “set” or schedules are active describe a past environment and **are not evidence for this project or a new deployment**.
- Its endpoint is **`/api/public/health`**, not `/api/ready`; it returns 200 based only on a readable `plans` query. Other checks report credential presence, not provider reachability. Razorpay webhook is **`/api/public/razorpay-webhook`**; WhatsApp uses its separate public webhook route.
- No equivalent application backup/restore scripts or Render Blueprint were found for this version. Confirm Cloud-managed database recovery and separate storage-file recovery/retention before selecting it as the production target.

This audit does not select, migrate or deploy either version.

## Launch checklist

1. Choose the production target explicitly; do not mix environment files or webhook paths from the two applications.
2. For the Express application, provision the durable Render disk, HTTPS URL, MongoDB access and secure host environment values.
3. Enable strict production validation; require the offline check to pass; resolve warnings applicable to enabled features.
4. Complete Razorpay, Meta, Google, SMTP and MSG91 account requirements for every offered capability; record intentionally disabled features.
5. Correct WhatsApp template documentation and configure approved templates.
6. Fix backup/restore safety gaps, configure off-site copies/key custody and perform a scratch restore with count/relation/index/media checks.
7. Harden secret-safe diagnostics and malformed bearer handling; configure readiness, backup-age and job-failure alerts.
8. Perform real registration/reset, payment/webhook/refund, WhatsApp, AI and notification journeys using approved test accounts; verify actual outcomes and no secret leakage.

**Ready:** Source-level configuration audit and 13 offline tests completed; findings and external requirements documented.  
**Still needed:** Configuration fixes, account/dashboard confirmation, deployed health checks, provider journeys and a full backup/restore drill. Production approval remains pending.

*Inspection followed the archive-safety guidance of the Migrate an external project skill; no migration was performed.*