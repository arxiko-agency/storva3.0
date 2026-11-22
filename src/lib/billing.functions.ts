import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUpgrade, type BillingInterval } from "@/lib/plan-rules";

const planInput = z.object({
  planId: z.enum(["starter", "pro"]),
  interval: z.enum(["monthly", "yearly"]),
});

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Ensures a Razorpay plan exists for (plan, interval) and returns its id. */
async function ensureRazorpayPlan(planId: string, interval: BillingInterval) {
  const { rz } = await import("@/lib/razorpay.server");
  const db = await admin();
  const { data: plan, error } = await db.from("plans").select("*").eq("id", planId).single();
  if (error || !plan) throw new Error("Unknown plan");
  const col = interval === "monthly" ? "razorpay_plan_monthly" : "razorpay_plan_yearly";
  if (plan[col]) return { plan, rzPlanId: plan[col] as string };
  const created = await rz<{ id: string }>("/plans", {
    method: "POST",
    body: {
      period: interval,
      interval: 1,
      item: { name: `${plan.name} (${interval})`, amount: interval === "monthly" ? plan.price_monthly : plan.price_yearly, currency: "INR" },
      notes: { app_plan: planId, interval },
    },
  });
  await db.from("plans").update(interval === "monthly" ? { razorpay_plan_monthly: created.id } : { razorpay_plan_yearly: created.id }).eq("id", planId);
  return { plan, rzPlanId: created.id };
}

export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: sub }, { data: plans }, { data: usage }, { data: invoices }] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("owner_id", userId).maybeSingle(),
      supabase.from("plans").select("id,name,price_monthly,price_yearly,product_limit,order_limit,storage_mb,ai_limit,trial_days,features,sort").order("sort"),
      supabase.rpc("my_usage"),
      supabase.from("invoices").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    const { razorpayKeys } = await import("@/lib/razorpay.server");
    return {
      subscription: sub,
      plans: plans ?? [],
      usage: (usage ?? {}) as { products: number; orders_month: number; storage_bytes: number; ai_month: number; plan_id: string },
      invoices: invoices ?? [],
      paymentsConfigured: !!razorpayKeys(),
      keyId: razorpayKeys()?.keyId ?? null,
    };
  });

export const startTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planId: z.enum(["starter", "pro"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ends, error } = await context.supabase.rpc("begin_plan_trial", { _plan: data.planId });
    if (error) throw new Error(error.message);
    return { trialEndsAt: ends };
  });

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => planInput.parse(d))
  .handler(async ({ data, context }) => {
    const { rz, razorpayKeys } = await import("@/lib/razorpay.server");
    const keys = razorpayKeys();
    if (!keys) throw new Error("Payments are not set up yet. Add your Razorpay keys to enable checkout.");
    const db = await admin();
    const { data: sub } = await db.from("subscriptions").select("*").eq("owner_id", context.userId).single();
    if (sub?.razorpay_subscription_id && ["active", "past_due"].includes(sub.status)) {
      throw new Error("You already have an active subscription. Use Change plan instead.");
    }
    const { rzPlanId } = await ensureRazorpayPlan(data.planId, data.interval);
    const trialEnd = sub?.status === "trialing" && sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : 0;
    const created = await rz<{ id: string; short_url: string }>("/subscriptions", {
      method: "POST",
      body: {
        plan_id: rzPlanId,
        total_count: data.interval === "monthly" ? 120 : 10,
        customer_notify: 1,
        ...(trialEnd > Date.now() + 60000 ? { start_at: Math.floor(trialEnd / 1000) } : {}),
        notes: { owner_id: context.userId, app_plan: data.planId, interval: data.interval },
      },
    });
    await db.from("subscriptions").update({
      razorpay_subscription_id: created.id,
      razorpay_short_url: created.short_url,
      pending_plan_id: data.planId,
      pending_interval: data.interval,
      updated_at: new Date().toISOString(),
    }).eq("owner_id", context.userId);
    return { subscriptionId: created.id, keyId: keys.keyId };
  });

