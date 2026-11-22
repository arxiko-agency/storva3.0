import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { CatalogWorkspace } from "@/components/catalog-workspace";

export const Route = createFileRoute("/products")({
  head: () => ({ meta: [
    { title: "STORVA — Store & products" },
    { name: "description", content: "Set your shop link and order alerts, and manage the products shoppers can order." },
    { property: "og:title", content: "STORVA — Store & products" },
    { property: "og:description", content: "Manage your STORVA catalog and shop settings." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><CatalogWorkspace /></StoreShell>,
});
