import { z } from "zod";

export const ORDER_STATUSES = ["pending", "confirmed", "packed", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed next steps for an order. Mirrors public.set_order_status in the database. */
export const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
export const STATUS_LABELS: Record<OrderStatus, string> = { pending: "New", confirmed: "Confirmed", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
export function nextStatuses(status: string): OrderStatus[] {
  return (STATUS_FLOW as Record<string, OrderStatus[]>)[status] ?? [];
}

export function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return digits;
}

export const checkoutSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Unknown store."),
  checkoutKey: z.string().uuid(),
  customer: z.object({
    name: z.string().trim().min(2, "Enter your full name.").max(100),
    phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.")),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address.").max(254)]).optional().default(""),
    line1: z.string().trim().min(5, "Enter your delivery address.").max(200),
    line2: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(2, "Enter your city.").max(80),
    state: z.string().trim().min(2, "Enter your state.").max(80),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code."),
  }),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1, "Your cart is empty.").max(50)
    .refine(items => new Set(items.map(i => i.productId)).size === items.length, "Your cart contains a duplicate item."),
  notes: z.string().trim().max(500).optional().default(""),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1, "Enter a store name.").max(80),
  storeSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Use 3–40 lowercase letters, numbers or hyphens."),
  orderAlerts: z.boolean(),
});

export const productSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Enter a product name.").max(200),
  description: z.string().trim().max(5000).default(""),
  price: z.number().min(0, "Price cannot be negative.").max(10_000_000),
  stock: z.number().int().min(0, "Stock cannot be negative.").max(1_000_000),
  category: z.string().trim().max(80).default(""),
  compareAtPrice: z.number().min(0).max(10_000_000).nullable().default(null),
  hsnCode: z.union([z.literal(""), z.string().trim().regex(/^\d{4,8}$/, "HSN code must be 4–8 digits.")]).default(""),
  gstRate: z.number().refine(r => [0, 0.25, 3, 5, 12, 18, 28].includes(r), "Choose a valid GST rate.").nullable().default(null),
  imagePath: z.string().max(200).optional(),
}).refine(p => p.compareAtPrice === null || p.compareAtPrice > p.price, { message: "The 'compare at' price must be higher than the selling price.", path: ["compareAtPrice"] });

/** Turns database errors like "OUT_OF_STOCK: Only 2 left" into the human part. */
export function friendlyDbError(message: string) {
  if (message.startsWith("LIMIT_ORDERS")) return "This store can't accept new orders right now. Please try again later.";
  if (message.includes("products_hsn_check")) return "HSN code must be 4–8 digits.";
  if (message.includes("products_gst_rate_check")) return "Choose a valid GST rate.";
  const match = message.match(/^[A-Z_]+: (.*)$/s);
  return match ? match[1] : message;
}

export type CustomerSegment = "new" | "repeat" | "vip" | "inactive" | "erased";
export const SEGMENT_LABELS: Record<CustomerSegment, string> = { new: "New", repeat: "Repeat", vip: "VIP", inactive: "Inactive", erased: "Erased" };
/** VIP: 5+ orders or ₹10,000+ spent. Inactive: no order for 90 days. Repeat: 2+ orders. */
export function customerSegment(c: { order_count: number; total_spent: number; last_order_at: string | null; erased_at: string | null }, now = Date.now()): CustomerSegment {
  if (c.erased_at) return "erased";
  if (c.last_order_at && now - Date.parse(c.last_order_at) > 90 * 24 * 60 * 60 * 1000) return "inactive";
  if (c.order_count >= 5 || Number(c.total_spent) >= 10000) return "vip";
  if (c.order_count >= 2) return "repeat";
  return "new";
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map(row => row.map(cell => {
    let v = cell == null ? "" : String(cell);
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // stop spreadsheet formula injection
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\r\n");
}

export function formatMoney(value: number | string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type ShippingAddress = { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
