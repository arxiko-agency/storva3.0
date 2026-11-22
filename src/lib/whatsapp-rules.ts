import { z } from "zod";

export const messageDraftSchema = z.object({
  recipient: z.string().regex(/^[1-9]\d{6,14}$/, "Use a country code and digits only, without +."),
  body: z.string().trim().min(1).max(4096),
  purpose: z.enum(["general", "product", "order_confirmation", "payment_confirmation", "order_status"]),
  orderId: z.string().uuid().nullable().optional(),
});
export const templateDraftSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  language: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
  body: z.string().trim().min(1).max(1024),
});
export function canReply(lastInbound: string | null, now = Date.now()) {
  if (!lastInbound) return false;
  const age = now - Date.parse(lastInbound);
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}
export const deliveryRank: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };
export function nextDeliveryState(current: string, incoming: string) {
  if (incoming === "failed") return current === "read" || current === "delivered" ? current : "failed";
  return (deliveryRank[incoming] ?? -1) > (deliveryRank[current] ?? -1) ? incoming : current;
}