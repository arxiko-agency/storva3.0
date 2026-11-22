import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhookRequest } from "@lovable.dev/webhooks-js";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";

const payloadSchema = z.object({ entry: z.array(z.object({ changes: z.array(z.object({ value: z.record(z.string(), z.unknown()) }).passthrough()).min(1).max(1) }).passthrough()).min(1).max(1) }).passthrough();

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = process.env['WHATSAPP_API_KEY'];
    if (!secret) return new Response("WhatsApp is not configured", { status: 503 });
    const delivery = request.headers.get("X-Lovable-Delivery");
    const event = request.headers.get("X-Lovable-Event");
    if (!delivery || !event || delivery.length > 200 || event.length > 200) return new Response("Missing delivery headers", { status: 400 });
    let payload: Json;
    try {
      const verified = await verifyWebhookRequest({ req: request, secret, maxBodyBytes: 4 * 1024 * 1024 });
      payload = payloadSchema.parse(verified.payload) as Json;
    } catch { return new Response("Invalid webhook", { status: 401 }); }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stored = await supabaseAdmin.from("whatsapp_webhook_events").upsert({ delivery_id: delivery, event, payload }, { onConflict: "delivery_id", ignoreDuplicates: true });
    if (stored.error) return new Response("Could not store delivery", { status: 503 });
    // Bounded recovery is invoked on every delivery. Retry scheduling moves unmatched
    // and failing rows aside so they cannot starve newer runnable work.
    const processed = await supabaseAdmin.rpc("process_whatsapp_events", { _limit: 10 });
    if (processed.error) return new Response("Processing unavailable", { status: 503 });
    const receipt = await supabaseAdmin.from("whatsapp_webhook_events").select("processed_at,processing_error").eq("delivery_id", delivery).single();
    if (receipt.error) return new Response("Receipt unavailable", { status: 503 });
    if (receipt.data.processing_error && !["Awaiting outbound message record", "Number is not bound to a merchant"].includes(receipt.data.processing_error)) return new Response("Processing failed; retry scheduled", { status: 503 });
    return new Response("ok");
  } } },
});