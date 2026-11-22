# STORVA – modules 7–15 (delivered as an updated ZIP of the Node/Express/MongoDB app)

Work dir: /tmp/storva/STORVA (test MongoDB: /tmp/mongodb-ce, port 27018 replSet rs0)

- [x] Confirm ZIP access, inspect project, run unit + integration tests (77/77 pass after fixes)
- [x] Fix bugs found by first real integration run (slug object injection, PATCH slug_taken)
- [x] 7 Store designer & themes (wire model/service/routes, storefront sections, dashboard Designer tab, tests)
- [x] 8 Subscriptions & plan gating (plans, limits, Razorpay subscription, gating middleware)
- [x] 9 Gemini AI product tools (description, title, tags, pricing hint; key optional)
- [x] 10 WhatsApp Cloud API (webhooks, owner commands, photo upload, shopper lookup, opt-out, own number, QR, share kit)
- [x] 11 Customers (records from orders, segments, search, notes/tags, COD block, CSV export, erasure)
- [x] 12 Shipping & GST (regions, COD rules, GST incl/excl, CGST/SGST/IGST, HSN, invoices numbered per FY)
- [x] 13 Notifications (outbox + retries, in-app bell, email/WhatsApp, preferences, log, daily summary)
- [x] 14 Analytics & reports (cookie-less visitors, sales, funnel, sources, CSV + GST filing exports)
- [x] 15 Security & production hardening (strict CSP, compiled Tailwind, readiness, alerts, shared rate limits, encrypted backups, lockfile)
- [x] Docs, tests (400: 389 pass, 0 fail; browser suite 12/12), README/status update, ZIP to Files (STORVA-complete.zip)

## Module 7 completion pass (user's detailed Module 7 list, 2026-11-17)
Audit: already done = editor, presets, colour pickers, font, header style, sections add/remove/toggle/edit, grid columns, card style, device preview, draft/publish, history/restore, live storefront.
- [ ] Header customization (logo display, announcement bar, cart/search toggles)
- [ ] Navigation menu (custom links: sections, collections, pages, external; bar or menu style)
- [ ] Footer customization (style, about, contact, socials, links, copyright)
- [ ] Drag-and-drop ordering (sections, menu links, footer links; touch + mouse + keyboard)
- [ ] Instant live preview (colours/fonts/layout without reload; keep scroll; click a section in preview to edit it)
- [ ] Colours: hex entry, palettes, contrast warnings; heading font separate from body font
- [ ] Product grid: image shape, fit, sale badge, title lines, products per page
- [ ] Version preview before restore; restore & publish; name a version on publish
- [ ] Tests (unit + integration + browser), docs, ZIP v3
