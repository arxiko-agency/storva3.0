import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commerceSchema, type Region } from "./pricing-rules";
import { friendlyDbError } from "./order-rules";
import type { Json } from "@/integrations/supabase/types";

export const getCommerceSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("store_commerce_settings").select("*").eq("owner_id", context.userId).maybeSingle();
    if (error) throw new Error("Could not load shipping & GST settings.");
    const n = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
    return {
      legalName: data?.legal_name ?? "", gstin: data?.gstin ?? "", businessAddress: data?.business_address ?? "", businessState: data?.business_state ?? "",
      gstEnabled: data?.gst_enabled ?? false, pricesIncludeGst: data?.prices_include_gst ?? true, defaultGstRate: n(data?.default_gst_rate) ?? 18,
      invoicePrefix: data?.invoice_prefix ?? "INV", shippingFlatRate: n(data?.shipping_flat_rate) ?? 0, freeShippingAbove: n(data?.free_shipping_above),
      codEnabled: data?.cod_enabled ?? true, codFee: n(data?.cod_fee) ?? 0, codMaxOrder: n(data?.cod_max_order),
      regions: (Array.isArray(data?.regions) ? data!.regions : []) as unknown as Region[],
    };
  });

export const saveCommerceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => commerceSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("store_commerce_settings").upsert({
      owner_id: context.userId, legal_name: data.legalName, gstin: data.gstin || null, business_address: data.businessAddress, business_state: data.businessState,
      gst_enabled: data.gstEnabled, prices_include_gst: data.pricesIncludeGst, default_gst_rate: data.defaultGstRate, invoice_prefix: data.invoicePrefix,
      shipping_flat_rate: data.shippingFlatRate, free_shipping_above: data.freeShippingAbove, cod_enabled: data.codEnabled, cod_fee: data.codFee,
      cod_max_order: data.codMaxOrder, regions: data.regions as unknown as Json, updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message.includes("gstin") ? "Enter a valid 15-character GSTIN." : "Could not save shipping & GST settings.");
    return { ok: true };
  });

/** Everything needed to print a tax invoice / bill of supply for one order. */
export const getInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const [order, seller, profile] = await Promise.all([
      context.supabase.from("orders").select("*, order_items(title, quantity, unit_price, line_total, hsn_code, gst_rate, taxable_value, tax_amount)").eq("id", data.orderId).eq("owner_id", context.userId).single(),
      context.supabase.from("store_commerce_settings").select("legal_name, gstin, business_address, business_state").eq("owner_id", context.userId).maybeSingle(),
      context.supabase.from("profiles").select("store_name").eq("id", context.userId).single(),
    ]);
    if (order.error || !order.data) throw new Error("Order not found.");
    if (!order.data.invoice_number) throw new Error("This order has no invoice yet. Confirm the order to issue one.");
    return { order: order.data, seller: seller.data, storeName: profile.data?.store_name ?? "" };
  });

export const updateOrderShipping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(), courier: z.string().trim().max(60), trackingNumber: z.string().trim().max(60),
    trackingUrl: z.union([z.literal(""), z.string().trim().url().max(300).refine(u => u.startsWith("https://"), "Tracking link must start with https://")]),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("update_order_shipping", { _order_id: data.id, _courier: data.courier, _tracking_number: data.trackingNumber, _tracking_url: data.trackingUrl });
    if (error) throw new Error(friendlyDbError(error.message));
    return { ok: true };
  });

export const setCustomerCodBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), blocked: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("customers").update({ cod_blocked: data.blocked, updated_at: new Date().toISOString() }).eq("id", data.id).eq("owner_id", context.userId).select("id").single();
    if (error) throw new Error("Could not update this customer.");
    return { ok: true };
  });
