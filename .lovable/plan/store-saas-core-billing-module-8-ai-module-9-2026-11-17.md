# Store SaaS: Core + Billing (Module 8) + AI (Module 9)

Built in 3 phases so each part works before the next starts.

## Phase 1 - Core app
- Lovable Cloud enabled: email sign-in and sign-up, profiles.
- Each user gets one store. Pages: Dashboard, Products (add/edit/delete, images), Orders (list, status), Settings.
- Image uploads go to file storage, which counts toward the storage limit.

## Phase 2 - Subscriptions & Billing (Razorpay)
- Plans: Free, Starter, Pro, Enterprise, each billed monthly or yearly. Prices and limits are placeholders you can change later:

| Plan | Monthly / Yearly | Products | Orders/mo | Storage | AI requests/mo | Trial |
|---|---|---|---|---|---|---|
| Free | Rs 0 | 10 | 50 | 100 MB | 20 | - |
| Starter | Rs 499 / 4,990 | 100 | 500 | 1 GB | 200 | 14 days |
| Pro | Rs 1,499 / 14,990 | 1,000 | 5,000 | 10 GB | 1,000 | 14 days |
| Enterprise | Rs 4,999 / 49,990 | Unlimited | Unlimited | 100 GB | 5,000 | 14 days |

- Pricing page, Razorpay subscription checkout, automatic renewals.
- Upgrading takes effect right away. Downgrading takes effect at the next renewal.
- Cancellation stays active until the end of the paid period, then the plan expires and falls back to Free.
- Trial countdown, plus expiry when the trial ends.
- Limits are checked on the server whenever someone adds a product, takes an order, uploads a file or makes an AI request. Features locked by plan show an upgrade prompt.
- Subscription dashboard: current plan, usage bars, renewal date, cancel/change.
- Billing history with downloadable invoices (from Razorpay).
- Failed payments: the account is marked "past due" and Razorpay retries the charge. A banner asks the user to update payment, and the account drops to Free after the retry window.
- Secure webhook endpoint that checks Razorpay's signature on every event.
- Needs your Razorpay Key ID, Key Secret and Webhook Secret. Until you add them, checkout shows a "payments not set up" notice.

## Phase 3 - Gemini AI (built-in, no key)
- On the product form: generate a title, a description, SEO content (meta title, meta description, keywords) and category suggestions.
- Upload a product photo to pull out its details: name, attributes and suggested description.
- AI Studio page: marketing copy and social captions for Instagram, Facebook and X.
- Product recommendations ("related products") based on your catalog.
- Monthly AI limits per plan, shown on the dashboard.
- AI history page listing each request, its status and any errors, with friendly error messages (limit reached, credits, rate limit).

## Technical details
- Tables: stores, products, orders, plans, subscriptions, invoices, payment_events, usage_counters, ai_requests. Each table has access rules so users only see their own data. Plan changes are written only by the server.
- Razorpay is called through server functions. The webhook lives at /api/public/razorpay-webhook and verifies HMAC-SHA256 before processing any event.
- AI runs through server functions using the default Gemini model on the built-in AI service, with a usage check before every call.
