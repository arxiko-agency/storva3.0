import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { WhatsappWorkspace } from "@/components/whatsapp-workspace";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({ meta: [
    { title: "STORVA — WhatsApp messages" },
    { name: "description", content: "Manage private WhatsApp message drafts, templates and delivery history for your STORVA store." },
    { property: "og:title", content: "STORVA — WhatsApp messages" },
    { property: "og:description", content: "Your store’s WhatsApp messages, templates and connection status." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><WhatsappWorkspace /></StoreShell>,
});