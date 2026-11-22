import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { OrdersDashboard } from "@/components/orders-dashboard";

export const Route = createFileRoute("/orders")({
  head: () => ({ meta: [
    { title: "STORVA — Orders" },
    { name: "description", content: "See new orders the moment they're placed, update their status and track email alerts." },
    { property: "og:title", content: "STORVA — Orders" },
    { property: "og:description", content: "Live order management for your STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><OrdersDashboard /></StoreShell>,
});
