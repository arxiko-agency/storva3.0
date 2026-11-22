import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { AnalyticsWorkspace } from "@/components/analytics-workspace";

export const Route = createFileRoute("/analytics")({
  head: () => ({ meta: [
    { title: "STORVA — Analytics & reports" },
    { name: "description", content: "Sales, visitors, shopping funnel, traffic sources, top products and GST filing exports." },
    { property: "og:title", content: "STORVA — Analytics & reports" },
    { property: "og:description", content: "Sales and visitor reports for your STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><AnalyticsWorkspace /></StoreShell>,
});
