import { createFileRoute } from "@tanstack/react-router";
import { StoreShell } from "@/components/store-shell";
import { NotificationsWorkspace } from "@/components/notifications-workspace";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [
    { title: "STORVA — Notifications" },
    { name: "description", content: "Your order and stock alerts, plus a log of every email and WhatsApp message sent." },
    { property: "og:title", content: "STORVA — Notifications" },
    { property: "og:description", content: "Alerts and delivery log for your STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <StoreShell><NotificationsWorkspace /></StoreShell>,
});
