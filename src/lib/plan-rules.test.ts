import { describe, expect, it } from "vitest";
import { isUpgrade, withinLimit, hasFeature, formatINR } from "./plan-rules";

const starter = { price_monthly: 49900, price_yearly: 499000 };
const pro = { price_monthly: 149900, price_yearly: 1499000 };

describe("plan rules", () => {
  it("Starter -> Pro is an upgrade", () => expect(isUpgrade(starter, "monthly", pro, "monthly")).toBe(true));
  it("Pro -> Starter is a downgrade", () => expect(isUpgrade(pro, "monthly", starter, "monthly")).toBe(false));
  it("monthly -> yearly on same plan is not an upgrade (cheaper per month)", () =>
    expect(isUpgrade(starter, "monthly", starter, "yearly")).toBe(false));
  it("unlimited limit always allows", () => expect(withinLimit(null, 99999)).toBe(true));
  it("Free allows 25 products: 25th used blocks the 26th", () => {
    expect(withinLimit(25, 24)).toBe(true);
    expect(withinLimit(25, 25)).toBe(false);
  });
  it("Free plan has no image AI", () => expect(hasFeature({ features: ["basic_ai"] }, "image_ai")).toBe(false));
  it("Starter monthly price is Rs 499", () => expect(formatINR(49900)).toBe("₹499"));
});
