import { supabase } from "@/integrations/supabase/client";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export function imageProblem(file: { type: string; size: number }) {
  if (!TYPES[file.type]) return "Use a JPG, PNG, WebP or GIF image.";
  if (file.size > MAX_IMAGE_BYTES) return "Images can be at most 5 MB.";
  return null;
}

/** Uploads an image into the signed-in merchant's own folder and returns its storage path. */
export async function uploadImage(file: File): Promise<string> {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sign in again to upload images.");
  const path = `${data.user.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
  const { error } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message.includes("exceeded") ? "Images can be at most 5 MB." : "Could not upload this image.");
  return path;
}
