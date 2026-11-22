// Server-only request helpers (client IP for rate limits and anonymous analytics).
export async function clientInfo() {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
    return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
  } catch {
    return { ip: "unknown", userAgent: "" };
  }
}

/** True when the caller is still inside the database-defined limit for this bucket. */
export async function withinRateLimit(bucket: "checkout" | "track" | "storefront", subject: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("hit_rate_limit", { _bucket: bucket, _subject: subject });
  if (error) { console.error("Rate limit check failed", error.message); return true; } // fail open: never block real shoppers on an internal error
  return data === true;
}
