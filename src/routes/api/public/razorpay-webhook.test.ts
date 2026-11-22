// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "@/lib/razorpay.server";

const inserted: unknown[] = [];
vi.mock("@/integrations/supabase/client.server", () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }), update: () => chain, upsert: async () => ({}) };
  return { supabaseAdmin: { from: (t: string) => ({ ...chain, insert: async (row: unknown) => { inserted.push({ t, row }); return { error: inserted.length > 1 ? { code: "23505" } : null }; } }) } };
});

async function post(body: string, signature?: string) {
  const { Route } = await import("./razorpay-webhook");
  const handler = (Route.options.server as { handlers: { POST: (c: { request: Request }) => Promise<Response> } }).handlers.POST;
  return handler({ request: new Request("http://x/api/public/razorpay-webhook", { method: "POST", body, headers: signature ? { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_1" } : {} }) });
}

describe("Razorpay webhook verification (Module 8)", () => {
  beforeEach(() => { inserted.length = 0; process.env["RAZORPAY_WEBHOOK_SECRET"] = "test_secret"; });
  afterEach(() => { delete process.env["RAZORPAY_WEBHOOK_SECRET"]; });
  it("refuses events when no webhook secret is configured", async () => { delete process.env["RAZORPAY_WEBHOOK_SECRET"]; expect((await post("{}", "x")).status).toBe(503); });
  it("rejects a missing or wrong signature before touching the database", async () => {
    expect((await post('{"event":"subscription.charged"}')).status).toBe(401);
    expect((await post('{"event":"subscription.charged"}', "deadbeef")).status).toBe(401);
    expect(inserted).toHaveLength(0);
  });
  it("accepts a correctly signed event and ignores a replay of the same event", async () => {
    const body = JSON.stringify({ event: "subscription.authenticated", payload: {} });
    const sig = await hmacSha256Hex("test_secret", body);
    expect((await post(body, sig)).status).toBe(200);
    const replay = await post(body, sig);
    expect(await replay.text()).toBe("duplicate");
  });
});
