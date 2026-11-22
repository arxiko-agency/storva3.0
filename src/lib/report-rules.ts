import { toCsv } from "./order-rules";
import type { GstReport } from "./analytics.functions";

/** Percentage (one decimal) of b relative to a; 0 when a is 0. */
export function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Last N days ending today in India time, as YYYY-MM-DD strings. */
export function lastDays(n: number, now = new Date()) {
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return { from: ist(new Date(now.getTime() - (n - 1) * 86400000)), to: ist(now) };
}

type SalesRow = { order_number: number | null; created_at: string; status: string; customer_name: string; customer_phone: string | null; shipping_address: unknown; subtotal: number | string; shipping_fee: number | string; cod_fee: number | string; tax_total: number | string; cgst: number | string; sgst: number | string; igst: number | string; total: number | string; payment_status: string; invoice_number: string | null; source: string };
const n2 = (v: number | string) => Number(v).toFixed(2);
const istDate = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function salesCsv(rows: SalesRow[]) {
  return toCsv([
    ["Order", "Date", "Status", "Customer", "Phone", "State", "PIN", "Items (incl. GST)", "Delivery", "COD fee", "GST", "CGST", "SGST", "IGST", "Total", "Payment", "Invoice", "Source"],
    ...rows.map(r => { const a = (r.shipping_address ?? {}) as { state?: string; pincode?: string }; return [r.order_number, istDate(r.created_at), r.status, r.customer_name, r.customer_phone, a.state, a.pincode, n2(r.subtotal), n2(r.shipping_fee), n2(r.cod_fee), n2(r.tax_total), n2(r.cgst), n2(r.sgst), n2(r.igst), n2(r.total), r.payment_status, r.invoice_number, r.source]; }),
  ]);
}

/** Invoice register for GST filing (B2C). Cancelled invoices are listed with zero values so numbering has no gaps. */
export function gstInvoicesCsv(report: GstReport) {
  return toCsv([
    ["Invoice number", "Invoice date", "Order", "Customer", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Delivery", "COD fee", "Invoice total", "Status"],
    ...report.invoices.map(i => { const c = i.status === "cancelled"; return [i.invoice_number, istDate(i.invoiced_at), i.order_number, i.customer, i.place_of_supply, c ? "0.00" : n2(i.taxable), c ? "0.00" : n2(i.cgst), c ? "0.00" : n2(i.sgst), c ? "0.00" : n2(i.igst), c ? "0.00" : n2(i.shipping), c ? "0.00" : n2(i.cod_fee), c ? "0.00" : n2(i.total), c ? "Cancelled" : "Issued"]; }),
  ]);
}

export function hsnCsv(report: GstReport) {
  return toCsv([["HSN", "GST rate %", "Quantity", "Taxable value", "Tax"], ...report.hsn.map(h => [h.hsn, h.rate, h.quantity, n2(h.taxable), n2(h.tax)])]);
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
