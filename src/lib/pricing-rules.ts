import { z } from "zod";

/** Shipping, COD and GST rules. Mirrors public.place_order in the database (the database is authoritative). */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

const money = z.number().min(0).max(10_000_000);
export const regionSchema = z.object({
  state: z.enum(INDIAN_STATES),
  rate: z.number().min(0).max(100000).nullable().default(null),
  cod: z.boolean().default(true),
  deliver: z.boolean().default(true),
});
export type Region = z.infer<typeof regionSchema>;

export const commerceSchema = z.object({
  legalName: z.string().trim().max(120).default(""),
  gstin: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN.")]).default(""),
  businessAddress: z.string().trim().max(400).default(""),
  businessState: z.union([z.literal(""), z.enum(INDIAN_STATES)]).default(""),
  gstEnabled: z.boolean(),
  pricesIncludeGst: z.boolean(),
  defaultGstRate: z.number().refine(r => (GST_RATES as readonly number[]).includes(r), "Choose a valid GST rate."),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Use 1–10 capital letters, numbers or hyphens."),
  shippingFlatRate: money,
  freeShippingAbove: money.nullable(),
  codEnabled: z.boolean(),
  codFee: money,
  codMaxOrder: money.nullable(),
  regions: z.array(regionSchema).max(40).refine(r => new Set(r.map(x => x.state)).size === r.length, "Each state can only be listed once."),
}).refine(c => !c.gstEnabled || (c.gstin !== "" && c.businessState !== ""), { message: "To charge GST, enter your GSTIN and business state.", path: ["gstin"] });
export type CommerceInput = z.infer<typeof commerceSchema>;

export type CommerceSettings = {
  gst_enabled?: boolean; prices_include_gst?: boolean; default_gst_rate?: number | string; business_state?: string;
  shipping_flat_rate?: number | string; free_shipping_above?: number | string | null; cod_enabled?: boolean;
  cod_fee?: number | string; cod_max_order?: number | string | null; regions?: unknown;
};
export type QuoteLine = { price: number; quantity: number; gstRate: number | null };
export type Quote = {
  goods: number; taxable: number; tax: number; cgst: number; sgst: number; igst: number;
  shipping: number; codFee: number; total: number; codAvailable: boolean; deliverable: boolean; lines: { taxable: number; tax: number; total: number; rate: number }[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown, d = 0) => (v === null || v === undefined || v === "" ? d : Number(v));

export function quoteOrder(lines: QuoteLine[], c: CommerceSettings, state: string, opts: { codBlocked?: boolean } = {}): Quote {
  const gst = !!c.gst_enabled, incl = c.prices_include_gst !== false, defRate = num(c.default_gst_rate, 18);
  const regions = Array.isArray(c.regions) ? (c.regions as Region[]) : [];
  const region = regions.find(r => r.state?.trim().toLowerCase() === state.trim().toLowerCase());
  const out = lines.map(l => {
    const line = r2(l.price * l.quantity);
    const rate = gst ? (l.gstRate ?? defRate) : 0;
    if (gst && incl) { const taxable = r2(line / (1 + rate / 100)); return { taxable, tax: r2(line - taxable), total: line, rate }; }
    if (gst) { const tax = r2(line * rate / 100); return { taxable: line, tax, total: r2(line + tax), rate }; }
    return { taxable: line, tax: 0, total: line, rate: 0 };
  });
  const goods = r2(out.reduce((s, l) => s + l.total, 0));
  const taxable = r2(out.reduce((s, l) => s + l.taxable, 0));
  const tax = r2(out.reduce((s, l) => s + l.tax, 0));
  let shipping = region && region.rate !== null && region.rate !== undefined ? Number(region.rate) : num(c.shipping_flat_rate);
  const freeAbove = c.free_shipping_above === null || c.free_shipping_above === undefined || c.free_shipping_above === "" ? null : Number(c.free_shipping_above);
  if (freeAbove !== null && goods >= freeAbove) shipping = 0;
  const codMax = c.cod_max_order === null || c.cod_max_order === undefined || c.cod_max_order === "" ? null : Number(c.cod_max_order);
  const codAvailable = c.cod_enabled !== false && region?.cod !== false && !opts.codBlocked && (codMax === null || goods + shipping <= codMax);
  const codFee = num(c.cod_fee);
  const intra = gst && !!c.business_state && c.business_state.trim().toLowerCase() === state.trim().toLowerCase();
  const cgst = intra ? r2(tax / 2) : 0;
  const sgst = intra ? r2(tax - cgst) : 0;
  const igst = gst && !intra ? tax : 0;
  return { goods, taxable, tax, cgst, sgst, igst, shipping: r2(shipping), codFee, total: r2(goods + shipping + codFee), codAvailable, deliverable: region?.deliver !== false, lines: out };
}

/** Indian financial year label (April–March, India time), e.g. "2026-27". */
export function financialYear(at: Date) {
  const ist = new Date(at.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Amount in words for invoices (Indian numbering). */
export function rupeesInWords(amount: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? ones[n] ?? "" : `${tens[Math.floor(n / 10)] ?? ""}${n % 10 ? ` ${ones[n % 10] ?? ""}` : ""}`);
  const three = (n: number): string => (n >= 100 ? `${ones[Math.floor(n / 100)] ?? ""} Hundred${n % 100 ? ` ${two(n % 100)}` : ""}` : two(n));
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000), lakh = Math.floor((n % 10000000) / 100000), thousand = Math.floor((n % 100000) / 1000), rest = n % 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(" ");
  };
  const rupees = Math.floor(amount), paise = Math.round((amount - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
