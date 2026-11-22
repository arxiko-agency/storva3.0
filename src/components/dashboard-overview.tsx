import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, CreditCard, Package, Palette, Plus, ShoppingBag, Users, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAnalytics } from "@/lib/analytics.functions";
import { getBillingOverview } from "@/lib/billing.functions";
import { listOrders } from "@/lib/orders.functions";
import { STATUS_LABELS, formatMoney, type OrderStatus } from "@/lib/order-rules";
import { formatLimit } from "@/lib/plan-rules";
import { steps } from "@/lib/storva";

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function lastDays(n: number) { const to = new Date(); const from = new Date(); from.setDate(to.getDate() - (n - 1)); return { from: iso(from), to: iso(to) }; }

/** Revenue trend drawn from the real daily analytics (last 30 days). */
function RevenueChart({ daily }: { daily: { day: string; revenue: number }[] }) {
  const max = Math.max(1, ...daily.map(d => d.revenue));
  const points = daily.map((d, i) => `${daily.length < 2 ? 0 : (i / (daily.length - 1)) * 700} ${170 - (d.revenue / max) * 160}`);
  const line = points.length ? `M${points.join(" L")}` : "";
  const area = points.length ? `${line} L700 180 L0 180 Z` : "";
  const labels = daily.length ? [0, Math.floor(daily.length / 2), daily.length - 1].map(i => daily[i]?.day.slice(5) ?? "") : [];
  return <div className="sales-chart"><div className="chart-y"><span>{formatMoney(max).replace(/\.00$/, "")}</span><span>{formatMoney(max / 2).replace(/\.00$/, "")}</span><span>₹0</span></div>
    <div className="chart-canvas"><div className="chart-grid"><i /><i /><i /></div>
      <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label="Revenue per day for the last 30 days"><path className="chart-fill" d={area} /><path className="chart-line" d={line} /></svg>
      <div className="chart-x">{labels.map((l, i) => <span key={i}>{l}</span>)}</div></div></div>;
}

export function DashboardOverview() {
  const report = useServerFn(getAnalytics), billing = useServerFn(getBillingOverview), orders = useServerFn(listOrders);
  const range = lastDays(30);
  const analytics = useQuery({ queryKey: ["analytics", range], queryFn: () => report({ data: range }) });
  const plan = useQuery({ queryKey: ["billing"], queryFn: () => billing() });
  const recent = useQuery({ queryKey: ["orders"], queryFn: () => orders() });

  const totals = analytics.data?.totals;
  const usage = plan.data?.usage;
  const currentPlan = plan.data?.plans.find(p => p.id === usage?.plan_id);
  const stats = [
    { label: "Revenue (30 days)", value: totals ? formatMoney(totals.revenue) : "—", icon: CreditCard, tone: 0 },
    { label: "Orders (30 days)", value: totals ? totals.orders.toLocaleString("en-IN") : "—", icon: ShoppingBag, tone: 1 },
    { label: "Store visitors", value: totals ? totals.visitors.toLocaleString("en-IN") : "—", icon: Users, tone: 2 },
    { label: "Products", value: usage ? `${usage.products} / ${formatLimit(currentPlan?.product_limit ?? null)}` : "—", icon: Package, tone: 3 },
  ];

  return <>
    <div className="dashboard-page-heading"><div><span className="eyebrow">LET’S MAKE IT A GOOD DAY</span><h1>Welcome back<span className="greeting-dot">.</span></h1><p>Here’s what’s happening with your store.</p></div>
      <div className="page-heading-actions"><Button asChild><Link to="/products"><Plus />Add product</Link></Button></div></div>
    <div className="overview-stats">{stats.map(s => <article className="stat-item" key={s.label}><div><span>{s.label}</span><span className={`stat-icon tone-${s.tone}`}><s.icon /></span></div><strong>{s.value}</strong>
      <p><span>{s.label === "Products" ? `${currentPlan?.name ?? "Free"} plan` : "Last 30 days"}</span></p></article>)}</div>
    <div className="overview-middle">
      <section className="sales-section"><div className="panel-heading"><div><h2>Sales overview</h2><p>Revenue per day, last 30 days.</p></div><Button asChild variant="ghost"><Link to="/analytics">Full analytics <ArrowRight /></Link></Button></div>
        <div className="sales-total"><strong>{totals ? formatMoney(totals.revenue) : "—"}</strong><span><span className="status-dot" />Revenue</span></div>
        {analytics.isError ? <p className="empty-message">Could not load your analytics. Please refresh.</p> : <RevenueChart daily={analytics.data?.daily ?? []} />}</section>
      <section className="quick-actions"><span className="eyebrow">MADE FOR MOMENTUM</span><h2>A small step.<br />Your next big thing.</h2><img src={steps[1]?.image} alt="Adding products to your online store" />
        <Button asChild variant="outline"><Link to="/design"><Palette />Make your store yours <ArrowRight /></Link></Button>
        <Button asChild variant="ghost"><Link to="/whatsapp"><MessageCircle />Manage with WhatsApp <ArrowRight /></Link></Button></section>
    </div>
    <div className="overview-bottom">
      <section className="orders-section"><div className="panel-heading"><div><h2>Recent orders</h2><p>The latest from your store.</p></div><Button asChild variant="ghost"><Link to="/orders">View all <ArrowRight /></Link></Button></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead><tbody>
          {(recent.data ?? []).slice(0, 5).map(o => <tr key={o.id}><td className="font-semibold">#{o.order_number}</td><td><span className="customer-initial">{o.customer_name.charAt(0).toUpperCase()}</span>{o.customer_name}</td>
            <td><span className={`status-badge ${o.status === "cancelled" ? "out-of-stock" : o.status}`}><span />{STATUS_LABELS[o.status as OrderStatus] ?? o.status}</span></td><td className="font-semibold">{formatMoney(o.total)}</td></tr>)}</tbody></table>
          {recent.isSuccess && !recent.data.length && <p className="empty-message">No orders yet. They will appear here as soon as a customer checks out.</p>}
          {recent.isError && <p className="empty-message">Could not load your orders. Please refresh.</p>}</div></section>
      <section className="top-products"><div className="panel-heading"><h2>Top products</h2><Button asChild variant="ghost" size="icon" aria-label="View products"><Link to="/products"><ArrowUpRight /></Link></Button></div>
        {(analytics.data?.top_products ?? []).slice(0, 4).map((p, i) => <div className="top-product" key={p.title}><span className={`product-art tone-${i % 4}`}><ChartNoAxesCombined strokeWidth={1.2} /></span><div><strong>{p.title}</strong><span>{p.units} sold</span></div><strong>{formatMoney(p.revenue)}</strong></div>)}
        {analytics.isSuccess && !analytics.data.top_products.length && <p className="empty-message">No sales in the last 30 days.</p>}
        <Button asChild variant="link"><Link to="/products">Manage your products <ArrowRight /></Link></Button></section>
    </div>
  </>;
}
