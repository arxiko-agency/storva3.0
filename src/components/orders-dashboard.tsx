import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, ExternalLink, Copy, MailCheck, MailWarning, RefreshCw, Radio, PackageOpen, FileText, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { listOrders, updateOrderStatus, resendOrderAlert } from "@/lib/orders.functions";
import { getStoreSettings } from "@/lib/store.functions";
import { updateOrderShipping } from "@/lib/commerce.functions";
import { ShareKit } from "@/components/share-kit";
import { ORDER_STATUSES, STATUS_LABELS, formatMoney, nextStatuses, type OrderStatus, type ShippingAddress } from "@/lib/order-rules";

type Order = Awaited<ReturnType<typeof listOrders>>[number];
type LiveState = "connecting" | "live" | "offline";

export function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "pending") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "delivered") return "outline";
  return "secondary";
}

export function OrdersDashboard() {
  const list = useServerFn(listOrders), settings = useServerFn(getStoreSettings), setStatus = useServerFn(updateOrderStatus), resend = useServerFn(resendOrderAlert);
  const client = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => list() });
  const store = useQuery({ queryKey: ["store-settings"], queryFn: () => settings() });
  const [live, setLive] = useState<LiveState>("connecting");
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      channel = supabase
        .channel(`orders-${data.user.id}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `owner_id=eq.${data.user.id}` }, payload => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as { id: string; order_number: number | null; customer_name: string };
            setFresh(prev => new Set(prev).add(row.id));
            toast.success(`New order${row.order_number ? ` #${row.order_number}` : ""} from ${row.customer_name}`);
          }
          client.invalidateQueries({ queryKey: ["orders"] });
        })
        .subscribe(status => setLive(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting"));
    });
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [client]);

  const data = orders.data ?? [];
  const selected = data.find(o => o.id === selectedId) ?? null;
  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todays = data.filter(o => Date.parse(o.created_at) >= today.getTime());
    return {
      today: todays.length,
      revenue: todays.filter(o => o.status !== "cancelled").reduce((sum, o) => sum + Number(o.total), 0),
      pending: data.filter(o => o.status === "pending").length,
      toShip: data.filter(o => o.status === "confirmed" || o.status === "packed").length,
    };
  }, [data]);
  const shown = data.filter(o => (filter === "all" || o.status === filter) && (!search.trim() || `${o.order_number} ${o.customer_name} ${o.customer_phone ?? ""} ${o.customer_email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const shopUrl = store.data && typeof window !== "undefined" ? `${window.location.origin}/shop/${store.data.store_slug}` : "";

  async function changeStatus(order: Order, status: OrderStatus) {
    setBusy(status);
    try { await setStatus({ data: { id: order.id, status } }); await client.invalidateQueries({ queryKey: ["orders"] }); client.invalidateQueries({ queryKey: ["customers"] }); toast.success(`Order #${order.order_number} marked ${STATUS_LABELS[status].toLowerCase()}.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update this order."); }
    finally { setBusy(""); setConfirmCancel(false); }
  }
  async function retryAlert(order: Order) {
    setBusy("alert");
    try { await resend({ data: { id: order.id } }); await client.invalidateQueries({ queryKey: ["orders"] }); toast.success("Alert email sent."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not send the alert email."); await client.invalidateQueries({ queryKey: ["orders"] }); }
    finally { setBusy(""); }
  }

  if (orders.isPending) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;
  if (orders.error) return <div role="alert" className="mx-auto max-w-xl p-10 text-center"><p className="text-destructive">{orders.error.message}</p><Button className="mt-4" variant="outline" onClick={() => orders.refetch()}><RefreshCw />Try again</Button></div>;

  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-primary">ORDERS</p><h1 className="font-display text-3xl font-semibold">Order management</h1></div>
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite"><Radio className={`size-4 ${live === "live" ? "text-primary" : live === "offline" ? "text-destructive" : ""}`} />{live === "live" ? "Live — new orders appear instantly" : live === "offline" ? "Live updates disconnected" : "Connecting…"}</span>
    </div>

    {store.data && <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">Your shop page</p><p className="truncate font-medium">{shopUrl}</p></div>
      <div className="flex flex-wrap gap-2">{shopUrl && <ShareKit shopUrl={shopUrl} storeName={store.data.store_name ?? "My shop"} slug={store.data.store_slug ?? "shop"} />}<Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(shopUrl); toast.success("Shop link copied."); } catch { toast.error("Could not copy the link."); } }}><Copy />Copy</Button><Button size="sm" asChild><a href={`/shop/${store.data.store_slug}`} target="_blank" rel="noreferrer"><ExternalLink />Open shop</a></Button></div>
    </section>}

    <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[["Orders today", stats.today], ["Revenue today", formatMoney(stats.revenue)], ["New — need confirming", stats.pending], ["To pack or ship", stats.toShip]].map(([label, value]) => <div key={label as string} className="border-l-2 border-primary pl-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</section>

    <div className="mt-8 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search orders" placeholder="Search by number, name or phone" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">{(["all", ...ORDER_STATUSES] as const).map(s => <Button key={s} size="sm" variant={filter === s ? "default" : "ghost"} onClick={() => setFilter(s)}>{s === "all" ? "All" : STATUS_LABELS[s]}<span className="text-xs opacity-70">{s === "all" ? data.length : data.filter(o => o.status === s).length}</span></Button>)}</div>
    </div>

    {!data.length ? <div className="mt-10 rounded-md border border-dashed border-border p-10 text-center"><PackageOpen className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No orders yet</p><p className="mt-1 text-sm text-muted-foreground">Share your shop link. Orders appear here the moment they're placed.</p><Button className="mt-4" variant="outline" asChild><Link to="/products">Add products</Link></Button></div>
      : !shown.length ? <p className="mt-10 text-center text-muted-foreground">No orders match this filter.</p>
      : <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-card">{shown.map(o => <li key={o.id}><button type="button" onClick={() => { setSelectedId(o.id); setFresh(prev => { const n = new Set(prev); n.delete(o.id); return n; }); }} className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted ${fresh.has(o.id) ? "bg-accent" : ""}`}>
          <span className="w-10 font-display font-semibold sm:w-16">#{o.order_number ?? "—"}</span>
          <span className="min-w-[10rem] flex-1"><span className="block truncate font-medium">{o.customer_name}</span><span className="block text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {o.quantity} item{o.quantity === 1 ? "" : "s"}</span></span>
          <span className="font-semibold">{formatMoney(o.total)}</span>
          <Badge variant={statusVariant(o.status)}>{STATUS_LABELS[o.status as OrderStatus] ?? o.status}</Badge>
          {o.alert_error && <MailWarning className="size-4 text-destructive" aria-label="Alert email failed" />}
        </button></li>)}</ul>}

    <Sheet open={!!selected} onOpenChange={open => !open && setSelectedId(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {selected && <>
          <SheetHeader><SheetTitle className="font-display text-2xl">Order #{selected.order_number}</SheetTitle><SheetDescription>{new Date(selected.created_at).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</SheetDescription></SheetHeader>
          <div className="mt-4 flex items-center gap-2"><Badge variant={statusVariant(selected.status)}>{STATUS_LABELS[selected.status as OrderStatus]}</Badge><span className="text-sm text-muted-foreground">Cash on delivery · {selected.payment_status === "paid" ? "Collected" : "Not collected yet"}</span></div>
          <div className="mt-5 flex flex-wrap gap-2">{nextStatuses(selected.status).map(s => s === "cancelled"
            ? <Button key={s} variant="outline" disabled={!!busy} onClick={() => setConfirmCancel(true)}>Cancel order</Button>
            : <Button key={s} disabled={!!busy} onClick={() => changeStatus(selected, s)}>{busy === s && <Loader2 className="animate-spin" />}Mark {STATUS_LABELS[s].toLowerCase()}</Button>)}</div>
          <h3 className="mt-6 text-sm font-semibold">Items</h3>
          <ul className="mt-2 divide-y divide-border text-sm">{selected.order_items.map(i => <li key={i.id} className="flex justify-between gap-3 py-2"><span>{i.quantity} × {i.title}<span className="block text-xs text-muted-foreground">{formatMoney(i.unit_price)} each</span></span><span>{formatMoney(i.line_total)}</span></li>)}</ul>
          <div className="mt-2 grid gap-1 border-t border-border pt-2 text-sm">
            <p className="flex justify-between"><span>Items</span><span>{formatMoney(selected.subtotal)}</span></p>
            {selected.gst_applied && Number(selected.tax_total) > 0 && <p className="flex justify-between text-muted-foreground"><span>{selected.prices_include_gst ? "Includes GST" : "GST"} {Number(selected.igst) > 0 ? "(IGST)" : "(CGST + SGST)"}</span><span>{formatMoney(selected.tax_total)}</span></p>}
            <p className="flex justify-between"><span>Delivery</span><span>{Number(selected.shipping_fee) > 0 ? formatMoney(selected.shipping_fee) : "Free"}</span></p>
            {Number(selected.cod_fee) > 0 && <p className="flex justify-between"><span>COD fee</span><span>{formatMoney(selected.cod_fee)}</span></p>}
            <p className="flex justify-between font-semibold"><span>Total</span><span>{formatMoney(selected.total)}</span></p>
          </div>
          <div className="mt-4">{selected.invoice_number ? <Button variant="outline" size="sm" asChild><Link to="/invoice/$orderId" params={{ orderId: selected.id }}><FileText />Invoice {selected.invoice_number}</Link></Button> : <p className="text-xs text-muted-foreground">An invoice number is issued when you confirm the order.</p>}</div>
          {selected.status !== "cancelled" && <TrackingForm key={selected.id} order={selected} onSaved={() => client.invalidateQueries({ queryKey: ["orders"] })} />}
          <h3 className="mt-6 text-sm font-semibold">Customer</h3>
          <p className="mt-2 text-sm">{selected.customer_name}<br />{selected.customer_phone && <a className="text-primary underline-offset-4 hover:underline" href={`tel:+91${selected.customer_phone}`}>+91 {selected.customer_phone}</a>}{selected.customer_email && <><br /><a className="text-primary underline-offset-4 hover:underline" href={`mailto:${selected.customer_email}`}>{selected.customer_email}</a></>}</p>
          {selected.shipping_address && <AddressBlock value={selected.shipping_address} />}
          {selected.notes && <><h3 className="mt-6 text-sm font-semibold">Notes from customer</h3><p className="mt-2 whitespace-pre-wrap text-sm">{selected.notes}</p></>}
          <h3 className="mt-6 text-sm font-semibold">Email alert</h3>
          {selected.alert_sent_at ? <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><MailCheck className="size-4 text-primary" />Sent {new Date(selected.alert_sent_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
            : <div className="mt-2 text-sm"><p className="flex items-start gap-2 text-muted-foreground"><MailWarning className="mt-0.5 size-4 shrink-0 text-destructive" />{selected.alert_error ?? "Not sent (alerts may be switched off)."}</p><Button className="mt-2" size="sm" variant="outline" disabled={!!busy} onClick={() => retryAlert(selected)}>{busy === "alert" ? <Loader2 className="animate-spin" /> : <RefreshCw />}Send alert now</Button></div>}
        </>}
      </SheetContent>
    </Sheet>
    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Cancel order #{selected?.order_number}?</AlertDialogTitle><AlertDialogDescription>The items go back into stock. This can't be undone.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={!!busy}>Keep order</AlertDialogCancel><AlertDialogAction disabled={!!busy} onClick={e => { e.preventDefault(); if (selected) changeStatus(selected, "cancelled"); }}>{busy === "cancelled" && <Loader2 className="animate-spin" />}Cancel order</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}

function TrackingForm({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const save = useServerFn(updateOrderShipping);
  const [courier, setCourier] = useState(order.courier ?? ""), [number, setNumber] = useState(order.tracking_number ?? ""), [url, setUrl] = useState(order.tracking_url ?? "");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await save({ data: { id: order.id, courier, trackingNumber: number, trackingUrl: url } }); onSaved(); toast.success("Tracking saved. It's included in the 'shipped' message to the customer."); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not save tracking."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 grid gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><Truck className="size-4" />Courier & tracking</h3>
    <div className="grid grid-cols-2 gap-2"><Input aria-label="Courier" placeholder="Courier (e.g. India Post)" maxLength={60} value={courier} onChange={e => setCourier(e.target.value)} /><Input aria-label="Tracking number" placeholder="Tracking / AWB number" maxLength={60} value={number} onChange={e => setNumber(e.target.value)} /></div>
    <Input aria-label="Tracking link" placeholder="https://… (optional)" maxLength={300} value={url} onChange={e => setUrl(e.target.value)} />
    <Button type="submit" size="sm" variant="outline" disabled={busy} className="justify-self-start">{busy && <Loader2 className="animate-spin" />}Save tracking</Button>
  </form>;
}

export function AddressBlock({ value }: { value: unknown }) {
  const a = (value ?? {}) as ShippingAddress;
  return <><h3 className="mt-6 text-sm font-semibold">Deliver to</h3><p className="mt-2 text-sm">{a.line1}{a.line2 ? <><br />{a.line2}</> : null}<br />{a.city}, {a.state} {a.pincode}</p></>;
}
