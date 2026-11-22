# API reference

STORVA has three kinds of backend entry points. All input is validated with Zod (server functions) and again
inside the database functions; all tables have row-level security so a merchant only ever reaches their own rows.

## 1. Public HTTP endpoints (`src/routes/api/public/`)
These bypass sign-in, so each handler verifies its caller itself.

| Method & path | Caller | Verification | Responses |
|---|---|---|---|
| `GET /api/public/health` | anyone / uptime monitor | none; returns booleans only | `200 {status:"ok", checks:{database, ai, email, whatsapp, payments, paymentWebhook}, ms}` or `503` when the database is unreachable |
| `POST /api/public/razorpay-webhook` | Razorpay | HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, constant-time compare against `x-razorpay-signature`; replay protection via `x-razorpay-event-id` stored in `payment_events` | `503` not configured · `401` bad/missing signature · `400` bad JSON · `200 "duplicate"` replay · `200` processed |
| `POST /api/public/whatsapp/webhook` | WhatsApp connector | connector signature verified with `WHATSAPP_API_KEY`; delivery id de-duplicated | `503` not configured · `400` missing headers · `401` invalid · `200` stored/processed |
| `POST /api/public/jobs/notifications` | platform scheduler (hourly, `5 * * * *`) | `authenticateCronRequest` (managed cron secret) | `401` · `503` queue unavailable · `200 {ok, due, sent, skipped, retry}` |

Razorpay events handled: `subscription.authenticated|activated|resumed|charged` (activate, record invoice),
`subscription.updated`, `subscription.pending` (past due), `subscription.halted|completed|expired`,
`subscription.cancelled`, `payment.failed`.

## 2. Server functions (`src/lib/*.functions.ts`)
Called from the app with `useServerFn`. Unless marked **public**, each uses `requireSupabaseAuth`
(bearer token attached by `src/start.ts`) and runs as the signed-in merchant under row-level security.

| File | Functions |
|---|---|
| `store.functions.ts` | **public** `getStorefront` (GET, published design + products, signed image URLs) · **public** `placeOrder` (POST, rate limited 10 per device / 10 min, then service-role `place_order`) · **public** `trackStoreEvent` (POST, cookie-less) · `getStoreSettings` · `updateStoreSettings` · `listProducts` · `saveProduct` · `deleteProduct` |
| `theme.functions.ts` | `getThemeEditor` · `saveThemeDraft` · `publishTheme` · `restoreThemeVersion` · `deleteThemeVersion` · `signOwnImage` |
| `orders.functions.ts` | `listOrders` · `updateOrderStatus` · `resendOrderAlert` |
| `commerce.functions.ts` | `getCommerceSettings` · `saveCommerceSettings` · `getInvoice` · `updateOrderShipping` · `setCustomerCodBlock` |
| `customers.functions.ts` | `listCustomers` · `getCustomerOrders` · `updateCustomer` · `eraseCustomer` |
| `notifications.functions.ts` | `listNotifications` · `markNotificationsRead` · `clearNotifications` · `listDeliveries` · `deliverNow` · `getNotificationPrefs` · `saveNotificationPrefs` · `listAuditLog` |
| `analytics.functions.ts` | `getAnalytics` · `getGstReport` · `getSalesExport` (date range ≤ 366 days) |
| `billing.functions.ts` | `getBillingOverview` · `startTrial` · `createCheckout` · `verifyCheckout` · `changePlan` · `cancelSubscription` |
| `ai.functions.ts` | `getAiHistory` · `generateAi` (plan feature + monthly quota enforced in the database) |
| `whatsapp.functions.ts` | `getWhatsappOverview` · `saveWhatsappDraft` · `deleteWhatsappDraft` · `saveWhatsappTemplate` · `syncWhatsappTemplates` · `sendWhatsappDraft` |

Errors are returned as readable messages; database errors use stable codes such as `INVALID`, `NOT_FOUND`,
`OUT_OF_STOCK`, `UNSERVICEABLE`, `COD_UNAVAILABLE`, `INVALID_TRANSITION`, `LIMIT_PRODUCTS`, `LIMIT_ORDERS`.

## 3. Database functions (Postgres, `drizzle/migrations/`)
| Function | Who may call it | What it does |
|---|---|---|
| `storefront(slug)` | anyone | published design + in-stock products for a shop |
| `place_order(slug, checkout_key, customer, items, notes)` | service role only | validates input, stock, delivery state and COD; computes GST (CGST/SGST or IGST), delivery and COD fees; idempotent per checkout key; queues notifications |
| `set_order_status(order_id, status)` | signed-in owner | enforces allowed transitions, assigns invoice number on confirm, restores stock on cancel, queues customer update |
| `update_order_shipping(...)` | signed-in owner | courier, tracking number and URL |
| `analytics_report(from, to)`, `gst_report(from, to)` | signed-in owner | totals, funnel, sources, invoices, HSN summary |
| `track_store_event(...)`, `hit_rate_limit(bucket, subject)` | service role only | hashed visitor events with daily salt; fixed-window rate limits |
| `claim_outbox`, `finish_outbox`, `prepare_outbox` | service role only | notification delivery with retry/backoff (max 5 attempts) |
| `my_usage`, `usage_summary`, `begin_plan_trial`, `reserve_ai_request`, `erase_customer` | signed-in owner | plan usage, trials, AI quota (tools: title, description, seo, category, pricing → basic; image_extract → image; marketing, social → marketing; recommendations), customer erasure |
| triggers: `enforce_product_limits`, `enforce_order_limits`, `low_stock_alert`, `audit_change`, `handle_new_user`, `trim_theme_versions` | automatic | plan limits, low-stock notices, audit log, signup profile + Free plan, keeps the last 30 design versions |

Tables: plans, subscriptions, profiles, products, customers, orders, order_items, invoices, invoice_counters,
store_themes, theme_versions, store_commerce_settings, notifications, notification_outbox, notification_preferences,
store_events, analytics_salts, rate_limits, audit_log, payment_events, ai_requests, ai_service_state,
whatsapp_connections, whatsapp_messages, whatsapp_templates, whatsapp_webhook_events.
Shop pages (About, policies…) are stored inside the design JSON (`store_themes.draft/published`, max 10 pages × 10,000 characters) and served by `storefront(slug)`; shoppers open them at `/shop/<link>?page=<page>`.

Storage: private bucket `product-images` (5 MB per file, owner-folder policies, signed URLs).
