# Installation and deployment

## Requirements
- Node.js 20+ with npm, or Bun 1.1+ (the lockfile `bun.lock` is the source of truth)
- Python 3.10+ with Playwright, only for the browser journey test
- A Lovable Cloud backend (or a compatible Postgres + Auth + Storage project)

## Install and run locally
```sh
bun install                 # or: npm install  (.npmrc sets legacy-peer-deps, needed by npm 10)
cp .env.example .env        # set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID
bun run dev                 # or: npm run dev  → http://localhost:8080
bun run build               # production build
```
Server-only values (see [ENVIRONMENT.md](ENVIRONMENT.md)) must be available to the server process; in Lovable
Cloud they are managed as secrets automatically.

## Database
Apply the migrations in order:
1. `drizzle/migrations/0000_storva_base_schema.sql` — tables, functions, triggers, row-level security, grants,
   and the original four plan rows (replaced by migration 0003).
2. `drizzle/migrations/0001_modules_7_to_15.sql` — designer, GST/shipping, invoices, notifications, analytics,
   rate limits, audit log and storage policies.
3. `drizzle/migrations/0002_ai_price_suggestion_tool.sql` — allows the AI price-suggestion tool on basic AI plans.

4. `drizzle/migrations/0003_three_plans.sql` — public pricing becomes 3 plans: Free ₹0 (25 products), Starter ₹249, Pro ₹899 per month; Enterprise removed.

Then:
5. Create a **private** storage bucket named `product-images` with a 5 MB file limit (the policies in 0001 apply to it).
6. Schedule `POST /api/public/jobs/notifications` hourly at minute 5 (`5 * * * *`) using the platform's managed
   cron schedule (Lovable Cloud does this; it is already active in this project).
7. Enable email/password sign-in (keep email confirmation on), plus Google and Lovable sign-in if wanted.

`database/schema.legacy.sql` and `database/legacy-migrations/` are the original export kept for reference;
they are already included in the migrations above — do not run both.

## Deploy
- **Lovable:** click Publish in the editor. The app deploys to an edge runtime; secrets stay in Lovable Cloud.
- **Self-hosted:** `npm run build` produces a Nitro server build in `dist/`; deploy it with
  `npx nitro deploy --prebuilt` (edge / Cloudflare Workers target) and set every server-only variable as a secret.

After deploying:
1. Open `https://<domain>/api/public/health` and confirm `"database": true`.
2. Register the Razorpay webhook (see ENVIRONMENT.md) and connect Gmail / WhatsApp if needed.
3. Sign up, set your shop link under Products, add a product and place a test order at `/shop/<link>`.
