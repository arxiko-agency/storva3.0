import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { AiStudio } from "@/components/ai-studio";
export const Route = createFileRoute("/ai-studio")({
  head: () => ({ meta: [
    { title: "AI studio · STORVA" },
    { name: "description", content: "Create product titles, descriptions, SEO and marketing content with your STORVA AI studio." },
    { property: "og:title", content: "AI studio · STORVA" },
    { property: "og:description", content: "Your merchant workspace for product content, photos and recommendations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><AiStudio /></StoreShell>,
});
