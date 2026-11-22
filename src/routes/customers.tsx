import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { CustomersWorkspace } from "@/components/customers-workspace";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [
    { title: "STORVA — Customers" },
    { name: "description", content: "Every shopper who ordered from your store, with order history, segments, notes and CSV export." },
    { property: "og:title", content: "STORVA — Customers" },
    { property: "og:description", content: "Customer records and order histories for your STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><CustomersWorkspace /></StoreShell>,
});
