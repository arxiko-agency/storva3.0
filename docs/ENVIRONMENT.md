# Environment variables

Never put server-only values in frontend code, in `.env` committed to git, or in the ZIP.
`process.env.*` is read only inside server handlers; the browser only sees `VITE_*` values.

## Browser (`.env`, publishable — safe to expose)
| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Backend URL used by the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key; row-level security protects all data |
| `VITE_SUPABASE_PROJECT_ID` | Backend project reference |

## Server-only (secrets)
| Variable | Used by | Required for | Status in this project (2026-11-18) |
|---|---|---|---|
| `SUPABASE_URL` | server functions, health check | everything server-side | set (platform) |
| `SUPABASE_PUBLISHABLE_KEY` | public storefront reads | storefront | set (platform) |
| `SUPABASE_SERVICE_ROLE_KEY` | checkout, webhooks, outbox, image signing | checkout, notifications, webhooks | set (platform) |
| `LOVABLE_API_KEY` | AI studio, Gmail + WhatsApp connector gateway | Module 9; with the keys below for 10/13 | set (platform) |
| `LOVABLE_CRON_SECRET` (+ `_PREVIOUS` during rotation) | `/api/public/jobs/notifications` auth | hourly notification job | set (platform) |
| `GOOGLE_MAIL_API_KEY` | `src/lib/gmail.server.ts` | sending order/notification emails | **missing** — connect Gmail |
| `WHATSAPP_API_KEY` | `src/lib/whatsapp.server.ts`, WhatsApp webhook signature | Module 10 + WhatsApp notifications | **missing** — connect WhatsApp |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `src/lib/razorpay.server.ts` | paid plan checkout (Module 8) | **missing** |
| `RAZORPAY_WEBHOOK_SECRET` | `/api/public/razorpay-webhook` | renewals, failures, cancellations | **missing** (endpoint answers 503 until set) |

`GET /api/public/health` reports which of these are configured (true/false only, never values).

## Razorpay setup (when you are ready)
1. Razorpay Dashboard → Settings → API Keys → generate **Test Mode** keys → add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` as secrets.
2. Razorpay Dashboard → Settings → Webhooks → add `https://<your-domain>/api/public/razorpay-webhook`, choose the
   `subscription.*` and `payment.failed` events, set a secret, and add the same value as `RAZORPAY_WEBHOOK_SECRET`.
3. No manual plan setup is needed: the first checkout for each paid plan creates the Razorpay plan and saves its id in `plans.razorpay_plan_monthly` / `razorpay_plan_yearly`.
