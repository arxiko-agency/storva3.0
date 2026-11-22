import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { StoreShell } from "@/components/store-shell";
import { Button } from "@/components/ui/button";
import { getInvoice } from "@/lib/commerce.functions";
import { formatMoney, type ShippingAddress } from "@/lib/order-rules";
import { rupeesInWords } from "@/lib/pricing-rules";

export const Route = createFileRoute("/invoice/$orderId")({
  head: () => ({ meta: [
    { title: "STORVA — Invoice" },
    { name: "description", content: "Printable GST tax invoice or bill of supply for an order." },
    { property: "og:title", content: "STORVA — Invoice" },
    { property: "og:description", content: "Order invoice from a STORVA store." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: () => <StoreShell><Invoice /></StoreShell>,
});

function Invoice() {
  const { orderId } = Route.useParams();
  const get = useServerFn(getInvoice);
  const q = useQuery({ queryKey: ["invoice", orderId], queryFn: () => get({ data: { orderId } }) });
  if (q.isPending) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;
  if (q.error || !q.data) return <div role="alert" className="mx-auto max-w-xl p-10 text-center"><p className="text-destructive">{q.error?.message ?? "Unavailable"}</p><Button className="mt-4" variant="outline" asChild><Link to="/orders"><ArrowLeft />Back to orders</Link></Button></div>;
  const { order: o, seller, storeName } = q.data;
  const items = o.order_items as { title: string; quantity: number; unit_price: number; line_total: number; hsn_code: string | null; gst_rate: number; taxable_value: number; tax_amount: number }[];
  const a = (o.shipping_address ?? {}) as ShippingAddress;
  const gst = o.gst_applied;
  const intra = Number(o.cgst) > 0 || Number(o.sgst) > 0;
  const m = (v: number | string) => formatMoney(Number(v));
  return <main className="mx-auto max-w-4xl px-5 py-8">
    <div className="print-hidden mb-6 flex flex-wrap justify-between gap-2"><Button variant="ghost" asChild><Link to="/orders"><ArrowLeft />Orders</Link></Button><Button onClick={() => window.print()}><Printer />Print / Save as PDF</Button></div>
    <article className="rounded-md border border-border bg-card p-8 text-sm print:border-0 print:p-0">
      <header className="flex flex-wrap justify-between gap-6 border-b border-border pb-6">
        <div><h1 className="font-display text-2xl font-bold">{gst ? "Tax invoice" : "Bill of supply"}</h1><p className="mt-1 font-mono">{o.invoice_number}</p><p className="text-muted-foreground">Date: {new Date(o.invoiced_at!).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })} · Order #{o.order_number}</p></div>
        <div className="text-right"><p className="text-base font-semibold">{seller?.legal_name || storeName}</p>{seller?.business_address && <p className="whitespace-pre-line text-muted-foreground">{seller.business_address}</p>}{seller?.business_state && <p className="text-muted-foreground">{seller.business_state}</p>}{seller?.gstin && <p className="font-mono">GSTIN: {seller.gstin}</p>}</div>
      </header>
      <section className="grid gap-4 border-b border-border py-6 sm:grid-cols-2">
        <div><p className="text-xs uppercase text-muted-foreground">Bill / ship to</p><p className="font-medium">{o.customer_name}</p><p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p><p>{a.city}, {a.state} {a.pincode}</p>{o.customer_phone && <p>+91 {o.customer_phone}</p>}</div>
        <div className="sm:text-right"><p className="text-xs uppercase text-muted-foreground">Place of supply</p><p className="font-medium">{o.place_of_supply ?? a.state}</p><p className="mt-2 text-xs uppercase text-muted-foreground">Payment</p><p>Cash on delivery · {o.payment_status === "paid" ? "Paid" : "Due on delivery"}</p>{o.status === "cancelled" && <p className="mt-2 font-semibold text-destructive">CANCELLED</p>}</div>
      </section>
      <div className="overflow-x-auto"><table className="mt-4 w-full border-collapse text-left">
        <thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-2">Item</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th>{gst && <><th className="text-right">Taxable</th><th className="text-right">GST</th></>}<th className="text-right">Amount</th></tr></thead>
        <tbody>{items.map((i, n) => <tr key={n} className="border-b border-border"><td className="py-2 pr-2">{i.title}</td><td className="font-mono text-xs">{i.hsn_code ?? "—"}</td><td className="text-right">{i.quantity}</td><td className="text-right">{m(i.unit_price)}</td>{gst && <><td className="text-right">{m(i.taxable_value)}</td><td className="text-right">{Number(i.gst_rate)}% · {m(i.tax_amount)}</td></>}<td className="text-right">{m(i.line_total)}</td></tr>)}</tbody>
      </table></div>
      <section className="ml-auto mt-4 grid max-w-xs gap-1">
        {gst && <p className="flex justify-between"><span>Taxable value</span><span>{m(o.taxable_total)}</span></p>}
        {gst && intra && <><p className="flex justify-between"><span>CGST</span><span>{m(o.cgst)}</span></p><p className="flex justify-between"><span>SGST</span><span>{m(o.sgst)}</span></p></>}
        {gst && !intra && <p className="flex justify-between"><span>IGST</span><span>{m(o.igst)}</span></p>}
        <p className="flex justify-between"><span>Delivery</span><span>{m(o.shipping_fee)}</span></p>
        {Number(o.cod_fee) > 0 && <p className="flex justify-between"><span>COD fee</span><span>{m(o.cod_fee)}</span></p>}
        <p className="flex justify-between border-t border-border pt-2 text-base font-semibold"><span>Total</span><span>{m(o.total)}</span></p>
        <p className="text-xs text-muted-foreground">{rupeesInWords(Number(o.total))}</p>
      </section>
      <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">{gst ? (o.prices_include_gst ? "Prices include GST." : "GST added to listed prices.") : "Composition / unregistered supplier — no GST charged."} Delivery and COD fees are not taxed. This is a computer-generated invoice.</footer>
    </article>
  </main>;
}
