import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save, Plus, Trash2, RefreshCw, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCommerceSettings, saveCommerceSettings } from "@/lib/commerce.functions";
import { getNotificationPrefs, saveNotificationPrefs, listAuditLog, type Prefs } from "@/lib/notifications.functions";
import { GST_RATES, INDIAN_STATES, commerceSchema, type CommerceInput, type Region } from "@/lib/pricing-rules";
import { formatMoney } from "@/lib/order-rules";

const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>;
const Toggle = ({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) => <label className="flex items-start justify-between gap-4 text-sm"><span><span className="font-medium">{label}</span>{hint && <span className="block text-muted-foreground">{hint}</span>}</span><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></label>;
const Loading = () => <div className="flex justify-center p-10"><Loader2 className="animate-spin text-primary" /></div>;
const Failed = ({ message, retry }: { message: string; retry: () => void }) => <div role="alert" className="p-6 text-destructive">{message} <Button variant="outline" size="sm" onClick={retry}><RefreshCw />Try again</Button></div>;
const money = (v: string) => (v.trim() === "" ? null : Number(v));

function CommerceForm() {
  const get = useServerFn(getCommerceSettings), save = useServerFn(saveCommerceSettings);
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["commerce-settings"], queryFn: () => get() });
  const [f, setF] = useState<(Omit<CommerceInput, "shippingFlatRate" | "freeShippingAbove" | "codFee" | "codMaxOrder"> & { shippingFlatRate: string; freeShippingAbove: string; codFee: string; codMaxOrder: string }) | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  useEffect(() => { if (q.data) setF({ ...q.data, businessState: q.data.businessState as CommerceInput["businessState"], shippingFlatRate: String(q.data.shippingFlatRate), freeShippingAbove: q.data.freeShippingAbove === null ? "" : String(q.data.freeShippingAbove), codFee: String(q.data.codFee), codMaxOrder: q.data.codMaxOrder === null ? "" : String(q.data.codMaxOrder) }); }, [q.data]);
  if (q.isPending || (!f && !q.error)) return <Loading />;
  if (q.error || !f) return <Failed message={q.error?.message ?? "Unavailable"} retry={() => q.refetch()} />;
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const setRegion = (i: number, patch: Partial<Region>) => set({ regions: f.regions.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setProblem("");
    const parsed = commerceSchema.safeParse({ ...f, shippingFlatRate: Number(f!.shippingFlatRate || 0), freeShippingAbove: money(f!.freeShippingAbove), codFee: Number(f!.codFee || 0), codMaxOrder: money(f!.codMaxOrder) });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? "Check the form."); return; }
    setBusy(true);
    try { await save({ data: parsed.data }); await client.invalidateQueries({ queryKey: ["commerce-settings"] }); toast.success("Shipping & GST settings saved."); }
    catch (err) { setProblem(err instanceof Error ? err.message : "Could not save."); }
    finally { setBusy(false); }
  }
  const used = new Set(f.regions.map(r => r.state));
  return <form onSubmit={submit} className="grid gap-8">
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-2">
      <h2 className="font-display text-xl font-semibold sm:col-span-2">Business & GST</h2>
      <Field label="Legal business name"><Input maxLength={120} value={f.legalName} onChange={e => set({ legalName: e.target.value })} /></Field>
      <Field label="GSTIN" hint="15 characters, e.g. 32ABCDE1234F1Z5"><Input maxLength={15} value={f.gstin} onChange={e => set({ gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })} className="font-mono" /></Field>
      <Field label="Business state" hint="Decides CGST + SGST (same state) or IGST (other states)"><select className="h-9 rounded-md border border-input bg-background px-2" value={f.businessState} onChange={e => set({ businessState: e.target.value as CommerceInput["businessState"] })}><option value="">Choose…</option>{INDIAN_STATES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Invoice prefix" hint="Invoices are numbered like INV/2026-27/00001 and restart every April"><Input maxLength={10} value={f.invoicePrefix} onChange={e => set({ invoicePrefix: e.target.value.toUpperCase() })} className="font-mono" /></Field>
      <div className="sm:col-span-2"><Field label="Business address (printed on invoices)"><Textarea rows={2} maxLength={400} value={f.businessAddress} onChange={e => set({ businessAddress: e.target.value })} /></Field></div>
      <div className="grid gap-4 sm:col-span-2">
        <Toggle label="Charge GST" hint="Off: invoices are issued as a bill of supply with no tax." checked={f.gstEnabled} onChange={v => set({ gstEnabled: v })} />
        {f.gstEnabled && <><Toggle label="My prices already include GST" hint="Off: GST is added on top of product prices at checkout." checked={f.pricesIncludeGst} onChange={v => set({ pricesIncludeGst: v })} />
          <Field label="Default GST rate" hint="Used when a product has no rate of its own"><select className="h-9 w-40 rounded-md border border-input bg-background px-2" value={f.defaultGstRate} onChange={e => set({ defaultGstRate: Number(e.target.value) })}>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></Field></>}
      </div>
    </section>

    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-2">
      <h2 className="font-display text-xl font-semibold sm:col-span-2">Delivery & cash on delivery</h2>
      <Field label="Delivery charge (₹)" hint="For states without their own rate"><Input type="number" min={0} step="0.01" value={f.shippingFlatRate} onChange={e => set({ shippingFlatRate: e.target.value })} /></Field>
      <Field label="Free delivery above (₹, optional)"><Input type="number" min={0} step="0.01" value={f.freeShippingAbove} onChange={e => set({ freeShippingAbove: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Toggle label="Accept cash on delivery" hint="Online payments for shoppers are not set up, so turning this off stops new orders." checked={f.codEnabled} onChange={v => set({ codEnabled: v })} /></div>
      {f.codEnabled && <><Field label="COD fee (₹)"><Input type="number" min={0} step="0.01" value={f.codFee} onChange={e => set({ codFee: e.target.value })} /></Field>
        <Field label="Maximum COD order (₹, optional)"><Input type="number" min={0} step="0.01" value={f.codMaxOrder} onChange={e => set({ codMaxOrder: e.target.value })} /></Field></>}
      <div className="grid gap-3 sm:col-span-2">
        <div><p className="text-sm font-medium">State rules</p><p className="text-xs text-muted-foreground">Set a different delivery charge, turn off COD, or stop delivering to a state.</p></div>
        {f.regions.map((r, i) => <div key={r.state} className="grid grid-cols-1 items-end gap-2 rounded-md border border-border p-3 sm:grid-cols-[1.5fr_1fr_auto_auto_auto]">
          <p className="text-sm font-medium">{r.state}</p>
          <Field label="Delivery (₹)"><Input type="number" min={0} step="0.01" placeholder={`Default ${formatMoney(Number(f.shippingFlatRate || 0))}`} value={r.rate ?? ""} onChange={e => setRegion(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><Switch checked={r.cod} onCheckedChange={v => setRegion(i, { cod: v })} aria-label={`COD in ${r.state}`} />COD</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={r.deliver} onCheckedChange={v => setRegion(i, { deliver: v })} aria-label={`Deliver to ${r.state}`} />Deliver</label>
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${r.state}`} onClick={() => set({ regions: f.regions.filter((_, j) => j !== i) })}><Trash2 /></Button>
        </div>)}
        <div className="flex gap-2"><select aria-label="Add a state rule" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value="" onChange={e => { if (e.target.value) set({ regions: [...f.regions, { state: e.target.value as Region["state"], rate: null, cod: true, deliver: true }] }); }}><option value="">Add a state…</option>{INDIAN_STATES.filter(s => !used.has(s)).map(s => <option key={s}>{s}</option>)}</select><Plus className="mt-2 size-4 text-muted-foreground" /></div>
      </div>
    </section>
    <p className="text-xs text-muted-foreground">Delivery and COD fees are shown separately on invoices and are not taxed. Courier booking through Shiprocket is not connected — add tracking details to each order by hand.</p>
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    <div><Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save shipping & GST</Button></div>
  </form>;
}

function NotificationPrefs() {
  const get = useServerFn(getNotificationPrefs), save = useServerFn(saveNotificationPrefs);
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["notification-prefs"], queryFn: () => get() });
  const [p, setP] = useState<Prefs | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setP(q.data.prefs); }, [q.data]);
  if (q.isPending || (!p && !q.error)) return <Loading />;
  if (q.error || !p || !q.data) return <Failed message={q.error?.message ?? "Unavailable"} retry={() => q.refetch()} />;
  const set = (patch: Partial<Prefs>) => setP({ ...p, ...patch });
  async function submit() {
    setBusy(true);
    try { await save({ data: p! }); await client.invalidateQueries({ queryKey: ["notification-prefs"] }); toast.success("Notification settings saved."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-6">
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-md border border-border bg-card p-5"><h2 className="font-display text-xl font-semibold">For you</h2>
      <Toggle label="New order — in the app" checked={p.newOrderInApp} onChange={v => set({ newOrderInApp: v })} />
      <Toggle label="New order — email" hint={q.data.gmailConfigured ? "Sent to your sign-in email." : "Gmail is not connected, so emails can't be sent yet."} checked={p.orderAlerts} onChange={v => set({ orderAlerts: v })} />
      <Toggle label="Low stock — in the app" checked={p.lowStockInApp} onChange={v => set({ lowStockInApp: v })} />
      <Toggle label="Low stock — email" checked={p.lowStockEmail} onChange={v => set({ lowStockEmail: v })} />
      <Field label="Warn me when stock falls to"><Input type="number" min={0} max={10000} className="w-32" value={p.lowStockThreshold} onChange={e => set({ lowStockThreshold: Math.max(0, Math.min(10000, Number(e.target.value) || 0)) })} /></Field>
      <Toggle label="Daily summary email" hint="Yesterday's orders and revenue, sent after 9 am India time." checked={p.dailySummaryEmail} onChange={v => set({ dailySummaryEmail: v })} />
    </section>
    <section className="grid min-w-0 grid-cols-1 gap-4 rounded-md border border-border bg-card p-5"><h2 className="font-display text-xl font-semibold">For your customers</h2>
      <Toggle label="Order updates by email" hint="When an order is confirmed, shipped, delivered or cancelled (only if the customer gave an email)." checked={p.customerEmailUpdates} onChange={v => set({ customerEmailUpdates: v })} />
      <Toggle label="Order updates on WhatsApp" hint={q.data.whatsappConfigured ? "Needs an approved template named order_update." : "WhatsApp is not connected yet; these messages are skipped."} checked={p.customerWhatsappUpdates} onChange={v => set({ customerWhatsappUpdates: v })} />
    </section>
    <div><Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save notification settings</Button></div>
  </div>;
}

const ACTION_LABELS: Record<string, string> = {
  "products.insert": "Added product", "products.update": "Edited product", "products.delete": "Deleted product", "profiles.update": "Changed store settings",
  "store_commerce_settings.insert": "Set up shipping & GST", "store_commerce_settings.update": "Changed shipping & GST", "notification_preferences.insert": "Set notification settings",
  "notification_preferences.update": "Changed notification settings", "theme.published": "Published a new shop design", "customer.erased": "Erased a customer's details",
  "customer.cod_blocked": "Blocked cash on delivery for a customer", "customer.cod_unblocked": "Allowed cash on delivery for a customer", "order.tracking": "Updated tracking",
};
function Security() {
  const list = useServerFn(listAuditLog);
  const q = useQuery({ queryKey: ["audit-log"], queryFn: () => list() });
  const [busy, setBusy] = useState(false);
  async function signOutEverywhere() {
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Signed out on every device.");
  }
  return <div className="grid gap-6">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-5"><div><h2 className="flex items-center gap-2 font-display text-xl font-semibold"><ShieldCheck className="size-5 text-primary" />Sessions</h2><p className="text-sm text-muted-foreground">Lost a phone or used a shared computer? Sign out everywhere, including here.</p></div><Button variant="outline" disabled={busy} onClick={signOutEverywhere}>{busy ? <Loader2 className="animate-spin" /> : <LogOut />}Sign out on all devices</Button></section>
    <section className="rounded-md border border-border bg-card p-5"><h2 className="font-display text-xl font-semibold">Activity log</h2><p className="text-sm text-muted-foreground">Changes to products, orders, settings, design and customers.</p>
      {q.isPending ? <Loading /> : q.error ? <Failed message={q.error.message} retry={() => q.refetch()} /> : !q.data.length ? <p className="mt-4 text-sm text-muted-foreground">No activity yet.</p>
        : <ul className="mt-4 divide-y divide-border text-sm">{q.data.map(r => { const d = (r.details ?? {}) as Record<string, unknown>; const label = ACTION_LABELS[r.action] ?? (r.action.startsWith("order.") ? `Order #${String(d["order_number"] ?? "")} marked ${r.action.slice(6)}` : r.action); return <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{label}{typeof d["title"] === "string" ? `: ${d["title"]}` : ""}<span className="block text-xs text-muted-foreground">{r.byYou ? "By you" : r.actor ? "By another session" : "By the system"}</span></span><time className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></li>; })}</ul>}
    </section>
  </div>;
}

export function SettingsWorkspace() {
  return <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
    <p className="text-sm font-medium text-primary">SETTINGS</p><h1 className="mb-6 font-display text-3xl font-semibold">Store settings</h1>
    <Tabs defaultValue="commerce">
      <TabsList><TabsTrigger value="commerce">Shipping & GST</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="security">Security</TabsTrigger></TabsList>
      <TabsContent value="commerce" className="mt-6"><CommerceForm /></TabsContent>
      <TabsContent value="notifications" className="mt-6"><NotificationPrefs /></TabsContent>
      <TabsContent value="security" className="mt-6"><Security /></TabsContent>
    </Tabs>
  </main>;
}
