import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Download, RefreshCw, Users, ShoppingCart, IndianRupee, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAnalytics, getGstReport, getSalesExport } from "@/lib/analytics.functions";
import { downloadCsv, gstInvoicesCsv, hsnCsv, lastDays, pct, salesCsv } from "@/lib/report-rules";
import { formatMoney } from "@/lib/order-rules";

const PRESETS = [7, 30, 90, 365] as const;

export function AnalyticsWorkspace() {
  const report = useServerFn(getAnalytics), gst = useServerFn(getGstReport), sales = useServerFn(getSalesExport);
  const [range, setRange] = useState(lastDays(30));
  const [preset, setPreset] = useState<number | null>(30);
  const [busy, setBusy] = useState("");
  const q = useQuery({ queryKey: ["analytics", range], queryFn: () => report({ data: range }) });

  async function exportFile(kind: "sales" | "gst" | "hsn") {
    setBusy(kind);
    try {
      if (kind === "sales") downloadCsv(`orders-${range.from}-to-${range.to}.csv`, salesCsv(await sales({ data: range })));
      else { const r = await gst({ data: range }); downloadCsv(`${kind === "gst" ? "gst-invoices" : "hsn-summary"}-${range.from}-to-${range.to}.csv`, kind === "gst" ? gstInvoicesCsv(r) : hsnCsv(r)); }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed."); }
    finally { setBusy(""); }
  }

  const d = q.data;
  const f = d?.funnel;
  const funnel = f ? [{ step: "Visited", n: f.view }, { step: "Added to cart", n: f.add_to_cart }, { step: "Started checkout", n: f.checkout_start }, { step: "Ordered", n: f.order }] : [];
  const tiles = d ? [
    { label: "Revenue", value: formatMoney(d.totals.revenue), icon: IndianRupee, sub: `${formatMoney(d.totals.delivered_revenue)} delivered` },
    { label: "Orders", value: d.totals.orders.toLocaleString("en-IN"), icon: ShoppingCart, sub: `${d.totals.cancelled} cancelled · avg ${formatMoney(d.totals.orders ? d.totals.revenue / d.totals.orders : 0)}` },
    { label: "Visitors", value: d.totals.visitors.toLocaleString("en-IN"), icon: Users, sub: `${pct(f!.order, f!.view)}% ordered` },
    { label: "Repeat customers", value: d.totals.repeat_customers.toLocaleString("en-IN"), icon: Repeat, sub: `of ${d.totals.customers} customers` },
  ] : [];

  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-primary">ANALYTICS</p><h1 className="font-display text-3xl font-semibold">Sales & visitors</h1><p className="mt-1 text-sm text-muted-foreground">Visitors are counted without cookies; nobody can be identified.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1" role="group" aria-label="Date range">{PRESETS.map(n => <Button key={n} size="sm" variant={preset === n ? "default" : "outline"} onClick={() => { setPreset(n); setRange(lastDays(n)); }}>{n === 365 ? "1 year" : `${n} days`}</Button>)}</div>
        <label className="grid gap-1 text-xs">From<Input type="date" value={range.from} max={range.to} onChange={e => { setPreset(null); setRange(r => ({ ...r, from: e.target.value })); }} className="h-8" /></label>
        <label className="grid gap-1 text-xs">To<Input type="date" value={range.to} min={range.from} onChange={e => { setPreset(null); setRange(r => ({ ...r, to: e.target.value })); }} className="h-8" /></label>
      </div>
    </div>

    {q.isPending ? <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>
      : q.error || !d ? <div role="alert" className="p-10 text-center text-destructive">{q.error?.message ?? "Unavailable"} <Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw />Try again</Button></div>
      : <>
        <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{tiles.map(t => <div key={t.label} className="rounded-md border border-border bg-card p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><t.icon className="size-4 text-primary" />{t.label}</p><p className="mt-1 text-2xl font-semibold">{t.value}</p><p className="text-xs text-muted-foreground">{t.sub}</p></div>)}</section>

        <section className="mt-6 rounded-md border border-border bg-card p-4"><h2 className="font-display text-lg font-semibold">Revenue and visitors per day</h2>
          <div className="mt-3 h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={d.daily}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="day" tickFormatter={v => String(v).slice(5)} fontSize={12} /><YAxis yAxisId="r" fontSize={12} tickFormatter={v => `₹${v}`} /><YAxis yAxisId="v" orientation="right" fontSize={12} allowDecimals={false} /><Tooltip formatter={(v: number, k: string) => (k === "revenue" ? formatMoney(v) : v)} /><Area yAxisId="r" type="monotone" dataKey="revenue" name="revenue" className="fill-primary/20 stroke-primary" strokeWidth={2} /><Area yAxisId="v" type="monotone" dataKey="visitors" name="visitors" className="fill-chart-2/10 stroke-chart-2" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-md border border-border bg-card p-4"><h2 className="font-display text-lg font-semibold">Shopping funnel</h2>
            <ol className="mt-4 grid gap-3">{funnel.map((s, i) => <li key={s.step}><div className="flex justify-between text-sm"><span>{s.step}</span><span className="font-medium">{s.n.toLocaleString("en-IN")}{i > 0 && <span className="ml-2 text-xs text-muted-foreground">{pct(s.n, funnel[i - 1]?.n ?? 0)}% of previous</span>}</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${funnel[0]?.n ? Math.max(2, (s.n / funnel[0].n) * 100) : 0}%` }} /></div></li>)}</ol>
          </section>
          <section className="rounded-md border border-border bg-card p-4"><h2 className="font-display text-lg font-semibold">Where visitors came from</h2>
            {!d.sources.length ? <p className="mt-4 text-sm text-muted-foreground">No visits in this period.</p> : <div className="mt-3 h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={d.sources} layout="vertical" margin={{ left: 20 }}><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="source" width={110} fontSize={12} /><Tooltip /><Bar dataKey="visitors" className="fill-primary" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>}
          </section>
          <section className="rounded-md border border-border bg-card p-4"><h2 className="font-display text-lg font-semibold">Top products</h2>
            {!d.top_products.length ? <p className="mt-4 text-sm text-muted-foreground">No sales in this period.</p> : <ul className="mt-3 divide-y divide-border text-sm">{d.top_products.map(p => <li key={p.title} className="flex justify-between gap-3 py-2"><span className="truncate">{p.title}</span><span className="shrink-0">{p.units} sold · {formatMoney(p.revenue)}</span></li>)}</ul>}
          </section>
          <section className="rounded-md border border-border bg-card p-4"><h2 className="font-display text-lg font-semibold">Reports & GST filing</h2>
            <p className="mt-1 text-sm text-muted-foreground">GST collected {formatMoney(d.totals.tax)} · delivery charged {formatMoney(d.totals.shipping)}.</p>
            <div className="mt-4 grid gap-2">
              <Button variant="outline" disabled={!!busy} onClick={() => exportFile("sales")}>{busy === "sales" ? <Loader2 className="animate-spin" /> : <Download />}Orders (CSV)</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => exportFile("gst")}>{busy === "gst" ? <Loader2 className="animate-spin" /> : <Download />}GST invoice register (CSV)</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => exportFile("hsn")}>{busy === "hsn" ? <Loader2 className="animate-spin" /> : <Download />}HSN summary (CSV)</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Check these with your accountant before filing GSTR-1.</p>
          </section>
        </div>
      </>}
  </main>;
}
