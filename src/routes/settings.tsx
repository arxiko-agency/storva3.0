import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { SettingsWorkspace } from "@/components/settings-workspace";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [
    { title: "STORVA — Store settings" },
    { name: "description", content: "Set delivery charges, cash on delivery rules, GST and invoices, notifications and account security." },
    { property: "og:title", content: "STORVA — Store settings" },
    { property: "og:description", content: "Shipping, GST, notifications and security for your STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><SettingsWorkspace /></StoreShell>,
});
