import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ORDER_STATUSES, friendlyDbError } from "./order-rules";

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("id, order_number, customer_id, customer_name, customer_email, customer_phone, shipping_address, notes, subtotal, total, quantity, status, payment_method, payment_status, source, alert_sent_at, alert_error, created_at, updated_at, shipping_fee, cod_fee, tax_total, cgst, sgst, igst, gst_applied, prices_include_gst, invoice_number, invoiced_at, courier, tracking_number, tracking_url, confirmed_at, shipped_at, delivered_at, order_items(id, title, quantity, unit_price, line_total, gst_rate, tax_amount)")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error("Could not load your orders.");
    return data;
  });

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), status: z.enum(ORDER_STATUSES) }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("set_order_status", { _order_id: data.id, _status: data.status });
    if (error) throw new Error(friendlyDbError(error.message));
    try {
      const { processOutbox } = await import("./notifications.server");
      const { requestOrigin } = await import("./order-alert.server");
      await processOutbox(5, await requestOrigin());
    } catch (e) { console.error("Customer update delivery failed; it will be retried", e); }
    return { ok: true };
  });

export const resendOrderAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    // Ownership check through RLS before any privileged work.
    const { data: order, error } = await context.supabase.from("orders").select("id").eq("id", data.id).eq("owner_id", context.userId).single();
    if (error || !order) throw new Error("Order not found.");
    const { sendOrderAlert, requestOrigin } = await import("./order-alert.server");
    const result = await sendOrderAlert(order.id, await requestOrigin());
    if (!result.sent && result.reason !== "already_sent") {
      const { data: after } = await context.supabase.from("orders").select("alert_error").eq("id", order.id).single();
      throw new Error(result.reason === "disabled" ? "Order alerts are switched off in your store settings." : after?.alert_error ?? "The alert email could not be sent.");
    }
    return { ok: true };
  });
