import { z } from "zod";

export const AI_TOOLS = [
  { id: "title", label: "Product title", detail: "Clear, memorable names", feature: "basic_ai" },
  { id: "description", label: "Description", detail: "Product copy that sells", feature: "basic_ai" },
  { id: "seo", label: "SEO content", detail: "Search titles & keywords", feature: "basic_ai" },
  { id: "category", label: "Categories", detail: "Find the right shelf", feature: "basic_ai" },
  { id: "pricing", label: "Price suggestion", detail: "A fair price range", feature: "basic_ai" },
  { id: "image_extract", label: "From a photo", detail: "Identify product details", feature: "image_ai" },
  { id: "marketing", label: "Marketing copy", detail: "Campaigns & promotions", feature: "marketing_ai" },
  { id: "social", label: "Social captions", detail: "Posts with personality", feature: "marketing_ai" },
  { id: "recommendations", label: "Recommendations", detail: "Relevant catalog matches", feature: "recommendations" },
] as const;

export const aiInput = z.object({
  kind: z.enum(["title", "description", "seo", "category", "pricing", "image_extract", "marketing", "social", "recommendations"]),
  details: z.string().trim().min(3).max(8000),
  language: z.enum(["English", "Malayalam", "Hindi"]),
  tone: z.enum(["Natural", "Professional", "Playful", "Luxury"]),
  image: z.string().max(7000000).optional(),
}).superRefine((data, ctx) => {
  if (data.kind === "image_extract" && !data.image) ctx.addIssue({ code: "custom", message: "Choose a product photo.", path: ["image"] });
  if (data.image && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.image)) ctx.addIssue({ code: "custom", message: "Use a JPEG, PNG or WebP photo.", path: ["image"] });
});
export type AiInput = z.infer<typeof aiInput>;

export function canUseAi(features: unknown, kind: AiInput["kind"]) {
  const tool = AI_TOOLS.find(t => t.id === kind);
  return Array.isArray(features) && !!tool && features.includes(tool.feature);
}
/** AI replies may contain Markdown symbols; shop owners copy the text straight into listings, so show clean text. */
export function plainAiText(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
