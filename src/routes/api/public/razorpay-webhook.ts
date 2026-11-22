import { createFileRoute } from "@tanstack/react-router";

// Razorpay subscription webhook. Every request is verified with HMAC-SHA256
// over the raw body using RAZORPAY_WEBHOOK_SECRET before anything is processed.
export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook not configured", { status: 503 });
        const { hmacSha256Hex, timingSafeEqualStr, unixToIso, rz } = await import("@/lib/razorpay.server");
        const raw = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const expected = await hmacSha256Hex(secret, raw);
        if (!signature || !timingSafeEqualStr(expected, signature)) return new Response("Invalid signature", { status: 401 });

        let event: any;
        try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
        const eventId = request.headers.get("x-razorpay-event-id") ?? `${event.event}:${event.created_at}:${event.payload?.payment?.entity?.id ?? event.payload?.subscription?.entity?.id}`;

        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const { error: dupErr } = await db.from("payment_events").insert({ event_id: eventId, event_type: String(event.event), payload: event });
        if (dupErr) {
          // Only a unique-violation means "already received". Any other database error must NOT be
          // answered with 200, otherwise Razorpay would never retry and the event would be lost.
          if ((dupErr as { code?: string }).code === "23505") return new Response("duplicate", { status: 200 });
          return new Response("Could not record event", { status: 500 });
        }

        // If handling fails half-way, forget the event id so Razorpay's automatic retry is processed again
        // (previously the id stayed saved and the retry was dropped as a "duplicate").
        const must = <T extends { error?: unknown } | null | undefined>(r: T): T => {
          if (r && (r as { error?: unknown }).error) throw new Error("webhook database write failed");
          return r;
        };
        try {

        const s = event.payload?.subscription?.entity;
        const pay = event.payload?.payment?.entity;
        const subId: string | undefined = s?.id ?? pay?.subscription_id ?? event.payload?.invoice?.entity?.subscription_id;
        if (!subId) return new Response("ignored");
        const { data: row, error: rowErr } = await db.from("subscriptions").select("*").eq("razorpay_subscription_id", subId).maybeSingle();
        if (rowErr) throw rowErr;
        const ownerId = row?.owner_id ?? s?.notes?.owner_id;
        if (!ownerId) return new Response("unknown subscription");

        // Map Razorpay plan id back to our plan + interval
        let mapped: { id: string; interval: string } | null = null;
        if (s?.plan_id) {
          const { data: plans, error: plansErr } = await db.from("plans").select("id,razorpay_plan_monthly,razorpay_plan_yearly");
          if (plansErr) throw plansErr;
          for (const p of plans ?? []) {
            if (p.razorpay_plan_monthly === s.plan_id) mapped = { id: p.id, interval: "monthly" };
            if (p.razorpay_plan_yearly === s.plan_id) mapped = { id: p.id, interval: "yearly" };
          }
        }
        const now = new Date().toISOString();
        const period = s ? { current_period_start: unixToIso(s.current_start), current_period_end: unixToIso(s.current_end) } : {};
        const planFields = mapped ? { plan_id: mapped.id, billing_interval: mapped.interval } : {};
        const clearPending = mapped && row?.pending_plan_id === mapped.id ? { pending_plan_id: null, pending_interval: null } : {};

        switch (event.event) {
          case "subscription.authenticated":
            break;
          case "subscription.activated":
          case "subscription.resumed":
          case "subscription.charged":
            must(await db.from("subscriptions").update({ ...planFields, ...period, ...clearPending, status: "active", last_payment_error: null, updated_at: now }).eq("owner_id", ownerId));
            if (event.event === "subscription.charged" && pay) {
              let invoiceUrl: string | null = null;
              if (pay.invoice_id) {
                try { invoiceUrl = (await rz<any>(`/invoices/${pay.invoice_id}`)).short_url ?? null; } catch { /* optional */ }
              }
              must(await db.from("invoices").upsert({
                owner_id: ownerId, razorpay_payment_id: pay.id, razorpay_invoice_id: pay.invoice_id ?? null,
                plan_id: mapped?.id ?? row?.plan_id ?? null, amount: pay.amount, currency: pay.currency ?? "INR",
                status: "paid", invoice_url: invoiceUrl,
              }, { onConflict: "razorpay_payment_id" }));
            }
            break;
          case "subscription.updated":
            must(await db.from("subscriptions").update({ ...planFields, ...period, ...clearPending, updated_at: now }).eq("owner_id", ownerId));
            break;
          case "subscription.pending":
            must(await db.from("subscriptions").update({ status: "past_due", last_payment_error: "Renewal payment failed. Razorpay will retry automatically.", updated_at: now }).eq("owner_id", ownerId));
            break;
          case "subscription.halted":
          case "subscription.completed":
          case "subscription.expired":
            must(await db.from("subscriptions").update({ status: "expired", updated_at: now }).eq("owner_id", ownerId));
            break;
          case "subscription.cancelled":
            must(await db.from("subscriptions").update({ ...period, status: "cancelled", cancel_at_period_end: true, updated_at: now }).eq("owner_id", ownerId));
            break;
          case "payment.failed":
            if (pay) {
              must(await db.from("invoices").upsert({
                owner_id: ownerId, razorpay_payment_id: pay.id, amount: pay.amount, currency: pay.currency ?? "INR",
                status: "failed", failure_reason: pay.error_description ?? "Payment failed", plan_id: row?.plan_id ?? null,
              }, { onConflict: "razorpay_payment_id" }));
              must(await db.from("subscriptions").update({ last_payment_error: pay.error_description ?? "Payment failed", updated_at: now }).eq("owner_id", ownerId));
            }
            break;
        }
        } catch (err) {
          console.error("razorpay webhook handling failed", err);
          await db.from("payment_events").delete().eq("event_id", eventId);
          return new Response("Processing failed; please retry", { status: 500 });
        }
        return new Response("ok");
      },
    },
  },
});
