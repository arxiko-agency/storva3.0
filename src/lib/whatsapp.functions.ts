import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canReply, messageDraftSchema, templateDraftSchema } from "./whatsapp-rules";
import type { Json } from "@/integrations/supabase/types";

export const getWhatsappOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [connection, messages, templates, deliveries, products, orders] = await Promise.all([
      context.supabase.from("whatsapp_connections").select("*").eq("owner_id", context.userId).maybeSingle(),
      context.supabase.from("whatsapp_messages").select("*").order("created_at", { ascending: false }).limit(100),
      context.supabase.from("whatsapp_templates").select("*").order("created_at", { ascending: false }).limit(100),
      context.supabase.from("whatsapp_webhook_events").select("id,event,received_at,processed_at,processing_error").order("received_at", { ascending: false }).limit(20),
      context.supabase.from("products").select("id,title,description,price,stock").order("title").limit(100),
      context.supabase.from("orders").select("id,customer_name,total,status").order("created_at", { ascending: false }).limit(100),
    ]);
    for (const result of [connection, messages, templates, deliveries, products, orders]) if (result.error) throw new Error(result.error.message);
    const { whatsappConfigured } = await import("./whatsapp.server");
    return { connection: connection.data, configured: whatsappConfigured(), messages: messages.data ?? [], templates: templates.data ?? [], deliveries: deliveries.data ?? [], products: products.data ?? [], orders: orders.data ?? [] };
  });

export const saveWhatsappDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => messageDraftSchema.parse(input))
  .handler(async ({ context, data }) => {
    if (data.orderId) {
      const order = await context.supabase.from("orders").select("id").eq("id", data.orderId).single();
      if (order.error) throw new Error("Order not found.");
    }
    const result = await context.supabase.from("whatsapp_messages").insert({ owner_id: context.userId, recipient: data.recipient, body: data.body, purpose: data.purpose, order_id: data.orderId ?? null }).select("id").single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const deleteWhatsappDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const result = await context.supabase.from("whatsapp_messages").delete().eq("id", data.id).eq("state", "draft").select("id").single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

export const saveWhatsappTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => templateDraftSchema.parse(input))
  .handler(async ({ context, data }) => {
    const result = await context.supabase.from("whatsapp_templates").insert({ ...data, owner_id: context.userId }).select("id").single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const syncWhatsappTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const connection = await context.supabase.from("whatsapp_connections").select("state").eq("owner_id", context.userId).single();
    if (connection.error || connection.data.state !== "active") throw new Error("Your WhatsApp number is not active for this store.");
    const { whatsappRequest } = await import("./whatsapp.server");
    const remote = await whatsappRequest<{ data: { name: string; language: string; category: string; status: string; components: Json }[] }>("/message_templates?limit=100");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = remote.data.map(template => ({ owner_id: context.userId, name: template.name, language: template.language, category: template.category, state: template.status.toLowerCase(), body: "", components: template.components }));
    if (rows.length) {
      const saved = await supabaseAdmin.from("whatsapp_templates").upsert(rows, { onConflict: "owner_id,name,language" });
      if (saved.error) throw new Error(saved.error.message);
    }
    return { count: rows.length };
  });

export const sendWhatsappDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const connection = await context.supabase.from("whatsapp_connections").select("*").eq("owner_id", context.userId).single();
    if (connection.error || connection.data.state !== "active") throw new Error("Your WhatsApp number is not connected to this store.");
    const { whatsappConfigured, whatsappRequest } = await import("./whatsapp.server");
    if (!whatsappConfigured()) throw new Error("WhatsApp is not connected.");
    const draft = await context.supabase.from("whatsapp_messages").select("*").eq("id", data.id).eq("state", "draft").single();
    if (draft.error) throw new Error("Draft not found.");
    const inbound = await context.supabase.from("whatsapp_messages").select("provider_timestamp").eq("recipient", draft.data.recipient).eq("direction", "inbound").order("provider_timestamp", { ascending: false }).limit(1).maybeSingle();
    if (inbound.error) throw new Error(inbound.error.message);
    if (!canReply(inbound.data?.provider_timestamp ?? null)) throw new Error("This customer must message your number first; outside 24 hours, an approved template is required.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claim = await supabaseAdmin.from("whatsapp_messages").update({ state: "sending" }).eq("owner_id", context.userId).eq("id", data.id).eq("state", "draft").select("id").single();
    if (claim.error) throw new Error("This message was already claimed for sending.");
    let response: { messages: { id: string }[] };
    try {
      response = await whatsappRequest("/messages", { messaging_product: "whatsapp", to: draft.data.recipient, type: "text", text: { body: draft.data.body } });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Send outcome unknown";
      const knownFailure = reason.startsWith("WhatsApp request failed [");
      const saved = await supabaseAdmin.from("whatsapp_messages").update({ state: knownFailure ? "failed" : "unresolved", errors: { reason } }).eq("id", data.id);
      if (saved.error) throw new Error(`Could not save send failure: ${saved.error.message}`);
      throw error;
    }
    const providerId = response.messages?.[0]?.id;
    if (!providerId) {
      const saved = await supabaseAdmin.from("whatsapp_messages").update({ state: "unresolved", errors: { reason: "No provider message id returned" } }).eq("id", data.id);
      if (saved.error) throw new Error(saved.error.message);
      throw new Error("Send outcome unresolved; do not resend until reviewed.");
    }
    const saved = await supabaseAdmin.from("whatsapp_messages").update({ state: "accepted", provider_id: providerId }).eq("id", data.id);
    if (saved.error) throw new Error("WhatsApp accepted the message, but its history could not be saved. Do not resend.");
    const reconciled = await supabaseAdmin.rpc("reconcile_whatsapp_message", { _provider_id: providerId });
    if (reconciled.error) throw new Error(reconciled.error.message);
    return { state: "accepted" };
  });