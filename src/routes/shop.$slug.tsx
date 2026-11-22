import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Loader2, CheckCircle2, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { StorefrontView, type SFProduct } from "@/components/storefront-view";
import { getStorefront, placeOrder, trackStoreEvent, type StorefrontProduct } from "@/lib/store.functions";
import { checkoutSchema, formatMoney } from "@/lib/order-rules";
import { INDIAN_STATES, quoteOrder } from "@/lib/pricing-rules";

const storeQuery = (slug: string) => queryOptions({ queryKey: ["storefront", slug.toLowerCase()], queryFn: () => getStorefront({ data: { slug } }) });

export const Route = createFileRoute("/shop/$slug")({
  validateSearch: (search: Record<string, unknown>) => {
    const r = z.object({ page: z.string().regex(/^[a-z0-9-]{1,40}$/).optional() }).safeParse(search);
    return r.success ? r.data : {};
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(storeQuery(params.slug)),
  head: ({ loaderData, match }) => {
    const name = loaderData?.store_name ?? "Shop";
    const shopPage = match.search.page ? loaderData?.theme.pages.find(p => p.slug === match.search.page) : undefined;
    const title = shopPage ? `${shopPage.title} — ${name}` : `${name} — Shop online`;
    const about = loaderData?.theme.footer.about;
    const description = shopPage ? (shopPage.body.replace(/\s+/g, " ").trim().slice(0, 160) || title) : loaderData ? (about || `Order from ${name}. Cash on delivery across India.`).slice(0, 160) : "This shop could not be found.";
    return { meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
  },
  component: Shop,
});

type Cart = Record<string, number>;
const emptyForm = { name: "", phone: "", email: "", line1: "", line2: "", city: "", state: "", pincode: "", notes: "" };

/** Where the visitor came from: utm_source, else the referring site, else "direct". */
function trafficSource() {
  try {
    const utm = new URLSearchParams(window.location.search).get("utm_source");
    if (utm) return utm.toLowerCase().replace(/[^\w.-]/g, "").slice(0, 60) || "direct";
    if (document.referrer) { const host = new URL(document.referrer).hostname.replace(/^www\./, ""); if (host && host !== window.location.hostname) return host.slice(0, 60); }
  } catch { /* ignore */ }
  return "direct";
}

function Shop() {
  const { slug } = Route.useParams();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: store } = useSuspenseQuery(storeQuery(slug));
  const submit = useServerFn(placeOrder);
  const track = useServerFn(trackStoreEvent);
  const client = useQueryClient();
  const cartKey = `storva-cart-${slug.toLowerCase()}`;
  const [cart, setCart] = useState<Cart>({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"cart" | "details">("cart");
  const [form, setForm] = useState(emptyForm);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [placed, setPlaced] = useState<{ orderNumber: number; total: number } | null>(null);
  const source = useRef("direct");

  const send = (event: "view" | "product_view" | "add_to_cart" | "checkout_start", extra: { path?: string; productId?: string } = {}) => { track({ data: { slug, event, source: source.current, ...extra } }).catch(() => {}); };
  useEffect(() => { source.current = trafficSource(); if (store) send("view"); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(cartKey) ?? "{}"); if (saved && typeof saved === "object") setCart(saved as Cart); } catch { /* ignore corrupt cart */ } setLoaded(true); }, [cartKey]);
  useEffect(() => { if (loaded) localStorage.setItem(cartKey, JSON.stringify(cart)); }, [cart, cartKey, loaded]);

  const products = store?.products ?? [];
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const lines = Object.entries(cart).map(([id, qty]) => ({ product: byId.get(id), qty })).filter((l): l is { product: StorefrontProduct; qty: number } => !!l.product && l.qty > 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const quote = useMemo(() => quoteOrder(lines.map(l => ({ price: l.product.price, quantity: Math.min(l.qty, l.product.available), gstRate: l.product.gst_rate })), store?.commerce ?? {}, form.state), [lines, store?.commerce, form.state]);

  function setQty(p: SFProduct, qty: number) {
    const next = Math.max(0, Math.min(qty, p.available));
    if (qty > p.available) toast.error(`Only ${p.available} available.`);
    if (next > (cart[p.id] ?? 0)) send("add_to_cart", { path: `/p/${p.id}`, productId: p.id });
    setCart(c => { const n = { ...c }; if (next) n[p.id] = next; else delete n[p.id]; return n; });
    setCheckoutKey(null);
  }
  async function checkout(e: React.FormEvent) {
    e.preventDefault(); setProblem("");
    const key = checkoutKey ?? crypto.randomUUID();
    setCheckoutKey(key);
    const { notes, ...customer } = form;
    const parsed = checkoutSchema.safeParse({ slug, checkoutKey: key, customer, notes, items: lines.map(l => ({ productId: l.product.id, quantity: l.qty })) });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? "Check the form."); return; }
    if (!quote.deliverable) { setProblem(`Sorry, this shop does not deliver to ${form.state} yet.`); return; }
    if (!quote.codAvailable) { setProblem("Cash on delivery is not available for this order. Please contact the shop."); return; }
    setBusy(true);
    try {
      const result = await submit({ data: { ...parsed.data, source: source.current } });
      setPlaced(result); setCart({}); setForm(emptyForm); setCheckoutKey(null); setStep("cart"); setOpen(false);
      client.invalidateQueries({ queryKey: ["storefront", slug.toLowerCase()] });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not place your order. Please try again.");
      client.invalidateQueries({ queryKey: ["storefront", slug.toLowerCase()] });
    } finally { setBusy(false); }
  }

  if (!store) return <main className="mx-auto max-w-md px-6 py-24 text-center"><Store className="mx-auto size-10 text-muted-foreground" /><h1 className="mt-4 font-display text-2xl font-semibold">Shop not found</h1><p className="mt-2 text-muted-foreground">Check the link you were given.</p></main>;

  const field = (key: keyof typeof emptyForm, label: string, props: React.ComponentProps<typeof Input> = {}) => <label className="grid gap-1.5 text-sm">{label}<Input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} {...props} /></label>;
  const c = store.commerce;
  const row = (label: string, value: string, strong = false) => <p className={`flex justify-between ${strong ? "border-t border-border pt-2 font-semibold" : "text-sm"}`}><span>{label}</span><span>{value}</span></p>;
  const summary = <div className="grid gap-1.5">
    {row("Items", formatMoney(quote.goods))}
    {c.gst_enabled && quote.tax > 0 && row(c.prices_include_gst === false ? "GST" : "Includes GST", formatMoney(quote.tax))}
    {row("Delivery", quote.shipping > 0 ? formatMoney(quote.shipping) : "Free")}
    {quote.codFee > 0 && row("Cash on delivery fee", formatMoney(quote.codFee))}
    {row("Total · Cash on delivery", formatMoney(quote.total), true)}
    {c.free_shipping_above && quote.shipping > 0 && <p className="text-xs text-muted-foreground">Free delivery on orders above {formatMoney(Number(c.free_shipping_above))}.</p>}
  </div>;

  return <>
    <StorefrontView storeName={store.store_name} theme={store.theme} products={products} images={store.images} mode="live" cart={cart} cartCount={count} cartTotal={quote.total}
      onOpenCart={() => { setStep("cart"); setOpen(true); }} onSetQty={setQty} onProductView={p => send("product_view", { path: `/p/${p.id}`, productId: p.id })}
      page={page ?? null} onPage={next => { void navigate({ search: next ? { page: next } : {} }); }}
      notice={placed && <section role="status" className="mb-2 rounded-sf border border-sf-primary bg-sf-surface p-5"><p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="text-sf-primary" />Order #{placed.orderNumber} placed</p><p className="mt-1 text-sm">Total {formatMoney(placed.total)}, payable in cash on delivery. {store.store_name} will contact you to confirm.</p><button type="button" className="mt-2 text-sm text-sf-primary underline-offset-4 hover:underline" onClick={() => setPlaced(null)}>Continue shopping</button></section>} />

    <Sheet open={open} onOpenChange={o => !busy && setOpen(o)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle className="font-display text-2xl">{step === "cart" ? "Your cart" : "Delivery details"}</SheetTitle><SheetDescription>{step === "cart" ? `${count} item${count === 1 ? "" : "s"}` : "Pay in cash when your order arrives."}</SheetDescription></SheetHeader>
        {step === "cart" ? <div className="px-4">
          {!lines.length ? <p className="mt-8 text-center text-muted-foreground">Your cart is empty.</p> : <ul className="mt-4 divide-y divide-border">{lines.map(({ product: p, qty }) => <li key={p.id} className="flex items-center gap-3 py-3">
              {p.image_path && store.images[p.image_path] && <img src={store.images[p.image_path]} alt="" className="size-12 rounded object-cover" />}
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{formatMoney(p.price)} each</p></div>
              <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label={`Remove one ${p.title}`} onClick={() => setQty(p, qty - 1)}><Minus /></Button><span className="w-5 text-center">{qty}</span><Button size="icon" variant="ghost" aria-label={`Add one ${p.title}`} disabled={qty >= p.available} onClick={() => setQty(p, qty + 1)}><Plus /></Button></div>
              <Button size="icon" variant="ghost" aria-label={`Remove ${p.title}`} onClick={() => setQty(p, 0)}><Trash2 /></Button>
            </li>)}</ul>}
          {lines.length > 0 && <><div className="mt-4 border-t border-border pt-4">{summary}</div><p className="mt-2 text-xs text-muted-foreground">Delivery charges for your state are confirmed at checkout.</p><Button className="mt-4 h-11 w-full" onClick={() => { setProblem(""); setStep("details"); send("checkout_start", { path: "/checkout" }); }}>Checkout</Button></>}
        </div> : <form onSubmit={checkout} className="grid gap-3 px-4 pb-6" noValidate>
          {field("name", "Full name", { autoComplete: "name", required: true, maxLength: 100 })}
          {field("phone", "Mobile number", { autoComplete: "tel", inputMode: "tel", required: true, placeholder: "98765 43210", maxLength: 16 })}
          {field("email", "Email (optional)", { type: "email", autoComplete: "email", maxLength: 254 })}
          {field("line1", "House, street, area", { autoComplete: "address-line1", required: true, maxLength: 200 })}
          {field("line2", "Landmark (optional)", { autoComplete: "address-line2", maxLength: 200 })}
          <div className="grid grid-cols-2 gap-3">{field("city", "City", { autoComplete: "address-level2", required: true, maxLength: 80 })}
            <label className="grid gap-1.5 text-sm">State<select required autoComplete="address-level1" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm"><option value="">Choose…</option>{INDIAN_STATES.map(s => <option key={s}>{s}</option>)}</select></label></div>
          {field("pincode", "PIN code", { autoComplete: "postal-code", inputMode: "numeric", required: true, maxLength: 6 })}
          <label className="grid gap-1.5 text-sm">Notes for the shop (optional)<Textarea rows={2} maxLength={500} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="border-t border-border pt-3">{summary}</div>
          {form.state && !quote.deliverable && <p role="alert" className="text-sm text-destructive">This shop does not deliver to {form.state} yet.</p>}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <Button type="submit" className="h-11" disabled={busy || !lines.length}>{busy && <Loader2 className="animate-spin" />}Place order</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep("cart")}>Back to cart</Button>
        </form>}
      </SheetContent>
    </Sheet>
  </>;
}
