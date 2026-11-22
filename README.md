# STORVA (merged: new design + original backend)

> See **MERGE-REPORT.md** first: what was merged, what is verified, known gaps and open decisions.
> Run: `bun install && bun run dev` (or npm). Environment: copy `.env.example` to `.env` and fill in the original project's values. The Express/MongoDB app is kept untouched in `legacy/STORVA-express`.

---

# STORVA — online shop builder for Indian small businesses

STORVA lets a merchant open an online shop in minutes: add products, design the shop, take cash-on-delivery
orders, charge GST correctly, print tax invoices, get notified of new orders, use AI to write product copy,
and see sales analytics. Shoppers order from a public page at `/shop/<store-link>`; no shopper account is needed.

> Status at a glance — see **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)** for the exact
> implemented / tested / untested / credential-dependent breakdown. Razorpay payments, WhatsApp sending,
> Gmail email sending and Shiprocket are **not** live-verified because their credentials are not configured.

## Features (modules)
| # | Module | Where in the app |
|---|---|---|
| — | Sign-in (email + password, Google, Lovable), password reset | any merchant page, `/reset-password` |
| 7 | Store designer: presets, colour palettes, colours with contrast check, fonts (incl. Malayalam), header, menu (section / category / page / website links), sections (drag to reorder), product grid, footer, shop pages (About, shipping, refund, privacy, terms, contact — starter text included), phone/tablet/desktop preview, click-to-edit, draft → publish, named versions & restore | `/design`, `/shop/<link>?page=<page>` |
| 8 | Subscription plans (Free / Starter / Pro), plan limits, Razorpay checkout + webhook | `/billing` |
| 9 | Gemini AI studio: titles, descriptions, SEO, categories, price suggestion, from-photo, marketing, social, recommendations (English / Malayalam / Hindi) | `/` |
| 10 | WhatsApp Business: drafts, templates, sending, webhook | `/whatsapp` |
| 11 | Customers: history, edit, erase, block cash-on-delivery | `/customers` |
| — | Products & store link; orders dashboard with live updates; shop QR code + share kit (WhatsApp, Facebook, Telegram, email, Instagram bio — each tagged for Analytics) | `/products`, `/orders` |
| 12 | Shipping & GST: state rates, free-delivery threshold, COD rules, CGST/SGST/IGST, HSN, per-financial-year invoice numbers, printable/PDF invoice, manual tracking | `/settings`, `/invoice/<orderId>` |
| 13 | Notifications: in-app bell & inbox, preferences, email/WhatsApp outbox with retries, low-stock alerts, daily summary, hourly job | `/notifications`, `/settings` |
| 14 | Analytics: cookie-less visits, funnel, traffic sources, sales charts, CSV and GST exports | `/analytics` |
| 15 | Security: security headers, rate limits, server-only checkout, audit log, health endpoint, sign out everywhere | `/settings` → Security, `/api/public/health` |

## Tech stack
TanStack Start v1 (React 19, server functions, SSR) · Vite 7 · TypeScript · Tailwind CSS v4 · shadcn/ui ·
TanStack Query · Zod · Lovable Cloud backend (Postgres with row-level security, Auth, private Storage, cron) ·
Lovable AI Gateway (Gemini) · Vitest · Playwright (Python) for the browser journey. Targets an edge (Cloudflare Workers) runtime.

## Quick start
```sh
bun install            # or: npm install
cp .env.example .env   # fill in your backend URL + publishable key
bun run dev            # http://localhost:8080
bun run test           # unit + webhook + backend integration tests
```
Full instructions: **[docs/INSTALL_DEPLOY.md](docs/INSTALL_DEPLOY.md)**.

## Documentation
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) — what is implemented, tested, untested, credential-dependent
- [ROADMAP.md](ROADMAP.md) — task list and blockers
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — every environment variable
- [docs/API.md](docs/API.md) — HTTP endpoints, server functions, database functions
- [docs/INSTALL_DEPLOY.md](docs/INSTALL_DEPLOY.md) — installation, database setup, deployment
- [docs/TESTING.md](docs/TESTING.md) — how to run and what each test suite verifies
- [SETUP.md](SETUP.md) — short setup summary (kept from the original export)
- [AGENTS.md](AGENTS.md) — architecture rules

## Project layout
```text
src/
  routes/                 pages (file-based) and server routes under routes/api/public/
  components/             UI (store-shell, theme-designer, storefront-view, orders-dashboard, ...)
  lib/*-rules.ts          pure business rules (GST, pricing, plans, theme, reports) + unit tests
  lib/*.functions.ts      authenticated server functions (createServerFn)
  lib/*.server.ts         server-only helpers (Razorpay, Gmail, WhatsApp, images, AI)
  integrations/           generated backend clients (do not edit)
  test/integration/       backend integration tests against the real database
drizzle/migrations/       database migrations applied to this project (0000 base, 0001 modules 7–15, 0002 AI price tool)
database/                 original exported schema + original migrations (reference only)
e2e/storva_flow.py        browser end-to-end journey
docs/                     documentation
```
