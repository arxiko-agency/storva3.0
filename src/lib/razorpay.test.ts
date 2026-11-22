import { describe, expect, it } from "vitest";
import { hmacSha256Hex, timingSafeEqualStr } from "./razorpay.server";

describe("razorpay signature", () => {
  it("computes HMAC-SHA256 hex (RFC 4231 case 2)", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  it("rejects a mismatched signature", () => expect(timingSafeEqualStr("abc", "abd")).toBe(false));
});
