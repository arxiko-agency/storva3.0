import { describe, expect, it } from "vitest";
import { aiInput, canUseAi, plainAiText } from "./ai-tools";

describe("Gemini tool restrictions", () => {
  it("basic AI permits titles but not photo extraction", () => {
    expect(canUseAi(["basic_ai"], "title")).toBe(true);
    expect(canUseAi(["basic_ai"], "image_extract")).toBe(false);
  });
  it("marketing and recommendations require their own entitlements", () => {
    expect(canUseAi(["basic_ai","image_ai"], "social")).toBe(false);
    expect(canUseAi(["recommendations"], "recommendations")).toBe(true);
    expect(canUseAi(["marketing_ai"], "recommendations")).toBe(false);
  });
  it("photo extraction requires an actual supported image", () => {
    const input = { kind: "image_extract", details: "Identify this product", language: "English", tone: "Natural" };
    expect(aiInput.safeParse(input).success).toBe(false);
    expect(aiInput.safeParse({ ...input, image: "data:application/pdf;base64,AAAA" }).success).toBe(false);
    expect(aiInput.safeParse({ ...input, image: "data:image/png;base64,AAAA" }).success).toBe(true);
  });
  it("price suggestions are part of the basic AI tools on every plan", () => {
    expect(canUseAi(["basic_ai"], "pricing")).toBe(true);
    expect(aiInput.safeParse({ kind: "pricing", details: "Banana chips 500g, cost ₹150", language: "English", tone: "Natural" }).success).toBe(true);
  });
  it("shows AI replies as clean text without Markdown symbols", () => {
    expect(plainAiText("### വില\n\n**ശുപാർശ:** ₹240\n* ലാഭം: ₹90\n*(estimate)*")).toBe("വില\n\nശുപാർശ: ₹240\n• ലാഭം: ₹90\n(estimate)");
  });
});
