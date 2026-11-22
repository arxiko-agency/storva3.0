// Server-only helpers for the private product-images bucket.
export const IMAGE_BUCKET = "product-images";
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;

export function isOwnImagePath(path: string, ownerId: string) {
  return PATH.test(path) && path.startsWith(`${ownerId}/`);
}

/** Signed, time-limited links for images (shoppers can't list or guess the bucket). */
export async function signImages(paths: (string | null | undefined)[], expiresIn = 60 * 60 * 24): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p && PATH.test(p)))];
  if (!unique.length) return {};
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from(IMAGE_BUCKET).createSignedUrls(unique, expiresIn);
  if (error || !data) { console.error("Could not sign images", error?.message); return {}; }
  const out: Record<string, string> = {};
  for (const row of data) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

/** Size in bytes of an uploaded object, read from storage (never trusted from the browser). */
export async function imageSize(path: string): Promise<number | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [folder = "", name = ""] = path.split("/");
  const { data, error } = await supabaseAdmin.storage.from(IMAGE_BUCKET).list(folder, { search: name, limit: 5 });
  if (error || !data) return null;
  const hit = data.find(o => o.name === name);
  const size = (hit?.metadata as { size?: number } | null)?.size;
  return typeof size === "number" ? size : null;
}
