import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const prefsSchema = z.object({
  newOrderInApp: z.boolean(), lowStockInApp: z.boolean(), lowStockEmail: z.boolean(),
  lowStockThreshold: z.number().int().min(0).max(10000), dailySummaryEmail: z.boolean(),
  customerEmailUpdates: z.boolean(), customerWhatsappUpdates: z.boolean(), orderAlerts: z.boolean(),
});
export type Prefs = z.infer<typeof prefsSchema>;

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at").eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error("Could not load notifications.");
    return data;
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).parse(input))
  .handler(async ({ context, data }) => {
    let q = context.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("owner_id", context.userId).is("read_at", null);
    if (data.ids?.length) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw new Error("Could not update notifications.");
    return { ok: true };
  });

export const clearNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase.from("notifications").delete().eq("owner_id", context.userId).not("read_at", "is", null);
    if (error) throw new Error("Could not clear notifications.");
    return { ok: true };
  });

export const listDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("notification_outbox").select("id, channel, kind, recipient, subject, status, attempts, next_attempt_at, last_error, sent_at, created_at").eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Could not load the delivery log.");
    return data;
  });

/** Sends anything due now (normally the hourly job does this). */
export const deliverNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { processOutbox } = await import("./notifications.server");
    const { requestOrigin } = await import("./order-alert.server");
    return processOutbox(20, await requestOrigin());
  });

export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [p, profile] = await Promise.all([
      context.supabase.from("notification_preferences").select("*").eq("owner_id", context.userId).maybeSingle(),
      context.supabase.from("profiles").select("order_alerts").eq("id", context.userId).single(),
    ]);
    if (p.error || profile.error) throw new Error("Could not load notification settings.");
    const d = p.data;
    const { gmailConfigured } = await import("./gmail.server");
    const { whatsappConfigured } = await import("./whatsapp.server");
    return {
      prefs: {
        newOrderInApp: d?.new_order_in_app ?? true, lowStockInApp: d?.low_stock_in_app ?? true, lowStockEmail: d?.low_stock_email ?? false,
        lowStockThreshold: d?.low_stock_threshold ?? 5, dailySummaryEmail: d?.daily_summary_email ?? false,
        customerEmailUpdates: d?.customer_email_updates ?? true, customerWhatsappUpdates: d?.customer_whatsapp_updates ?? false,
        orderAlerts: profile.data.order_alerts,
      } satisfies Prefs,
      gmailConfigured: gmailConfigured(), whatsappConfigured: whatsappConfigured(),
    };
  });

export const saveNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => prefsSchema.parse(input))
  .handler(async ({ context, data }) => {
    const [a, b] = await Promise.all([
      context.supabase.from("notification_preferences").upsert({
        owner_id: context.userId, new_order_in_app: data.newOrderInApp, low_stock_in_app: data.lowStockInApp, low_stock_email: data.lowStockEmail,
        low_stock_threshold: data.lowStockThreshold, daily_summary_email: data.dailySummaryEmail, customer_email_updates: data.customerEmailUpdates,
        customer_whatsapp_updates: data.customerWhatsappUpdates, updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id" }),
      context.supabase.from("profiles").update({ order_alerts: data.orderAlerts }).eq("id", context.userId),
    ]);
    if (a.error || b.error) throw new Error("Could not save notification settings.");
    return { ok: true };
  });

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("audit_log").select("id, action, entity, entity_id, details, actor, created_at").eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Could not load the activity log.");
    return data.map(r => ({ ...r, byYou: r.actor === context.userId }));
  });
