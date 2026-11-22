import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseTheme, themeImagePaths, themeSchema, type Theme } from "./theme-rules";
import type { Json } from "@/integrations/supabase/types";

function assertOwnImages(theme: Theme, userId: string) {
  for (const p of themeImagePaths(theme)) if (!p.startsWith(`${userId}/`)) throw new Error("Images must be uploaded to your own store.");
}

/** Everything the designer needs: draft, published state, versions and preview catalog. */
export const getThemeEditor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [theme, versions, profile, products] = await Promise.all([
      supabase.from("store_themes").select("draft, published, published_at, updated_at").eq("owner_id", userId).maybeSingle(),
      supabase.from("theme_versions").select("id, name, config, created_at").eq("owner_id", userId).order("created_at", { ascending: false }).limit(30),
      supabase.from("profiles").select("store_name, store_slug").eq("id", userId).single(),
      supabase.from("products").select("id, title, description, price, compare_at_price, category, image_path, stock, created_at").eq("owner_id", userId).order("title").limit(200),
    ]);
    if (theme.error || versions.error || profile.error || products.error) throw new Error("Could not load the store designer.");
    const draft = parseTheme(theme.data?.draft ?? theme.data?.published);
    const { signImages } = await import("./images.server");
    const versionThemes = (versions.data ?? []).map(v => ({ id: v.id, name: v.name, created_at: v.created_at, config: parseTheme(v.config) }));
    const images = await signImages([...themeImagePaths(draft), ...versionThemes.flatMap(v => themeImagePaths(v.config)), ...(products.data ?? []).map(p => p.image_path)]);
    return {
      draft,
      hasPublished: !!theme.data?.published,
      publishedAt: theme.data?.published_at ?? null,
      unpublishedChanges: !!theme.data && JSON.stringify(theme.data.draft) !== JSON.stringify(theme.data.published),
      versions: versionThemes,
      store: profile.data,
      products: (products.data ?? []).map(p => ({ ...p, price: Number(p.price), compare_at_price: p.compare_at_price === null ? null : Number(p.compare_at_price), available: Math.max(0, Math.min(p.stock, 99)), gst_rate: null })),
      images,
    };
  });

export const saveThemeDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ theme: themeSchema }).parse(input))
  .handler(async ({ context, data }) => {
    assertOwnImages(data.theme, context.userId);
    const { error } = await context.supabase.from("store_themes").upsert({ owner_id: context.userId, draft: data.theme as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
    if (error) throw new Error("Could not save your design.");
    return { ok: true, savedAt: new Date().toISOString() };
  });

/** Publishes a theme to the live shop and keeps a named version for restoring later. */
export const publishTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ theme: themeSchema, name: z.string().trim().min(1, "Name this version.").max(80) }).parse(input))
  .handler(async ({ context, data }) => {
    assertOwnImages(data.theme, context.userId);
    const now = new Date().toISOString();
    const json = data.theme as unknown as Json;
    const saved = await context.supabase.from("store_themes").upsert({ owner_id: context.userId, draft: json, published: json, published_at: now, updated_at: now }, { onConflict: "owner_id" });
    if (saved.error) throw new Error("Could not publish your design.");
    const version = await context.supabase.from("theme_versions").insert({ owner_id: context.userId, name: data.name, config: json });
    if (version.error) throw new Error("Published, but the version could not be saved to history.");
    return { ok: true, publishedAt: now };
  });

/** Loads a saved version into the draft; optionally publishes it straight away. */
export const restoreThemeVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), publish: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: v, error } = await context.supabase.from("theme_versions").select("name, config").eq("id", data.id).eq("owner_id", context.userId).single();
    if (error || !v) throw new Error("Version not found.");
    const theme = parseTheme(v.config) as unknown as Json;
    const now = new Date().toISOString();
    const saved = data.publish
      ? await context.supabase.from("store_themes").upsert({ owner_id: context.userId, draft: theme, published: theme, published_at: now, updated_at: now }, { onConflict: "owner_id" })
      : await context.supabase.from("store_themes").upsert({ owner_id: context.userId, draft: theme, updated_at: now }, { onConflict: "owner_id" });
    if (saved.error) throw new Error("Could not restore this version.");
    if (data.publish) await context.supabase.from("theme_versions").insert({ owner_id: context.userId, name: `Restored: ${v.name}`.slice(0, 80), config: theme });
    return { ok: true };
  });

export const deleteThemeVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("theme_versions").delete().eq("id", data.id).eq("owner_id", context.userId);
    if (error) throw new Error("Could not delete this version.");
    return { ok: true };
  });

/** Signs a just-uploaded image so the designer can preview it. */
export const signOwnImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const { isOwnImagePath, signImages } = await import("./images.server");
    if (!isOwnImagePath(data.path, context.userId)) throw new Error("Invalid image.");
    const urls = await signImages([data.path]);
    return { url: urls[data.path] ?? null };
  });
