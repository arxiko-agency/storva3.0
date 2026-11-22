import { describe, expect, it } from "vitest";
import { gstInvoicesCsv, lastDays, pct } from "./report-rules";

describe("analytics & reports (Module 14)", () => {
  it("computes conversion percentages safely", () => { expect(pct(1, 8)).toBe(12.5); expect(pct(3, 0)).toBe(0); });
  it("gives the last 7 days in India time", () => expect(lastDays(7, new Date("2026-11-18T20:00:00Z"))).toEqual({ from: "2026-11-13", to: "2026-11-19" }));
  it("lists cancelled invoices with zero values so numbering has no gaps", () => {
    const csv = gstInvoicesCsv({ hsn: [], invoices: [
      { invoice_number: "INV/2026-27/00001", invoiced_at: "2026-11-18T05:00:00Z", order_number: 1, customer: "Asha", place_of_supply: "Kerala", taxable: 1000, cgst: 90, sgst: 90, igst: 0, shipping: 50, cod_fee: 20, total: 1250, status: "delivered" },
      { invoice_number: "INV/2026-27/00002", invoiced_at: "2026-11-18T06:00:00Z", order_number: 2, customer: "Ravi", place_of_supply: "Goa", taxable: 500, cgst: 0, sgst: 0, igst: 90, shipping: 0, cod_fee: 0, total: 590, status: "cancelled" },
    ] }).split("\r\n");
    expect(csv[1]).toContain("INV/2026-27/00001,2026-11-18,1,Asha,Kerala,1000.00,90.00,90.00,0.00,50.00,20.00,1250.00,Issued");
    expect(csv[2]).toContain("0.00,0.00,0.00,0.00,0.00,0.00,0.00,Cancelled");
  });
  it("guards CSV exports against spreadsheet formula injection", () => {
    const csv = gstInvoicesCsv({ hsn: [], invoices: [{ invoice_number: "X", invoiced_at: "2026-11-18T05:00:00Z", order_number: 1, customer: "=HYPERLINK(1)", place_of_supply: null, taxable: 0, cgst: 0, sgst: 0, igst: 0, shipping: 0, cod_fee: 0, total: 0, status: "delivered" }] });
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