export const verifyCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ paymentId: z.string().min(1).max(100), subscriptionId: z.string().min(1).max(100), signature: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { rz, razorpayKeys, hmacSha256Hex, timingSafeEqualStr, unixToIso } = await import("@/lib/razorpay.server");
    const keys = razorpayKeys();
    if (!keys) throw new Error("Payments are not set up.");
    const expected = await hmacSha256Hex(keys.keySecret, `${data.paymentId}|${data.subscriptionId}`);
    if (!timingSafeEqualStr(expected, data.signature)) throw new Error("Payment verification failed.");
    const db = await admin();
    const { data: sub } = await db.from("subscriptions").select("*").eq("owner_id", context.userId).single();
    if (!sub || sub.razorpay_subscription_id !== data.subscriptionId) throw new Error("Subscription mismatch.");
    const remote = await rz<any>(`/subscriptions/${data.subscriptionId}`);
    const planId = remote.notes?.app_plan ?? sub.pending_plan_id;
    const interval = remote.notes?.interval ?? sub.pending_interval ?? "monthly";
    const inTrial = sub.status === "trialing" && !remote.current_end;
    await db.from("subscriptions").update({
      plan_id: planId,
      billing_interval: interval,
      status: inTrial ? "trialing" : "active",
      current_period_start: unixToIso(remote.current_start),
      current_period_end: unixToIso(remote.current_end) ?? sub.trial_ends_at,
      pending_plan_id: null,
      pending_interval: null,
      cancel_at_period_end: false,
      last_payment_error: null,
      updated_at: new Date().toISOString(),
    }).eq("owner_id", context.userId);
    return { ok: true };
  });

export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => planInput.parse(d))
  .handler(async ({ data, context }) => {
    const { rz } = await import("@/lib/razorpay.server");
    const db = await admin();
    const { data: sub } = await db.from("subscriptions").select("*").eq("owner_id", context.userId).single();
    if (!sub?.razorpay_subscription_id || !["active", "past_due"].includes(sub.status)) {
      throw new Error("No active paid subscription to change.");
    }
    const { data: plans } = await db.from("plans").select("*").in("id", [sub.plan_id, data.planId]);
    const from = plans?.find((p) => p.id === sub.plan_id);
    const to = plans?.find((p) => p.id === data.planId);
    if (!from || !to) throw new Error("Unknown plan");
    const upgrade = isUpgrade(from, sub.billing_interval as BillingInterval, to, data.interval);
    const { rzPlanId } = await ensureRazorpayPlan(data.planId, data.interval);
    await rz(`/subscriptions/${sub.razorpay_subscription_id}`, {
      method: "PATCH",
      body: { plan_id: rzPlanId, schedule_change_at: upgrade ? "now" : "cycle_end", customer_notify: 1 },
    });
    await db.from("subscriptions").update(
      upgrade
        ? { plan_id: data.planId, billing_interval: data.interval, pending_plan_id: null, pending_interval: null, updated_at: new Date().toISOString() }
        : { pending_plan_id: data.planId, pending_interval: data.interval, updated_at: new Date().toISOString() },
    ).eq("owner_id", context.userId);
    return { applied: upgrade ? "now" : "renewal" };
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data: sub } = await db.from("subscriptions").select("*").eq("owner_id", context.userId).single();
    if (!sub) throw new Error("Subscription not found");
    if (sub.razorpay_subscription_id && ["active", "past_due", "trialing"].includes(sub.status)) {
      const { rz } = await import("@/lib/razorpay.server");
      await rz(`/subscriptions/${sub.razorpay_subscription_id}/cancel`, { method: "POST", body: { cancel_at_cycle_end: sub.status === "active" ? 1 : 0 } });
      await db.from("subscriptions").update({
        cancel_at_period_end: true,
        ...(sub.status === "active" ? {} : { status: "expired" }),
        updated_at: new Date().toISOString(),
      }).eq("owner_id", context.userId);
    } else if (sub.status === "trialing") {
      await db.from("subscriptions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("owner_id", context.userId);
    } else {
      throw new Error("Nothing to cancel.");
    }
    return { ok: true };
  });
