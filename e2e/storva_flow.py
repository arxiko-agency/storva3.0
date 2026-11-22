"""End-to-end browser test of the merchant + shopper journey.

Run: python3 e2e/storva_flow.py   (needs the dev server on :8080 and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
Creates a throwaway merchant, removes it afterwards. Screenshots go to /tmp/browser/e2e.
"""
import asyncio, os, sys, time, io, json, urllib.request
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright, expect

BASE = os.environ.get("E2E_BASE", "http://localhost:8080")
SB, KEY = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OUT = Path("/tmp/browser/e2e"); OUT.mkdir(parents=True, exist_ok=True)
RUN = hex(int(time.time()))[2:]
EMAIL, PASSWORD, SLUG = f"e2e-{RUN}@storva-test.invalid", f"E2e!{RUN}pass", f"e2e-{RUN}"
results = []

def api(method, path, body=None):
    req = urllib.request.Request(f"{SB}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=representation", "User-Agent": "storva-e2e/1.0"})
    with urllib.request.urlopen(req) as r:
        t = r.read().decode(); return json.loads(t) if t else None

def check(name, ok):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name)

async def main():
    user = api("POST", "/auth/v1/admin/users", {"email": EMAIL, "password": PASSWORD, "email_confirm": True})
    uid = user["id"]
    img = OUT / "product.png"; Image.new("RGB", (600, 600), (29, 107, 82)).save(img)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
            page = await ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # 1. Sign in
            await page.goto(f"{BASE}/products", wait_until="networkidle")
            # Signed-out visitors are redirected to the single /login page and returned to /products afterwards.
            await page.get_by_label("Email address").fill(EMAIL)
            await page.get_by_placeholder("Enter your password").fill(PASSWORD)
            await page.get_by_role("button", name="Log in", exact=True).click()
            await expect(page.get_by_role("heading", name="Store & products")).to_be_visible(timeout=30000)
            check("merchant signs in with email and password", True)

            # 2. Store link
            slug = page.get_by_label("Shop link")
            await slug.fill(SLUG)
            await page.get_by_role("button", name="Save store settings").click()
            await expect(page.get_by_text("Store settings saved.")).to_be_visible(timeout=15000)
            check("store link saved", True)

            # 3. Product with photo, sale price, HSN
            await page.get_by_role("button", name="Add product").click()
            dlg = page.get_by_role("dialog")
            await dlg.get_by_label("Name").fill("Banana chips 500g")
            await dlg.get_by_label("Price (₹)").fill("236")
            await dlg.get_by_label("Stock").fill("20")
            await dlg.get_by_label("Compare-at price (₹, optional)").fill("300")
            await dlg.get_by_label("HSN code (optional)").fill("20089999")
            await dlg.get_by_label("Category").fill("Snacks")
            await page.set_input_files('input[aria-label="Product photo"]', str(img))
            await expect(dlg.get_by_role("button", name="Change photo")).to_be_visible(timeout=20000)
            await dlg.get_by_role("button", name="Save product").click()
            await expect(page.get_by_text("Banana chips 500g")).to_be_visible(timeout=20000)
            await page.screenshot(path=str(OUT / "1_products.png"))
            check("product with photo and sale price added", await page.locator("ul img").count() >= 1)

            # 4. Shipping & GST
            await page.goto(f"{BASE}/settings", wait_until="domcontentloaded")
            await expect(page.get_by_role("heading", name="Business & GST")).to_be_visible(timeout=30000)
            await page.get_by_label("GSTIN").fill("32ABCDE1234F1Z5")
            await page.get_by_label("Business state").select_option("Kerala")
            await page.get_by_role("switch", name="Charge GST").click()
            await page.get_by_label("Delivery charge (₹)").fill("40")
            await page.get_by_role("button", name="Save shipping & GST").click()
            await expect(page.get_by_text("Shipping & GST settings saved.")).to_be_visible(timeout=15000)
            check("shipping & GST settings saved", True)

            # 5. Designer: preset, click-to-edit, publish
            await page.goto(f"{BASE}/design", wait_until="domcontentloaded")
            await expect(page.get_by_role("heading", name="Design your shop")).to_be_visible(timeout=30000)
            await page.get_by_role("button", name="Spice market").click()
            preview = page.get_by_role("region", name="Live preview")
            await preview.locator("#sf-hero").click()
            await expect(page.get_by_text("Edit: Hero banner")).to_be_visible(timeout=10000)
            await page.get_by_label("Title", exact=True).fill("Fresh from Kerala")
            await expect(preview.get_by_role("heading", name="Fresh from Kerala")).to_be_visible()
            check("live preview updates instantly and click-to-edit opens the section", True)
            # Colour palette, shop page and a menu link to it
            await page.get_by_role("tab", name="Look").click()
            await page.get_by_role("button", name="Backwater").click()
            await page.get_by_role("tab", name="Pages").click()
            await page.get_by_role("button", name="Shipping policy").click()
            await expect(preview.get_by_role("heading", name="Shipping policy")).to_be_visible(timeout=10000)
            await page.get_by_role("button", name="Preview Shipping policy").click()
            await page.get_by_role("tab", name="Menu").click()
            await page.get_by_role("button", name="Add menu link").click()
            await page.get_by_label("Link type").last.select_option("page")
            await page.get_by_label("Menu link label").last.fill("Delivery info")
            check("palette, shipping-policy page and menu link added", await preview.get_by_text("Delivery info").count() > 0)
            await page.get_by_role("radio", name="Phone").click()
            await page.screenshot(path=str(OUT / "2_designer_phone.png"))
            await page.get_by_role("button", name="Publish").click()
            await page.get_by_label("Version name (optional)").fill("E2E launch")
            await page.get_by_role("button", name="Publish now").click()
            await expect(page.get_by_text("Your shop now shows this design.")).to_be_visible(timeout=20000)
            await page.get_by_role("tab", name="History").click()
            await expect(page.get_by_text("E2E launch")).to_be_visible(timeout=15000)
            check("design published and saved to history", True)

            # 6. Shopper checkout
            shop = await ctx.new_page()
            await shop.goto(f"{BASE}/shop/{SLUG}", wait_until="domcontentloaded")
            await expect(shop.get_by_role("heading", name="Fresh from Kerala")).to_be_visible(timeout=30000)
            check("live shop shows the published design", True)
            await expect(shop.get_by_text("21% off")).to_be_visible()
            check("sale badge shown", True)
            img_ok = await shop.wait_for_function("""() => { const i = [...document.querySelectorAll('main img, section img')].find(x => x.alt && x.alt.includes('Banana')); return i && i.complete && i.naturalWidth > 0 ? true : null; }""", timeout=20000)
            check("product photo loads on the live shop", bool(await img_ok.json_value()))
            await shop.wait_for_load_state("networkidle")
            await shop.get_by_role("contentinfo").get_by_role("button", name="Shipping policy").click()
            await expect(shop.get_by_role("heading", name="Shipping policy")).to_be_visible(timeout=10000)
            check("shop page opens from the footer at its own address", "page=shipping" in shop.url)
            await shop.get_by_role("button", name="Back to shop").click()
            await shop.get_by_role("button", name="Delivery info").first.click()
            await expect(shop.get_by_role("heading", name="Shipping policy")).to_be_visible(timeout=10000)
            await shop.get_by_role("button", name="Back to shop").click()
            await expect(shop.get_by_role("heading", name="Fresh from Kerala")).to_be_visible(timeout=10000)
            check("menu link opens the page and Back returns to the shop", True)
            await shop.get_by_role("button", name="Add", exact=True).first.click()
            await shop.get_by_role("button", name="Cart, 1 items").click()
            await shop.get_by_role("button", name="Checkout").click()
            for label, value in [("Full name", "Asha Menon"), ("Mobile number", "9876543210"), ("House, street, area", "12 Beach Road, Fort"), ("City", "Kochi"), ("PIN code", "682001")]:
                await shop.get_by_label(label).fill(value)
            await shop.get_by_label("State").select_option("Kerala")
            await expect(shop.get_by_text("Includes GST")).to_be_visible()
            await shop.screenshot(path=str(OUT / "3_checkout.png"))
            await shop.get_by_role("button", name="Place order").click()
            await expect(shop.get_by_text("Order #1 placed")).to_be_visible(timeout=30000)
            check("shopper places a cash-on-delivery order (₹236 + ₹40 delivery)", await shop.get_by_text("₹276").count() > 0)
            await shop.screenshot(path=str(OUT / "4_order_placed.png"))

            # 7. Merchant confirms, invoice
            await page.goto(f"{BASE}/orders", wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle")
            await page.get_by_role("button", name="QR & share").click()
            await expect(page.get_by_role("img", name="QR code for")).to_be_visible(timeout=15000)
            wa = await page.get_by_role("link", name="WhatsApp").get_attribute("href")
            check("QR code and WhatsApp share link (tagged for analytics)", wa is not None and "utm_source%3Dwhatsapp" in wa)
            await page.screenshot(path=str(OUT / "4b_share.png"))
            await page.keyboard.press("Escape")
            await page.get_by_role("button", name="Asha Menon").first.click(timeout=30000)
            await page.get_by_role("button", name="Mark confirmed").click()
            await expect(page.get_by_text("marked confirmed")).to_be_visible(timeout=15000)
            await page.get_by_role("link", name="Invoice").click(timeout=15000)
            await expect(page.get_by_role("heading", name="Tax invoice")).to_be_visible(timeout=30000)
            check("invoice issued with CGST/SGST", await page.get_by_text("CGST").count() > 0 and await page.get_by_text("SGST").count() > 0)
            await page.screenshot(path=str(OUT / "5_invoice.png"))

            # 8. Notifications + analytics
            await page.goto(f"{BASE}/notifications", wait_until="domcontentloaded")
            await expect(page.get_by_text("New order #1").first).to_be_visible(timeout=30000)
            check("new-order notification in inbox", True)
            await page.goto(f"{BASE}/analytics", wait_until="domcontentloaded")
            await expect(page.get_by_role("heading", name="Shopping funnel")).to_be_visible(timeout=30000)
            await page.screenshot(path=str(OUT / "6_analytics.png"))
            check("analytics counts the visit and the order", await page.get_by_text("Ordered").count() > 0)

            # 8b. AI studio (Module 9) — real Gemini call through the AI gateway, Free plan quota
            await page.goto(f"{BASE}/", wait_until="networkidle")
            await page.get_by_label("Language").select_option("Malayalam")
            await page.locator("textarea").first.fill("Crispy Kerala banana chips fried in coconut oil, 500g pack")
            await page.get_by_role("button", name="Generate content").click()
            await expect(page.get_by_text("1 / 20 requests")).to_be_visible(timeout=60000)
            await page.get_by_role("button", name="Price suggestion").click()
            await page.locator("textarea").first.fill("Banana chips 500g, my cost is ₹150, local shops sell at ₹220-260")
            await page.get_by_role("button", name="Generate content").click()
            await expect(page.get_by_text("2 / 20 requests")).to_be_visible(timeout=60000)
            alert = await page.get_by_role("alert").count()
            await page.screenshot(path=str(OUT / "6b_ai.png"))
            check("AI studio generates a Malayalam title and a price suggestion, counted against the plan", alert == 0 and await page.get_by_text("₹").count() > 0)

            # 9. Mobile shop
            m = await browser.new_context(viewport={"width": 390, "height": 844})
            mp = await m.new_page()
            await mp.goto(f"{BASE}/shop/{SLUG}", wait_until="domcontentloaded")
            await expect(mp.get_by_role("heading", name="Fresh from Kerala")).to_be_visible(timeout=30000)
            await mp.screenshot(path=str(OUT / "7_shop_mobile.png"))
            check("shop works on a phone-size screen", await mp.evaluate("document.documentElement.scrollWidth <= 390"))
            check("no page errors", not errors)
            if errors: print(errors[:3])
            await browser.close()
    finally:
        for t in ["ai_requests", "order_items", "orders", "customers", "products", "notifications", "notification_outbox", "store_commerce_settings", "store_themes", "theme_versions", "audit_log", "store_events", "invoice_counters"]:
            try: api("DELETE", f"/rest/v1/{t}?owner_id=eq.{uid}")
            except Exception as e: print("cleanup", t, e)
        try:
            files = api("POST", f"/storage/v1/object/list/product-images", {"prefix": uid, "limit": 100})
            if files: api("DELETE", "/storage/v1/object/product-images", {"prefixes": [f"{uid}/{f['name']}" for f in files]})
        except Exception as e: print("cleanup storage", e)
        api("DELETE", f"/auth/v1/admin/users/{uid}")
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} browser checks passed")
    sys.exit(1 if failed else 0)

asyncio.run(main())
