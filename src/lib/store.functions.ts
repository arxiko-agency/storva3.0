import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkoutSchema, friendlyDbError, productSchema, storeSettingsSchema } from "./order-rules";
import { parseTheme, themeImagePaths, type Theme } from "./theme-rules";
import type { CommerceSettings } from "./pricing-rules";

export type StorefrontProduct = { id: string; title: string; description: string; price: number; compare_at_price: number | null; category: string | null; image_path: string | null; gst_rate: number | null; available: number };
export type Storefront = { store_name: string; slug: string; theme: Theme; commerce: StorefrontCommerce; products: StorefrontProduct[]; images: Record<string, string> };
export type StorefrontCommerce = Omit<CommerceSettings, "regions"> & { regions?: { state: string; rate: number | null; cod: boolean; deliver: boolean }[] };

/** Public: a store's name, published design, delivery rules and catalog for its shop page. */
export const getStorefront = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().trim().toLowerCase().max(40) }).parse(input))
  .handler(async ({ data }) => {
    const { publicDb } = await import("./public-db.server");
    const { data: store, error } = await publicDb().rpc("storefront", { _slug: data.slug });
    if (error) throw new Error("This store is unavailable right now.");
    if (!store) return null;
    const raw = store as { store_name: string; slug: string; theme: unknown; commerce: StorefrontCommerce; products: (Omit<StorefrontProduct, "price" | "compare_at_price" | "gst_rate"> & { price: number | string; compare_at_price: number | string | null; gst_rate: number | string | null })[] };
    const theme = parseTheme(raw.theme);
    const products = raw.products.map(p => ({ ...p, price: Number(p.price), compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price), gst_rate: p.gst_rate === null ? null : Number(p.gst_rate) }));
    const { signImages } = await import("./images.server");
    const images = await signImages([...themeImagePaths(theme), ...products.map(p => p.image_path)]);
    return { store_name: raw.store_name, slug: raw.slug, theme, commerce: raw.commerce ?? {}, products, images } satisfies Storefront;
  });

/** Public: shopper checkout. Rate-limited per visitor; prices, stock, shipping, COD and GST are computed in the database. */
export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => checkoutSchema.extend({ source: z.string().max(60).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { clientInfo, withinRateLimit } = await import("./request.server");
    const who = await clientInfo();
    if (!(await withinRateLimit("checkout", `${data.slug}:${who.ip}`))) throw new Error("Too many orders from this device. Please wait a few minutes and try again.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("place_order", {
      _slug: data.slug,
      _checkout_key: data.checkoutKey,
      _customer: data.customer,
      _items: data.items.map(i => ({ product_id: i.productId, quantity: i.quantity })),
      _notes: data.notes,
    });
    if (error) throw new Error(friendlyDbError(error.message));
    const order = result as { order_id: string; order_number: number; total: number; duplicate: boolean };
    if (!order.duplicate) {
      await supabaseAdmin.rpc("track_store_event", { _slug: data.slug, _fingerprint: `${who.ip}|${who.userAgent}`, _event: "order", _source: data.source ?? "direct", _path: "/checkout" });
      try {
        const { processOutbox } = await import("./notifications.server");
        const { requestOrigin } = await import("./order-alert.server");
        await processOutbox(5, await requestOrigin());
      } catch (e) { console.error("Notification delivery failed; it will be retried", e); }
    }
    return { orderNumber: order.order_number, total: Number(order.total) };
  });

const trackSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  event: z.enum(["view", "product_view", "add_to_cart", "checkout_start"]),
  source: z.string().trim().max(60).regex(/^[\w.\-]*$/).default("direct"),
  path: z.string().max(200).regex(/^\/[\w\-./]*$/).default("/"),
  productId: z.string().uuid().optional(),
});
/** Public, cookie-less visit tracking: the visitor id is a daily-rotating hash; no IP or cookie is stored. */
export const trackStoreEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => trackSchema.parse(input))
  .handler(async ({ data }) => {
    const { clientInfo, withinRateLimit } = await import("./request.server");
    const who = await clientInfo();
    if (!(await withinRateLimit("track", who.ip))) return { ok: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("track_store_event", { _slug: data.slug, _fingerprint: `${who.ip}|${who.userAgent}`, _event: data.event, _source: data.source || "direct", _path: data.path, ...(data.productId ? { _product: data.productId } : {}) });
    return { ok: !error };
  });

export const getStoreSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("profiles").select("store_name, store_slug, order_alerts").eq("id", context.userId).single();
    if (error) throw new Error("Could not load your store settings.");
    const { gmailConfigured } = await import("./gmail.server");
    const email = typeof context.claims.email === "string" ? context.claims.email : null;
    return { ...data, alertEmail: email, gmailConfigured: gmailConfigured() };
  });

export const updateStoreSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => storeSettingsSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("profiles").update({ store_name: data.storeName, store_slug: data.storeSlug, order_alerts: data.orderAlerts }).eq("id", context.userId);
    if (error) throw new Error(error.code === "23505" ? "That store link is already taken. Try another." : "Could not save your store settings.");
    return { ok: true };
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("products").select("id, title, description, price, compare_at_price, stock, category, hsn_code, gst_rate, image_path, image_size, seo_title, seo_description, seo_keywords, updated_at").eq("owner_id", context.userId).order("title").limit(1000);
    if (error) throw new Error("Could not load your products.");
    const { signImages } = await import("./images.server");
    const images = await signImages(data.map(p => p.image_path), 60 * 60);
    return data.map(p => ({ ...p, price: Number(p.price), compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price), gst_rate: p.gst_rate === null ? null : Number(p.gst_rate), image_url: p.image_path ? images[p.image_path] ?? null : null }));
  });

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => productSchema.parse(input))
  .handler(async ({ context, data }) => {
    const row: { title: string; description: string; price: number; stock: number; category: string | null; compare_at_price: number | null; hsn_code: string | null; gst_rate: number | null; image_path?: string | null; image_size?: number } = {
      title: data.title, description: data.description, price: data.price, stock: data.stock, category: data.category || null,
      compare_at_price: data.compareAtPrice, hsn_code: data.hsnCode || null, gst_rate: data.gstRate,
    };
    if (data.imagePath !== undefined) {
      if (data.imagePath === "") { row.image_path = null; row.image_size = 0; }
      else {
        const { isOwnImagePath, imageSize } = await import("./images.server");
        if (!isOwnImagePath(data.imagePath, context.userId)) throw new Error("Upload the photo again.");
        const size = await imageSize(data.imagePath);
        if (size === null) throw new Error("The photo upload didn't finish. Upload it again.");
        row.image_path = data.imagePath; row.image_size = size;
      }
    }
    const result = data.id
      ? await context.supabase.from("products").update(row).eq("id", data.id).eq("owner_id", context.userId).select("id").single()
      : await context.supabase.from("products").insert({ ...row, owner_id: context.userId }).select("id").single();
    if (result.error) throw new Error(friendlyDbError(result.error.message));
    return result.data;
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase.from("products").delete().eq("id", data.id).eq("owner_id", context.userId).select("image_path").single();
    if (error) throw new Error("Could not delete this product.");
    if (row?.image_path) await context.supabase.storage.from("product-images").remove([row.image_path]);
    return { ok: true };
  });
