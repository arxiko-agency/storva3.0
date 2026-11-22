import { describe, expect, it } from "vitest";
import { canReply, messageDraftSchema, nextDeliveryState } from "./whatsapp-rules";

describe("WhatsApp sending rules", () => {
  it("free-form replies close at 24 hours", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(canReply("2026-11-16T12:00:01Z", now)).toBe(true);
    expect(canReply("2026-11-16T12:00:00Z", now)).toBe(false);
    expect(canReply(null, now)).toBe(false);
  });
  it("recipient numbers require country code digits without plus", () => {
    expect(messageDraftSchema.safeParse({ recipient: "919876543210", body: "Order confirmed", purpose: "order_confirmation" }).success).toBe(true);
    expect(messageDraftSchema.safeParse({ recipient: "+919876543210", body: "Order confirmed", purpose: "order_confirmation" }).success).toBe(false);
  });
  it("older sent callbacks never downgrade delivered or read", () => {
    expect(nextDeliveryState("delivered", "sent")).toBe("delivered");
    expect(nextDeliveryState("read", "delivered")).toBe("read");
    expect(nextDeliveryState("accepted", "sent")).toBe("sent");
  });
});