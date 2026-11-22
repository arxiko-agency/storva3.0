import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyDbError } from "./order-rules";

const range = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .refine(r => r.from <= r.to, "The start date must be before the end date.");

export type AnalyticsReport = {
  daily: { day: string; visitors: number; orders: number; revenue: number }[];
  totals: { visitors: number; orders: number; cancelled: number; revenue: number; tax: number; shipping: number; delivered_revenue: number; customers: number; repeat_customers: number };
  funnel: { view: number; add_to_cart: number; checkout_start: number; order: number };
  sources: { source: string; visitors: number }[];
  status: Record<string, number>;
  top_products: { title: string; units: number; revenue: number }[];
};
export type GstReport = {
  invoices: { invoice_number: string; invoiced_at: string; order_number: number; customer: string; place_of_supply: string | null; taxable: number; cgst: number; sgst: number; igst: number; shipping: number; cod_fee: number; total: number; status: string }[];
  hsn: { hsn: string; rate: number; quantity: number; taxable: number; tax: number }[];
};

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => range.parse(input))
  .handler(async ({ context, data }) => {
    const { data: report, error } = await context.supabase.rpc("analytics_report", { _from: data.from, _to: data.to });
    if (error) throw new Error(friendlyDbError(error.message));
    return report as unknown as AnalyticsReport;
  });

export const getGstReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => range.parse(input))
  .handler(async ({ context, data }) => {
    const { data: report, error } = await context.supabase.rpc("gst_report", { _from: data.from, _to: data.to });
    if (error) throw new Error(friendlyDbError(error.message));
    return report as unknown as GstReport;
  });

/** Orders (with tax breakdown) for the sales CSV export. */
export const getSalesExport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => range.parse(input))
  .handler(async ({ context, data }) => {
    const from = new Date(`${data.from}T00:00:00+05:30`).toISOString();
    const to = new Date(new Date(`${data.to}T00:00:00+05:30`).getTime() + 86400000).toISOString();
    const { data: rows, error } = await context.supabase.from("orders").select("order_number, created_at, status, customer_name, customer_phone, shipping_address, subtotal, shipping_fee, cod_fee, tax_total, cgst, sgst, igst, total, payment_status, invoice_number, source").eq("owner_id", context.userId).gte("created_at", from).lt("created_at", to).order("created_at").limit(5000);
    if (error) throw new Error("Could not export orders.");
    return rows;
  });
