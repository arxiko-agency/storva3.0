import { describe, expect, it } from "vitest";
import { commerceSchema, financialYear, quoteOrder, rupeesInWords } from "./pricing-rules";

const kerala = { gst_enabled: true, prices_include_gst: true, default_gst_rate: 18, business_state: "Kerala", shipping_flat_rate: 50, free_shipping_above: 2000, cod_enabled: true, cod_fee: 20, cod_max_order: null, regions: [] };

describe("shipping & GST rules (Module 12)", () => {
  it("splits GST included in the price: ₹1,180 at 18% is ₹1,000 + ₹180", () => {
    const q = quoteOrder([{ price: 1180, quantity: 1, gstRate: null }], kerala, "Kerala");
    expect(q.taxable).toBe(1000); expect(q.tax).toBe(180); expect(q.goods).toBe(1180);
  });
  it("charges CGST + SGST within the business state", () => {
    const q = quoteOrder([{ price: 1180, quantity: 1, gstRate: null }], kerala, "Kerala");
    expect([q.cgst, q.sgst, q.igst]).toEqual([90, 90, 0]);
  });
  it("charges IGST to other states", () => {
    const q = quoteOrder([{ price: 1180, quantity: 1, gstRate: null }], kerala, "Tamil Nadu");
    expect([q.cgst, q.sgst, q.igst]).toEqual([0, 0, 180]);
  });
  it("adds GST on top when prices exclude it", () => {
    const q = quoteOrder([{ price: 1000, quantity: 2, gstRate: 5 }], { ...kerala, prices_include_gst: false }, "Kerala");
    expect(q.goods).toBe(2100); expect(q.tax).toBe(100);
  });
  it("adds flat delivery and the COD fee to the total", () => {
    const q = quoteOrder([{ price: 1180, quantity: 1, gstRate: null }], kerala, "Kerala");
    expect(q.shipping).toBe(50); expect(q.codFee).toBe(20); expect(q.total).toBe(1250);
  });
  it("gives free delivery at or above the threshold", () => expect(quoteOrder([{ price: 1000, quantity: 2, gstRate: 0 }], kerala, "Kerala").shipping).toBe(0));
  it("uses a state's own delivery rate", () => {
    const q = quoteOrder([{ price: 100, quantity: 1, gstRate: 0 }], { ...kerala, regions: [{ state: "Assam", rate: 150, cod: true, deliver: true }] }, "Assam");
    expect(q.shipping).toBe(150);
  });
  it("blocks COD above the maximum, for blocked customers and in COD-off states", () => {
    const line = [{ price: 3000, quantity: 1, gstRate: 0 }];
    expect(quoteOrder(line, { ...kerala, cod_max_order: 2500 }, "Kerala").codAvailable).toBe(false);
    expect(quoteOrder(line, kerala, "Kerala", { codBlocked: true }).codAvailable).toBe(false);
    expect(quoteOrder(line, { ...kerala, regions: [{ state: "Goa", rate: null, cod: false, deliver: true }] }, "Goa").codAvailable).toBe(false);
  });
  it("marks states the shop does not deliver to", () => expect(quoteOrder([{ price: 1, quantity: 1, gstRate: 0 }], { regions: [{ state: "Ladakh", rate: null, cod: true, deliver: false }] }, "Ladakh").deliverable).toBe(false));
  it("charges no tax when GST is off", () => expect(quoteOrder([{ price: 500, quantity: 1, gstRate: 18 }], { ...kerala, gst_enabled: false }, "Kerala").tax).toBe(0));
  it("numbers financial years April to March in India time", () => {
    expect(financialYear(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26"); // 31 Mar 23:30 IST
    expect(financialYear(new Date("2026-03-31T18:31:00Z"))).toBe("2026-27"); // 1 Apr 00:01 IST
  });
  it("writes invoice totals in words", () => expect(rupeesInWords(125050.5)).toBe("Rupees One Lakh Twenty Five Thousand Fifty and Fifty Paise Only"));
  it("requires GSTIN and state before charging GST", () => {
    const base = { gstEnabled: true, pricesIncludeGst: true, defaultGstRate: 18, invoicePrefix: "INV", shippingFlatRate: 0, freeShippingAbove: null, codEnabled: true, codFee: 0, codMaxOrder: null, regions: [] };
    expect(commerceSchema.safeParse(base).success).toBe(false);
    expect(commerceSchema.safeParse({ ...base, gstin: "32ABCDE1234F1Z5", businessState: "Kerala" }).success).toBe(true);
    expect(commerceSchema.safeParse({ ...base, gstin: "BAD", businessState: "Kerala" }).success).toBe(false);
  });
});
