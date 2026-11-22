# STORVA — roadmap

## Done (2026-11-18)
- [x] Original project imported onto a new Lovable Cloud backend (schema, plans, app code)
- [x] Modules 7, 11, 12, 13, 14, 15 implemented and tested; modules 8 and 9 re-verified where possible
- [x] All modules connected (navigation, storefront, orders, invoices, notifications)
- [x] Unit, webhook, backend integration and browser tests — 84 + 16 checks passing
- [x] Documentation (README, IMPLEMENTATION_STATUS, docs/*)

## Blocked — waiting on the owner
- [ ] Razorpay Test Mode verification — needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- [ ] Email delivery — needs the Gmail connection
- [ ] WhatsApp live number, templates, catalog sync — needs WhatsApp Business connection and Meta template approval
- [ ] Shiprocket automatic tracking — needs Shiprocket credentials
- [ ] Original users / orders / photos — needs export files from the old site
- [ ] Publish, then verify webhooks, health endpoint and the hourly job on the live URL

## Next ideas
- Online payment at checkout for shoppers (UPI via Razorpay) once keys exist
- Product variants (size / weight) and multiple photos per product
- Discount codes
