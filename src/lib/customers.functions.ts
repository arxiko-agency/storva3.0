import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyDbError } from "./order-rules";

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("customers").select("*").eq("owner_id", context.userId).order("last_order_at", { ascending: false, nullsFirst: false }).limit(1000);
    if (error) throw new Error("Could not load your customers.");
    return data;
  });

export const getCustomerOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: orders, error } = await context.supabase.from("orders").select("id, order_number, total, status, created_at, order_items(title, quantity)").eq("owner_id", context.userId).eq("customer_id", data.id).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Could not load this customer's orders.");
    return orders;
  });

const tag = z.string().trim().min(1).max(30);
export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), notes: z.string().trim().max(2000), tags: z.array(tag).max(20) }).parse(input))
  .handler(async ({ context, data }) => {
    const tags = [...new Set(data.tags.map(t => t.toLowerCase()))];
    const { error } = await context.supabase.from("customers").update({ notes: data.notes, tags, updated_at: new Date().toISOString() }).eq("id", data.id).eq("owner_id", context.userId).select("id").single();
    if (error) throw new Error("Could not save this customer.");
    return { ok: true };
  });

export const eraseCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("erase_customer", { _customer_id: data.id });
    if (error) throw new Error(friendlyDbError(error.message));
    return { ok: true };
  });
