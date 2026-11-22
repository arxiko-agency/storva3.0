// @vitest-environment node
/**
 * Backend integration tests against the real Lovable Cloud database.
 * Creates two throwaway merchants, exercises auth, row-level isolation, checkout, GST, invoices,
 * notifications, analytics and rate limits, then deletes everything it created.
 * Skips automatically when the server credentials are not present.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { financialYear } from "@/lib/pricing-rules";

const URL_ = process.env["SUPABASE_URL"];
const ANON = process.env["SUPABASE_PUBLISHABLE_KEY"];
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const enabled = !!(URL_ && ANON && SERVICE);

function client(key: string, token?: string) {
  return createClient<Database>(URL_!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        if (token) h.set("Authorization", `Bearer ${token}`);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

type Merchant = { id: string; email: string; db: SupabaseClient<Database>; slug: string };
const run = Date.now().toString(36);
let admin: SupabaseClient<Database>, anon: SupabaseClient<Database>, A: Merchant, B: Merchant;
let productA = "";

async function merchant(tag: string): Promise<Merchant> {
  const email = `it-${tag}-${run}@storva-test.invalid`, password = `T3st!${run}${tag}xyz`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const signIn = await client(ANON!).auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const slug = `it-${tag}-${run}`;
  const db = client(ANON!, signIn.data.session!.access_token);
  const upd = await db.from("profiles").update({ store_name: `IT ${tag}`, store_slug: slug }).eq("id", created.data.user.id);
  if (upd.error) throw upd.error;
  return { id: created.data.user.id, email, db, slug };
}

const customer = (state: string, phone = "9876543210") => ({ name: "Asha Menon", phone, email: "asha@example.com", line1: "12 Beach Road, Fort", line2: "", city: "Kochi", state, pincode: "682001" });
const order = (slug: string, items: { product_id: string; quantity: number }[], state = "Kerala", phone?: string) =>
  admin.rpc("place_order", { _slug: slug, _checkout_key: crypto.randomUUID(), _customer: customer(state, phone), _items: items, _notes: "" });

describe.skipIf(!enabled)("backend integration", () => {
  beforeAll(async () => {
    admin = client(SERVICE!); anon = client(ANON!);
    A = await merchant("a"); B = await merchant("b");
    const p = await A.db.from("products").insert({ owner_id: A.id, title: "Coconut oil 1L", price: 1180, stock: 10, hsn_code: "15131900" }).select("id").single();
    if (p.error) throw p.error;
    productA = p.data.id;
    const c = await A.db.from("store_commerce_settings").upsert({ owner_id: A.id, gst_enabled: true, prices_include_gst: true, default_gst_rate: 18, business_state: "Kerala", gstin: "32ABCDE1234F1Z5", legal_name: "IT Traders", shipping_flat_rate: 50, free_shipping_above: 5000, cod_enabled: true, cod_fee: 20, invoice_prefix: "IT", regions: [{ state: "Ladakh", rate: null, cod: true, deliver: false }, { state: "Goa", rate: 120, cod: false, deliver: true }] });
    if (c.error) throw c.error;
  }, 60000);

  afterAll(async () => {
    if (!admin) return;
    for (const m of [A, B].filter(Boolean)) {
      for (const t of ["ai_requests", "order_items", "orders", "customers", "products", "notifications", "notification_outbox", "notification_preferences", "store_commerce_settings", "store_themes", "theme_versions", "audit_log", "store_events", "invoice_counters"] as const) {
        await admin.from(t).delete().eq("owner_id", m.id);
      }
      await admin.auth.admin.deleteUser(m.id);
    }
    await admin.from("rate_limits").delete().like("subject", `it-${run}%`);
  }, 60000);

  describe("authentication & authorization", () => {
    it("new accounts get a profile and a Free subscription", async () => {
      const { data } = await A.db.from("subscriptions").select("plan_id, status").eq("owner_id", A.id).single();
      expect(data).toEqual({ plan_id: "free", status: "free" });
    });
    it("signed-out visitors cannot read products, orders or customers", async () => {
      for (const t of ["products", "orders", "customers"] as const) {
        const { data } = await anon.from(t).select("id").limit(5);
        expect(data ?? []).toHaveLength(0);
      }
    });
    it("signed-out visitors and merchants cannot call checkout directly (server only)", async () => {
      const items = [{ product_id: productA, quantity: 1 }];
      const viaAnon = await anon.rpc("place_order", { _slug: A.slug, _checkout_key: crypto.randomUUID(), _customer: customer("Kerala"), _items: items, _notes: "" });
      const viaUser = await B.db.rpc("place_order", { _slug: A.slug, _checkout_key: crypto.randomUUID(), _customer: customer("Kerala"), _items: items, _notes: "" });
      expect(viaAnon.error).not.toBeNull(); expect(viaUser.error).not.toBeNull();
    });
    it("signed-out visitors cannot change order status", async () => {
      const r = await anon.rpc("set_order_status", { _order_id: crypto.randomUUID(), _status: "confirmed" });
      expect(r.error).not.toBeNull();
    });
  });

  describe("multi-tenant isolation", () => {
    it("merchant B cannot see or edit merchant A's product", async () => {
      const read = await B.db.from("products").select("id").eq("id", productA);
      expect(read.data).toHaveLength(0);
      const write = await B.db.from("products").update({ price: 1 }).eq("id", productA).select("id");
      expect(write.data ?? []).toHaveLength(0);
      const { data } = await admin.from("products").select("price").eq("id", productA).single();
      expect(Number(data!.price)).toBe(1180);
    });
    it("merchant B cannot insert a product into A's store", async () => {
      const r = await B.db.from("products").insert({ owner_id: A.id, title: "Sneaky", price: 1, stock: 1 });
      expect(r.error).not.toBeNull();
    });
    it("merchant B cannot read A's settings, theme, orders, notifications or audit log", async () => {
      await order(A.slug, [{ product_id: productA, quantity: 1 }]);
      for (const t of ["store_commerce_settings", "orders", "notifications", "notification_outbox", "audit_log", "customers"] as const) {
        const { data } = await B.db.from(t).select("owner_id").eq("owner_id", A.id);
        expect(data ?? [], t).toHaveLength(0);
      }
    });
    it("merchant B cannot change the status of A's order", async () => {
      const { data: o } = await admin.from("orders").select("id").eq("owner_id", A.id).limit(1).single();
      const r = await B.db.rpc("set_order_status", { _order_id: o!.id, _status: "confirmed" });
      expect(r.error?.message).toContain("NOT_FOUND");
    });
  });

  describe("checkout, GST and shipping (Module 12)", () => {
    it("charges CGST + SGST in Kerala with delivery and COD fee", async () => {
      const r = await order(A.slug, [{ product_id: productA, quantity: 1 }], "Kerala", "9000000001");
      expect(r.error).toBeNull();
      const { data: o } = await admin.from("orders").select("subtotal, tax_total, cgst, sgst, igst, shipping_fee, cod_fee, total, taxable_total").eq("id", (r.data as { order_id: string }).order_id).single();
      expect(o).toMatchObject({ subtotal: 1180, taxable_total: 1000, tax_total: 180, cgst: 90, sgst: 90, igst: 0, shipping_fee: 50, cod_fee: 20, total: 1250 });
    });
    it("charges IGST to another state", async () => {
      const r = await order(A.slug, [{ product_id: productA, quantity: 1 }], "Tamil Nadu", "9000000002");
      const { data: o } = await admin.from("orders").select("cgst, sgst, igst").eq("id", (r.data as { order_id: string }).order_id).single();
      expect(o).toMatchObject({ cgst: 0, sgst: 0, igst: 180 });
    });
    it("refuses states the shop does not deliver to, and COD where it is off", async () => {
      expect((await order(A.slug, [{ product_id: productA, quantity: 1 }], "Ladakh", "9000000003")).error?.message).toContain("UNSERVICEABLE");
      expect((await order(A.slug, [{ product_id: productA, quantity: 1 }], "Goa", "9000000004")).error?.message).toContain("COD_UNAVAILABLE");
    });
    it("refuses COD for a customer the merchant blocked", async () => {
      await order(A.slug, [{ product_id: productA, quantity: 1 }], "Kerala", "9000000005");
      const { data: c } = await A.db.from("customers").select("id").eq("phone", "9000000005").single();
      const blocked = await A.db.from("customers").update({ cod_blocked: true }).eq("id", c!.id).select("id");
      expect(blocked.data).toHaveLength(1);
      expect((await order(A.slug, [{ product_id: productA, quantity: 1 }], "Kerala", "9000000005")).error?.message).toContain("COD_UNAVAILABLE");
    });
    it("validates checkout input and stock in the database", async () => {
      const bad = await admin.rpc("place_order", { _slug: A.slug, _checkout_key: crypto.randomUUID(), _customer: { ...customer("Kerala"), phone: "12345" }, _items: [{ product_id: productA, quantity: 1 }], _notes: "" });
      expect(bad.error?.message).toContain("INVALID");
      const tooMany = await order(A.slug, [{ product_id: productA, quantity: 99 }], "Kerala", "9000000006");
      expect(tooMany.error?.message).toContain("OUT_OF_STOCK");
    });
    it("is idempotent for a repeated checkout key", async () => {
      const key = crypto.randomUUID(), args = { _slug: A.slug, _checkout_key: key, _customer: customer("Kerala", "9000000007"), _items: [{ product_id: productA, quantity: 1 }], _notes: "" };
      const first = await admin.rpc("place_order", args), second = await admin.rpc("place_order", args);
      expect((second.data as { duplicate: boolean }).duplicate).toBe(true);
      expect((second.data as { order_id: string }).order_id).toBe((first.data as { order_id: string }).order_id);
    });
  });

  describe("orders, invoices and notifications (Modules 12 & 13)", () => {
    it("issues sequential invoice numbers per financial year on confirmation", async () => {
      const { data: orders } = await admin.from("orders").select("id").eq("owner_id", A.id).eq("status", "pending").order("order_number").limit(2);
      for (const o of orders!) expect((await A.db.rpc("set_order_status", { _order_id: o.id, _status: "confirmed" })).error).toBeNull();
      const { data } = await admin.from("orders").select("invoice_number").in("id", orders!.map(o => o.id)).order("invoice_number");
      const fy = financialYear(new Date());
      expect(data!.map(d => d.invoice_number)).toEqual([`IT/${fy}/00001`, `IT/${fy}/00002`]);
    });
    it("rejects an invalid status jump", async () => {
      const { data: o } = await admin.from("orders").select("id").eq("owner_id", A.id).eq("status", "confirmed").limit(1).single();
      expect((await A.db.rpc("set_order_status", { _order_id: o!.id, _status: "delivered" })).error?.message).toContain("INVALID_TRANSITION");
    });
    it("returns stock when an order is cancelled", async () => {
      const before = (await admin.from("products").select("stock").eq("id", productA).single()).data!.stock;
      const r = await order(A.slug, [{ product_id: productA, quantity: 2 }], "Kerala", "9000000008");
      const id = (r.data as { order_id: string }).order_id;
      expect((await admin.from("products").select("stock").eq("id", productA).single()).data!.stock).toBe(before - 2);
      await A.db.rpc("set_order_status", { _order_id: id, _status: "cancelled" });
      expect((await admin.from("products").select("stock").eq("id", productA).single()).data!.stock).toBe(before);
    });
    it("creates an in-app notification and a queued email for each new order", async () => {
      const { count: n } = await A.db.from("notifications").select("id", { count: "exact", head: true }).eq("kind", "new_order");
      const { count: q } = await A.db.from("notification_outbox").select("id", { count: "exact", head: true }).eq("kind", "new_order");
      expect(n).toBeGreaterThan(0); expect(q).toBe(n);
    });
    it("queues an email update to the customer when an order is confirmed", async () => {
      const { data } = await A.db.from("notification_outbox").select("recipient, kind").eq("kind", "order_status").limit(1);
      expect(data?.[0]?.recipient).toBe("asha@example.com");
    });
    it("raises a low-stock notification when stock crosses the threshold", async () => {
      await A.db.from("products").update({ stock: 3 }).eq("id", productA);
      const { data } = await A.db.from("notifications").select("title").eq("kind", "low_stock");
      expect(data?.some(r => r.title.includes("Coconut oil"))).toBe(true);
    });
    it("retries failed deliveries with backoff and gives up after 5 attempts", async () => {
      const ins = await admin.from("notification_outbox").insert({ owner_id: A.id, channel: "email", kind: "test", subject: "t", dedupe_key: `it-${run}` }).select("id").single();
      await admin.from("notification_outbox").update({ attempts: 5 }).eq("id", ins.data!.id);
      await admin.rpc("finish_outbox", { _id: ins.data!.id, _outcome: "failed", _error: "boom" });
      const { data } = await admin.from("notification_outbox").select("status, last_error").eq("id", ins.data!.id).single();
      expect(data).toEqual({ status: "failed", last_error: "boom" });
    });
    it("records merchant actions in the audit log", async () => {
      const { data } = await A.db.from("audit_log").select("action");
      const actions = new Set(data!.map(r => r.action));
      expect(actions.has("products.insert")).toBe(true);
      expect(actions.has("order.confirmed")).toBe(true);
      expect(actions.has("customer.cod_blocked")).toBe(true);
    });
  });

  describe("store designer (Module 7)", () => {
    it("shoppers only see the published design, not the draft", async () => {
      await A.db.from("store_themes").upsert({ owner_id: A.id, draft: { preset: "draft-only" } });
      expect(((await anon.rpc("storefront", { _slug: A.slug })).data as { theme: unknown }).theme).toBeNull();
      await A.db.from("store_themes").upsert({ owner_id: A.id, draft: { preset: "night" }, published: { preset: "night" }, published_at: new Date().toISOString() });
      expect(((await anon.rpc("storefront", { _slug: A.slug })).data as { theme: { preset: string } }).theme.preset).toBe("night");
    });
    it("merchant B cannot overwrite A's design", async () => {
      const r = await B.db.from("store_themes").upsert({ owner_id: A.id, draft: {}, published: { preset: "hacked" } });
      expect(r.error).not.toBeNull();
    });
  });

  describe("analytics & rate limits (Modules 14 & 15)", () => {
    it("counts visitors without cookies and de-duplicates repeat views", async () => {
      for (let i = 0; i < 3; i++) await admin.rpc("track_store_event", { _slug: A.slug, _fingerprint: "1.2.3.4|ua", _event: "view", _source: "instagram.com" });
      await admin.rpc("track_store_event", { _slug: A.slug, _fingerprint: "5.6.7.8|ua", _event: "view" });
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const { data, error } = await A.db.rpc("analytics_report", { _from: today, _to: today });
      expect(error).toBeNull();
      const r = data as { totals: { visitors: number; orders: number }; sources: { source: string }[]; funnel: { view: number } };
      expect(r.funnel.view).toBe(2);
      expect(r.sources.map(s => s.source)).toContain("instagram.com");
      expect(r.totals.orders).toBeGreaterThan(0);
      const { data: ev } = await A.db.from("store_events").select("visitor").limit(1);
      expect(ev?.[0]?.visitor).toMatch(/^[0-9a-f]{32}$/);
    });
    it("rejects analytics date ranges over a year", async () => {
      expect((await A.db.rpc("analytics_report", { _from: "2024-01-01", _to: "2026-01-01" })).error?.message).toContain("INVALID");
    });
    it("produces a GST report with HSN totals", async () => {
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const { data } = await A.db.rpc("gst_report", { _from: today, _to: today });
      const r = data as { invoices: unknown[]; hsn: { hsn: string }[] };
      expect(r.invoices.length).toBeGreaterThan(0);
      expect(r.hsn.map(h => h.hsn)).toContain("15131900");
    });
    it("allows 10 checkouts per device per 10 minutes, then blocks", async () => {
      const results: boolean[] = [];
      for (let i = 0; i < 11; i++) results.push((await admin.rpc("hit_rate_limit", { _bucket: "checkout", _subject: `it-${run}-device` })).data as boolean);
      expect(results.slice(0, 10).every(Boolean)).toBe(true);
      expect(results[10]).toBe(false);
    });
    it("does not let signed-in merchants use the rate limiter or tracker directly", async () => {
      expect((await A.db.rpc("hit_rate_limit", { _bucket: "checkout", _subject: "x" })).error).not.toBeNull();
      expect((await A.db.rpc("track_store_event", { _slug: A.slug, _fingerprint: "x", _event: "view" })).error).not.toBeNull();
    });
  });

  describe("AI quota (Module 9)", () => {
    it("the Free plan can use the price suggestion tool but not marketing tools", async () => {
      const ok = await B.db.rpc("reserve_ai_request", { _kind: "pricing", _input: { details: "test" } });
      expect(ok.error).toBeNull();
      const blocked = await B.db.rpc("reserve_ai_request", { _kind: "marketing", _input: { details: "test" } });
      expect(blocked.error?.message).toContain("does not include");
      const unknown = await B.db.rpc("reserve_ai_request", { _kind: "hack", _input: {} });
      expect(unknown.error?.message).toContain("Unknown AI tool");
    });
  });

  describe("plan limits (Module 8)", () => {
    it("the Free plan stops at 25 products", async () => {
      const rows = Array.from({ length: 24 }, (_, i) => ({ owner_id: B.id, title: `P${i}`, price: 1, stock: 1 }));
      for (const r of rows) await B.db.from("products").insert(r);
      expect((await B.db.from("products").insert({ owner_id: B.id, title: "P24", price: 1, stock: 1 })).error).toBeNull();
      const over = await B.db.from("products").insert({ owner_id: B.id, title: "P25", price: 1, stock: 1 });
      expect(over.error?.message).toContain("LIMIT_PRODUCTS");
    });
  });
});
