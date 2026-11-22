import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Download, Save, ShieldX, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { listCustomers, getCustomerOrders, updateCustomer, eraseCustomer } from "@/lib/customers.functions";
import { SEGMENT_LABELS, STATUS_LABELS, customerSegment, formatMoney, toCsv, type CustomerSegment, type OrderStatus, type ShippingAddress } from "@/lib/order-rules";
import { AddressBlock, statusVariant } from "@/components/orders-dashboard";
import { Switch } from "@/components/ui/switch";
import { setCustomerCodBlock } from "@/lib/commerce.functions";

type Customer = Awaited<ReturnType<typeof listCustomers>>[number];

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const history = useServerFn(getCustomerOrders), update = useServerFn(updateCustomer), erase = useServerFn(eraseCustomer), codBlock = useServerFn(setCustomerCodBlock);
  const client = useQueryClient();
  const orders = useQuery({ queryKey: ["customer-orders", customer.id], queryFn: () => history({ data: { id: customer.id } }) });
  const [notes, setNotes] = useState(customer.notes), [tags, setTags] = useState(customer.tags.join(", ")), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => { setNotes(customer.notes); setTags(customer.tags.join(", ")); }, [customer]);
  async function save() {
    const list = tags.split(",").map(t => t.trim()).filter(Boolean);
    if (list.length > 20 || list.some(t => t.length > 30)) { toast.error("Use up to 20 tags of 30 characters or fewer."); return; }
    setBusy(true);
    try { await update({ data: { id: customer.id, notes, tags: list } }); await client.invalidateQueries({ queryKey: ["customers"] }); toast.success("Customer saved."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  async function doErase() {
    setBusy(true);
    try { await erase({ data: { id: customer.id } }); await Promise.all([client.invalidateQueries({ queryKey: ["customers"] }), client.invalidateQueries({ queryKey: ["orders"] })]); toast.success("Customer's personal details erased."); setConfirm(false); onClose(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not erase this customer."); }
    finally { setBusy(false); }
  }
  const erased = !!customer.erased_at;
  return <>
    <SheetHeader><SheetTitle className="font-display text-2xl">{customer.name}</SheetTitle><SheetDescription>{SEGMENT_LABELS[customerSegment({ ...customer, total_spent: Number(customer.total_spent) })]} customer · {customer.order_count} order{customer.order_count === 1 ? "" : "s"} · {formatMoney(customer.total_spent)} spent</SheetDescription></SheetHeader>
    {!erased && <p className="mt-4 text-sm">{customer.phone && <a className="text-primary underline-offset-4 hover:underline" href={`tel:+91${customer.phone}`}>+91 {customer.phone}</a>}{customer.email && <><br /><a className="text-primary underline-offset-4 hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a></>}</p>}
    {!erased && customer.address && <AddressBlock value={customer.address} />}
    {!erased && <div className="mt-6 grid gap-3">
      <label className="grid gap-2 text-sm">Tags<Input value={tags} onChange={e => setTags(e.target.value)} placeholder="wholesale, prefers-evening" /><span className="text-xs text-muted-foreground">Separate with commas.</span></label>
      <label className="grid gap-2 text-sm">Private notes<Textarea rows={4} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save customer</Button>
      <label className="mt-2 flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"><span><span className="font-medium">Block cash on delivery</span><span className="block text-muted-foreground">For customers who refused deliveries. Their next order is declined.</span></span><Switch aria-label="Block cash on delivery" checked={customer.cod_blocked} disabled={busy} onCheckedChange={async v => { setBusy(true); try { await codBlock({ data: { id: customer.id, blocked: v } }); await client.invalidateQueries({ queryKey: ["customers"] }); toast.success(v ? "Cash on delivery blocked for this customer." : "Cash on delivery allowed again."); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update."); } finally { setBusy(false); } }} /></label>
    </div>}
    <h3 className="mt-6 text-sm font-semibold">Order history</h3>
    {orders.isPending ? <Loader2 className="mt-3 animate-spin text-primary" /> : orders.error ? <p className="mt-2 text-sm text-destructive">{orders.error.message}</p>
      : !orders.data?.length ? <p className="mt-2 text-sm text-muted-foreground">No orders.</p>
      : <ul className="mt-2 divide-y divide-border text-sm">{orders.data.map(o => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>#{o.order_number} · {new Date(o.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}<span className="block text-xs text-muted-foreground">{o.order_items.map(i => `${i.quantity} × ${i.title}`).join(", ")}</span></span><span className="flex items-center gap-2">{formatMoney(o.total)}<Badge variant={statusVariant(o.status)}>{STATUS_LABELS[o.status as OrderStatus]}</Badge></span></li>)}</ul>}
    {!erased && <Button variant="outline" className="mt-8 text-destructive" onClick={() => setConfirm(true)}><ShieldX />Erase personal details</Button>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Erase {customer.name}'s personal details?</AlertDialogTitle><AlertDialogDescription>Their name, phone, email, address, notes and tags are removed from this customer and all their orders. Order amounts stay for your records. This can't be undone.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); doErase(); }}>{busy && <Loader2 className="animate-spin" />}Erase</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

export function CustomersWorkspace() {
  const list = useServerFn(listCustomers);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["customers"], queryFn: () => list() });
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<CustomerSegment | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => (data ?? []).map(c => ({ ...c, segment: customerSegment({ ...c, total_spent: Number(c.total_spent) }) })), [data]);
  const q = search.trim().toLowerCase();
  const shown = rows.filter(c => (segment === "all" || c.segment === segment) && (!q || `${c.name} ${c.phone ?? ""} ${c.email ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(q)));
  const selected = rows.find(c => c.id === selectedId) ?? null;

  function exportCsv() {
    const csv = toCsv([["Name", "Phone", "Email", "City", "State", "PIN", "Orders", "Total spent (INR)", "Segment", "Tags", "First order", "Last order"], ...shown.map(c => {
      const a = (c.address ?? {}) as ShippingAddress;
      return [c.name, c.phone, c.email, a.city, a.state, a.pincode, c.order_count, Number(c.total_spent).toFixed(2), SEGMENT_LABELS[c.segment], c.tags.join("; "), c.first_order_at?.slice(0, 10), c.last_order_at?.slice(0, 10)];
    })]);
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  if (isPending) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;
  if (error) return <div role="alert" className="mx-auto max-w-xl p-10 text-center"><p className="text-destructive">{error.message}</p><Button className="mt-4" variant="outline" onClick={() => refetch()}><RefreshCw />Try again</Button></div>;
  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-primary">CUSTOMERS</p><h1 className="font-display text-3xl font-semibold">Customers</h1></div><Button variant="outline" disabled={!shown.length} onClick={exportCsv}><Download />Export CSV</Button></div>
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search customers" placeholder="Name, phone, email or tag" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by segment">{(["all", "new", "repeat", "vip", "inactive", "erased"] as const).map(s => <Button key={s} size="sm" variant={segment === s ? "default" : "ghost"} onClick={() => setSegment(s)}>{s === "all" ? "All" : SEGMENT_LABELS[s]}<span className="text-xs opacity-70">{s === "all" ? rows.length : rows.filter(c => c.segment === s).length}</span></Button>)}</div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">VIP: 5+ orders or ₹10,000+ spent · Repeat: 2+ orders · Inactive: no order in 90 days</p>
    {!rows.length ? <div className="mt-8 rounded-md border border-dashed border-border p-10 text-center"><Users className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No customers yet</p><p className="mt-1 text-sm text-muted-foreground">Customers are added automatically when they place an order.</p></div>
      : !shown.length ? <p className="mt-10 text-center text-muted-foreground">No customers match.</p>
      : <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-card">{shown.map(c => <li key={c.id}><button type="button" onClick={() => setSelectedId(c.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{c.phone ? `+91 ${c.phone}` : "—"}{c.last_order_at ? ` · last order ${new Date(c.last_order_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}</span></span>
          <span className="text-sm text-muted-foreground">{c.order_count} order{c.order_count === 1 ? "" : "s"}</span>
          <span className="font-semibold">{formatMoney(c.total_spent)}</span>
          <Badge variant={c.segment === "vip" ? "default" : c.segment === "erased" ? "outline" : "secondary"}>{SEGMENT_LABELS[c.segment]}</Badge>
        </button></li>)}</ul>}
    <Sheet open={!!selected} onOpenChange={open => !open && setSelectedId(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">{selected && <CustomerDetail customer={selected} onClose={() => setSelectedId(null)} />}</SheetContent>
    </Sheet>
  </main>;
}
