import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiInput } from "./ai-tools";

export const getAiHistory = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("ai_requests").select("id,kind,input,output,status,error,created_at").eq("owner_id", context.userId).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const generateAi = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d: unknown) => aiInput.parse(d)).handler(async ({ data, context }) => {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return { text: null, error: "AI is not configured for this store.", requestId: null };
  const { data: requestId, error: reserveError } = await context.supabase.rpc("reserve_ai_request", { _kind: data.kind, _input: { details: data.details, language: data.language, tone: data.tone, hasImage: !!data.image } });
  if (reserveError || !requestId) return { text: null, error: reserveError?.message ?? "Could not reserve AI usage.", requestId: null };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { generateGemini, safeAiError } = await import("./ai.server");
  try {
    let catalog: unknown[] = [];
    if (data.kind === "recommendations") {
      const { data: products, error } = await context.supabase.from("products").select("id,title,category,price,description").eq("owner_id", context.userId).gt("stock", 0).limit(100);
      if (error) throw new Error(error.message);
      catalog = products ?? [];
      if (!catalog.length) throw new Error("No in-stock products are available in your catalog.");
    }
    const result = await generateGemini(data, key, catalog);
    const { error } = await db.from("ai_requests").update({ output: result, status: "success", finished_at: new Date().toISOString() }).eq("id", requestId).eq("owner_id", context.userId);
    if (error) throw new Error("The result could not be saved. Check request history before starting another request.");
    return { text: result.text, error: null, requestId };
  } catch (error) {
    const failure = safeAiError(error);
    await db.from("ai_requests").update({ status: "error", error: failure.message, finished_at: new Date().toISOString() }).eq("id", requestId).eq("owner_id", context.userId);
    if ([402,403].includes(failure.status)) await db.from("ai_service_state").upsert({ id: "gateway", reason: failure.message, status_code: failure.status, blocked: true });
    return { text: null, error: failure.message, requestId };
  }
});