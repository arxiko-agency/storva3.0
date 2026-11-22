import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { ThemeDesigner } from "@/components/theme-designer";

export const Route = createFileRoute("/design")({
  head: () => ({ meta: [
    { title: "STORVA — Store designer" },
    { name: "description", content: "Design your shop: colours, fonts, header, menu, sections, product grid and footer with a live preview." },
    { property: "og:title", content: "STORVA — Store designer" },
    { property: "og:description", content: "Customise and publish your STORVA shop's look." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><ThemeDesigner /></StoreShell>,
});
