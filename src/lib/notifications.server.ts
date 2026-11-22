import { escapeHtml } from "./order-rules";

type OutboxRow = { id: string; owner_id: string; channel: string; kind: string; recipient: string | null; subject: string; body: string; payload: unknown };
type Outcome = { outcome: "sent" | "skipped" | "retry"; error?: string };

async function deliver(row: OutboxRow, origin: string | null): Promise<Outcome> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const payload = (row.payload ?? {}) as { order_id?: string; order_number?: string | number; store?: string; status?: string };
  if (row.channel === "email") {
    if (row.kind === "new_order") {
      const { sendOrderAlert } = await import("./order-alert.server");
      if (!payload.order_id) return { outcome: "skipped", error: "Order missing." };
      const r = await sendOrderAlert(payload.order_id, origin);
      if (r.sent || r.reason === "already_sent") return { outcome: "sent" };
      if (r.reason === "send_failed") return { outcome: "retry", error: "Gmail could not send the alert." };
      return { outcome: "skipped", error: r.reason === "disabled" ? "Order alerts are switched off." : r.reason === "not_configured" ? "Gmail is not connected." : "Your account email is not verified." };
    }
    const { gmailConfigured, sendGmail } = await import("./gmail.server");
    if (!gmailConfigured()) return { outcome: "skipped", error: "Gmail is not connected." };
    let to = row.recipient;
    if (!to) {
      const { data } = await db.auth.admin.getUserById(row.owner_id);
      if (!data?.user?.email || !data.user.email_confirmed_at) return { outcome: "skipped", error: "Your account email is not verified." };
      to = data.user.email;
    }
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>${escapeHtml(row.subject)}</h2><p style="white-space:pre-line">${escapeHtml(row.body)}</p>${origin && !row.recipient ? `<p><a href="${escapeHtml(origin)}/notifications">Open STORVA</a></p>` : ""}</div>`;
    try { await sendGmail({ to, subject: row.subject, html, text: row.body }); return { outcome: "sent" }; }
    catch (e) { return { outcome: "retry", error: e instanceof Error ? e.message : "Email failed." }; }
  }
  if (row.channel === "whatsapp") {
    const { whatsappConfigured, whatsappRequest } = await import("./whatsapp.server");
    if (!whatsappConfigured()) return { outcome: "skipped", error: "WhatsApp is not connected." };
    const { data: conn } = await db.from("whatsapp_connections").select("state").eq("owner_id", row.owner_id).maybeSingle();
    if (!conn || conn.state !== "active") return { outcome: "skipped", error: "Your WhatsApp number is not connected to this store." };
    // Business-initiated messages need an approved template named "order_update" with 3 body variables: order number, store, status.
    const { data: tpl } = await db.from("whatsapp_templates").select("name, language").eq("owner_id", row.owner_id).eq("name", "order_update").eq("state", "approved").maybeSingle();
    if (!tpl) return { outcome: "skipped", error: "Approve a WhatsApp template named order_update to send order updates." };
    try {
      const params = [String(payload.order_number ?? ""), String(payload.store ?? ""), String(payload.status ?? "")].map(text => ({ type: "text", text }));
      const res = await whatsappRequest<{ messages?: { id: string }[] }>("/messages", { messaging_product: "whatsapp", to: row.recipient, type: "template", template: { name: tpl.name, language: { code: tpl.language }, components: [{ type: "body", parameters: params }] } });
      const providerId = res.messages?.[0]?.id ?? null;
      await db.from("whatsapp_messages").insert({ owner_id: row.owner_id, recipient: row.recipient!, body: row.body, purpose: "order_status", order_id: payload.order_id ?? null, direction: "outbound", state: providerId ? "accepted" : "unresolved", provider_id: providerId, template_name: tpl.name, language: tpl.language });
      return { outcome: "sent" };
    } catch (e) { return { outcome: "retry", error: e instanceof Error ? e.message : "WhatsApp failed." }; }
  }
  return { outcome: "skipped", error: "Unknown channel." };
}

/** Sends due notifications. Failures are retried with growing delays (up to 5 attempts). */
export async function processOutbox(limit = 20, origin: string | null = null) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await db.rpc("claim_outbox", { _limit: limit });
  if (error) throw new Error(`Could not read the notification queue: ${error.message}`);
  const result = { sent: 0, skipped: 0, retry: 0 };
  for (const row of (rows ?? []) as OutboxRow[]) {
    let r: Outcome;
    try { r = await deliver(row, origin); } catch (e) { r = { outcome: "retry", error: e instanceof Error ? e.message : "Delivery failed." }; }
    await db.rpc("finish_outbox", { _id: row.id, _outcome: r.outcome === "retry" ? "failed" : r.outcome, ...(r.error ? { _error: r.error } : {}) });
    result[r.outcome]++;
  }
  return result;
}
