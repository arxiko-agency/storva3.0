import { describe, expect, it } from "vitest";
import { checkoutSchema, customerSegment, friendlyDbError, nextStatuses, toCsv } from "./order-rules";

const base = { slug: "my-shop", checkoutKey: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", items: [{ productId: "0b8c3c6e-1f2a-4b3c-9d4e-5f6a7b8c9d0e", quantity: 2 }], customer: { name: "Priya Shah", phone: "+91 98765 43210", line1: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" } };

describe("Order rules", () => {
  it("order status moves pending → confirmed → packed → shipped → delivered; delivered and cancelled are final", () => {
    expect(nextStatuses("pending")).toEqual(["confirmed", "cancelled"]);
    expect(nextStatuses("shipped")).toEqual(["delivered"]);
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
  });
  it("checkout accepts +91 numbers and stores 10 digits", () => {
    const r = checkoutSchema.safeParse(base);
    expect(r.success && r.data.customer.phone).toBe("9876543210");
  });
  it("checkout rejects a 5-digit PIN code and an empty cart", () => {
    expect(checkoutSchema.safeParse({ ...base, customer: { ...base.customer, pincode: "41100" } }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
  it("checkout rejects more than 99 of one product", () => {
    expect(checkoutSchema.safeParse({ ...base, items: [{ ...base.items[0], quantity: 100 }] }).success).toBe(false);
  });
  it("order limit errors are shown to shoppers without plan details", () => {
    expect(friendlyDbError("LIMIT_ORDERS: Your Free plan allows 50 orders")).toBe("This store can't accept new orders right now. Please try again later.");
    expect(friendlyDbError('OUT_OF_STOCK: Only 1 left of "Mug".')).toBe('Only 1 left of "Mug".');
  });
  it("customers become VIP at 5 orders or ₹10,000 spent, inactive after 90 days", () => {
    const now = Date.parse("2026-11-17T00:00:00Z");
    const recent = "2026-11-10T00:00:00Z";
    expect(customerSegment({ order_count: 5, total_spent: 100, last_order_at: recent, erased_at: null }, now)).toBe("vip");
    expect(customerSegment({ order_count: 1, total_spent: 10000, last_order_at: recent, erased_at: null }, now)).toBe("vip");
    expect(customerSegment({ order_count: 2, total_spent: 500, last_order_at: recent, erased_at: null }, now)).toBe("repeat");
    expect(customerSegment({ order_count: 3, total_spent: 500, last_order_at: "2026-08-18T00:00:00Z", erased_at: null }, now)).toBe("inactive");
  });
  it("CSV export neutralises spreadsheet formulas", () => {
    expect(toCsv([["=HYPERLINK(1)", "a,b"]])).toBe(`'=HYPERLINK(1),"a,b"`);
  });
});
