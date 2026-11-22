import { escapeHtml, formatMoney, type ShippingAddress } from "./order-rules";

type AlertResult = { sent: true } | { sent: false; reason: string };

/**
 * Emails the store owner (their verified sign-in address) about a new order,
 * then records the outcome on the order. Never sends twice for one order.
 */
export async function sendOrderAlert(orderId: string, appOrigin: string | null): Promise<AlertResult> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: order, error } = await db.from("orders").select("*, order_items(title, quantity, unit_price, line_total)").eq("id", orderId).single();
  if (error || !order) throw new Error("Order not found.");
  if (order.alert_sent_at) return { sent: false, reason: "already_sent" };

  const record = async (patch: { alert_sent_at?: string; alert_error: string | null }) => {
    const { error: e } = await db.from("orders").update(patch).eq("id", orderId);
    if (e) console.error("Could not record order alert outcome", e.message);
  };

  const { data: profile } = await db.from("profiles").select("store_name, order_alerts").eq("id", order.owner_id).single();
  if (profile && !profile.order_alerts) return { sent: false, reason: "disabled" };

  const { data: owner, error: userError } = await db.auth.admin.getUserById(order.owner_id);
  const to = owner?.user?.email;
  if (userError || !to || !owner.user.email_confirmed_at) {
    await record({ alert_error: "Your account email is not verified, so no alert could be sent." });
    return { sent: false, reason: "unverified_owner" };
  }

  const { gmailConfigured, sendGmail } = await import("./gmail.server");
  if (!gmailConfigured()) {
    await record({ alert_error: "Gmail is not connected." });
    return { sent: false, reason: "not_configured" };
  }

  const store = profile?.store_name ?? "your store";
  const items = (order.order_items ?? []) as { title: string; quantity: number; unit_price: number; line_total: number }[];
  const addr = (order.shipping_address ?? {}) as ShippingAddress;
  const address = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ");
  const link = appOrigin ? `${appOrigin}/orders` : null;
  const subject = `New order #${order.order_number} — ${formatMoney(order.total)} from ${order.customer_name}`;
  const text = [
    `New order #${order.order_number} on ${store}`,
    "",
    ...items.map(i => `${i.quantity} × ${i.title} — ${formatMoney(i.line_total)}`),
    `Total: ${formatMoney(order.total)} (Cash on delivery)`,
    "",
    `Customer: ${order.customer_name}`,
    `Phone: ${order.customer_phone ?? ""}`,
    order.customer_email ? `Email: ${order.customer_email}` : "",
    `Deliver to: ${address}`,
    order.notes ? `Notes: ${order.notes}` : "",
    link ? `\nOpen your orders: ${link}` : "",
  ].filter(l => l !== "").join("\n");
  const e = escapeHtml;
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2a24;max-width:560px">
<h2 style="margin:0 0 4px">New order #${order.order_number}</h2>
<p style="margin:0 0 16px;color:#5b6b62">${e(store)} · ${new Date(order.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
<table style="width:100%;border-collapse:collapse">${items.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #e3e8e5">${i.quantity} × ${e(i.title)}</td><td style="padding:6px 0;border-bottom:1px solid #e3e8e5;text-align:right">${e(formatMoney(i.line_total))}</td></tr>`).join("")}
<tr><td style="padding:8px 0;font-weight:bold">Total (Cash on delivery)</td><td style="padding:8px 0;text-align:right;font-weight:bold">${e(formatMoney(order.total))}</td></tr></table>
<p style="margin:16px 0 4px"><b>${e(order.customer_name)}</b><br>${e(order.customer_phone ?? "")}${order.customer_email ? `<br>${e(order.customer_email)}` : ""}</p>
<p style="margin:0 0 16px">${e(address)}</p>
${order.notes ? `<p style="margin:0 0 16px"><b>Notes:</b> ${e(order.notes)}</p>` : ""}
${link ? `<p><a href="${e(link)}" style="background:#1d6b52;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none">Open orders</a></p>` : ""}
</div>`;

  try {
    await sendGmail({ to, subject, html, text });
    await record({ alert_sent_at: new Date().toISOString(), alert_error: null });
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email could not be sent.";
    await record({ alert_error: message.slice(0, 500) });
    return { sent: false, reason: "send_failed" };
  }
}

export async function requestOrigin() {
  try {
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    return getRequestUrl().origin;
  } catch {
    return null;
  }
}
