import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, CheckCheck, Trash2, Send, RefreshCw, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listNotifications, markNotificationsRead, clearNotifications, listDeliveries, deliverNow } from "@/lib/notifications.functions";

const KIND: Record<string, string> = { new_order: "New order alert", order_status: "Customer order update", low_stock: "Low stock alert", daily_summary: "Daily summary" };
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Waiting to retry", variant: "secondary" }, sending: { label: "Sending", variant: "secondary" }, sent: { label: "Sent", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" }, skipped: { label: "Not sent", variant: "secondary" },
};
const when = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function NotificationsWorkspace() {
  const list = useServerFn(listNotifications), mark = useServerFn(markNotificationsRead), clear = useServerFn(clearNotifications), log = useServerFn(listDeliveries), now = useServerFn(deliverNow);
  const client = useQueryClient();
  const inbox = useQuery({ queryKey: ["notifications"], queryFn: () => list() });
  const deliveries = useQuery({ queryKey: ["deliveries"], queryFn: () => log() });
  const [busy, setBusy] = useState("");
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); await Promise.all([client.invalidateQueries({ queryKey: ["notifications"] }), client.invalidateQueries({ queryKey: ["deliveries"] })]); toast.success(ok); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(""); }
  }
  return <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-primary">NOTIFICATIONS</p><h1 className="font-display text-3xl font-semibold">Notifications</h1></div><Button variant="outline" asChild><Link to="/settings">Notification settings</Link></Button></div>
    <Tabs defaultValue="inbox" className="mt-6">
      <TabsList><TabsTrigger value="inbox">Inbox</TabsTrigger><TabsTrigger value="log">Delivery log</TabsTrigger></TabsList>
      <TabsContent value="inbox" className="mt-4">
        <div className="mb-3 flex gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("read", () => mark({ data: {} }), "All marked as read.")}><CheckCheck />Mark all read</Button><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("clear", () => clear(), "Read notifications cleared.")}><Trash2 />Clear read</Button></div>
        {inbox.isPending ? <div className="flex justify-center p-10"><Loader2 className="animate-spin text-primary" /></div> : inbox.error ? <p role="alert" className="text-destructive">{inbox.error.message}</p>
          : !inbox.data.length ? <p className="rounded-md border border-dashed border-border p-10 text-center text-muted-foreground">No notifications yet. New orders and low-stock alerts appear here.</p>
          : <ul className="divide-y divide-border rounded-md border border-border bg-card">{inbox.data.map(n => <li key={n.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${n.read_at ? "" : "bg-accent/40"}`}><div><p className="font-medium">{n.title}</p><p className="text-sm text-muted-foreground">{n.body}</p></div><div className="flex items-center gap-2"><time className="text-xs text-muted-foreground">{when(n.created_at)}</time>{n.link && <Button size="sm" variant="ghost" asChild><Link to={n.link as "/orders"}>Open</Link></Button>}</div></li>)}</ul>}
      </TabsContent>
      <TabsContent value="log" className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Emails and WhatsApp messages. Failed sends retry automatically up to 5 times; a job checks every hour.</p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => run("now", () => now(), "Queue checked.")}>{busy === "now" ? <Loader2 className="animate-spin" /> : <Send />}Send due now</Button></div>
        {deliveries.isPending ? <div className="flex justify-center p-10"><Loader2 className="animate-spin text-primary" /></div> : deliveries.error ? <p role="alert" className="text-destructive">{deliveries.error.message} <Button size="sm" variant="outline" onClick={() => deliveries.refetch()}><RefreshCw />Retry</Button></p>
          : !deliveries.data.length ? <p className="rounded-md border border-dashed border-border p-10 text-center text-muted-foreground">Nothing has been sent yet.</p>
          : <ul className="divide-y divide-border rounded-md border border-border bg-card">{deliveries.data.map(d => { const s = STATUS[d.status] ?? { label: d.status, variant: "secondary" as const }; return <li key={d.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0"><p className="flex items-center gap-2 font-medium">{d.channel === "email" ? <Mail className="size-4 text-muted-foreground" /> : <MessageCircle className="size-4 text-muted-foreground" />}{KIND[d.kind] ?? d.kind}</p><p className="truncate text-sm text-muted-foreground">{d.subject}{d.recipient ? ` → ${d.recipient}` : " → you"}</p>{d.last_error && <p className="text-xs text-destructive">{d.last_error}</p>}</div>
              <div className="flex items-center gap-2 sm:justify-end"><Badge variant={s.variant}>{s.label}</Badge><span className="text-xs text-muted-foreground">{d.sent_at ? when(d.sent_at) : d.status === "pending" ? `next try ${when(d.next_attempt_at)}` : when(d.created_at)}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}</span></div>
            </li>; })}</ul>}
      </TabsContent>
    </Tabs>
  </main>;
}
