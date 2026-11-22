import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ShoppingBag, Search, Menu, Minus, Plus, Instagram, Facebook, Youtube, MessageCircle, Mail, Phone, MapPin, X as XIcon, Store } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { googleFontsHref, readableOn, safeHref, type Theme, type ThemeSection, type NavLink } from "@/lib/theme-rules";
import { formatMoney } from "@/lib/order-rules";

export type SFProduct = { id: string; title: string; description: string; price: number; compare_at_price: number | null; category: string | null; image_path: string | null; available: number };
export type SelectTarget = string; // section id, "header" or "footer"

type Props = {
  storeName: string;
  theme: Theme;
  products: SFProduct[];
  images: Record<string, string>;
  mode: "live" | "preview";
  selected?: SelectTarget | null;
  onSelect?: (target: SelectTarget) => void;
  cart: Record<string, number>;
  cartCount: number;
  cartTotal: number;
  onOpenCart: () => void;
  onSetQty: (p: SFProduct, qty: number) => void;
  onProductView?: (p: SFProduct) => void;
  notice?: ReactNode;
  /** Slug of the shop page being shown (About, policies…), or null for the main shop. */
  page?: string | null;
  onPage?: (slug: string | null) => void;
};

const RADIUS = { none: "0px", small: "0.5rem", large: "1.25rem" } as const;
const SHAPE = { square: "aspect-square", portrait: "aspect-[3/4]", landscape: "aspect-[4/3]" } as const;
const CLAMP = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;
const CARD = { bordered: "border border-sf-border bg-sf-surface", shadow: "bg-sf-surface shadow-md", flat: "bg-transparent" } as const;

export function themeStyle(theme: Theme): CSSProperties {
  const c = theme.colors;
  return {
    "--sf-primary": c.primary, "--sf-on-primary": readableOn(c.primary), "--sf-bg": c.background, "--sf-surface": c.surface,
    "--sf-text": c.text, "--sf-muted": c.muted, "--sf-accent": c.accent, "--sf-on-accent": readableOn(c.accent),
    "--sf-font-heading": `"${theme.fonts.heading}", ui-sans-serif, system-ui, sans-serif`,
    "--sf-font-body": `"${theme.fonts.body}", ui-sans-serif, system-ui, sans-serif`,
    "--sf-radius": RADIUS[theme.radius],
  } as CSSProperties;
}

export function StorefrontView(props: Props) {
  const { theme, products, images, mode, selected, onSelect } = props;
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState<SFProduct | null>(null);
  const preview = mode === "preview";
  const activePage = props.page ? theme.pages.find(p => p.slug === props.page) ?? null : null;
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter((c): c is string => !!c))].sort(), [products]);

  const selectable = (target: SelectTarget) => preview && onSelect
    ? { className: `sf-selectable ${selected === target ? "sf-selected" : ""}`, onClickCapture: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onSelect(target); } }
    : { className: "" };

  function scrollTo(id: string) {
    if (preview) return;
    document.getElementById(`sf-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function followLink(link: NavLink) {
    setMenuOpen(false);
    if (link.type === "section") { if (activePage) { props.onPage?.(null); setTimeout(() => scrollTo(link.target), 50); } else scrollTo(link.target); }
    else if (link.type === "page") props.onPage?.(link.target);
    else if (link.type === "category") { props.onPage?.(null); setCategory(link.target || null); const first = theme.sections.find(s => s.type === "products" && s.enabled); if (first) scrollTo(first.id); }
    else if (!preview) { const h = safeHref(link.target); if (h) window.open(h, "_blank", "noopener,noreferrer"); }
  }
  function cta(hrefValue: string) {
    const h = safeHref(hrefValue);
    if (!h || preview) return;
    if (h.startsWith("#")) scrollTo(h.slice(1)); else window.location.href = h;
  }
  function viewProduct(p: SFProduct) { setDetail(p); props.onProductView?.(p); }

  const logo = theme.header.showLogo && theme.header.logoPath ? images[theme.header.logoPath] : null;
  const h = theme.header;
  const navLinks = theme.nav.links;
  const brand = <span className="flex min-w-0 items-center gap-2">{logo ? <img src={logo} alt={props.storeName} className="h-9 w-auto max-w-[9rem] object-contain" /> : <Store className="size-6 shrink-0 text-sf-primary" aria-hidden />}<span className="sf-heading truncate text-xl font-bold">{props.storeName}</span></span>;
  const cartButton = h.showCart && <button type="button" onClick={props.onOpenCart} aria-label={`Cart, ${props.cartCount} items`} className="inline-flex h-10 items-center gap-2 rounded-sf bg-sf-primary px-4 text-sm font-medium text-sf-on-primary"><ShoppingBag className="size-4" />{props.cartCount > 0 ? `${props.cartCount} · ${formatMoney(props.cartTotal)}` : "Cart"}</button>;
  const searchButton = h.showSearch && <button type="button" aria-label="Search products" onClick={() => setSearchOpen(o => !o)} className="inline-flex size-10 items-center justify-center rounded-sf text-sf-text hover:bg-sf-border"><Search className="size-5" /></button>;
  const nav = navLinks.length > 0 && (theme.nav.style === "bar"
    ? <nav aria-label="Shop menu" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">{navLinks.map(l => <button key={l.id} type="button" onClick={() => followLink(l)} className="text-sf-text hover:text-sf-primary">{l.label}</button>)}</nav>
    : <div className="relative"><button type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)} className="inline-flex size-10 items-center justify-center rounded-sf hover:bg-sf-border"><Menu className="size-5" /></button>
        {menuOpen && <nav aria-label="Shop menu" className="absolute left-0 top-11 z-30 grid min-w-48 rounded-sf border border-sf-border bg-sf-surface p-2 shadow-lg">{navLinks.map(l => <button key={l.id} type="button" onClick={() => followLink(l)} className="rounded-sf px-3 py-2 text-left text-sm hover:bg-sf-border">{l.label}</button>)}</nav>}</div>);

  return <div className="storefront @container min-h-full" style={themeStyle(theme)}>
    <link rel="stylesheet" href={googleFontsHref(theme.fonts)} precedence="default" />
    <div {...selectable("header")} className={`${selectable("header").className} ${h.sticky && !preview ? "sticky top-0 z-20" : ""}`}>
      {h.announcement.enabled && h.announcement.text && <p className="bg-sf-accent px-4 py-2 text-center text-sm font-medium text-sf-on-accent">{h.announcement.href && safeHref(h.announcement.href) && !preview ? <a href={safeHref(h.announcement.href)!} className="underline-offset-4 hover:underline">{h.announcement.text}</a> : h.announcement.text}</p>}
      <header className="border-b border-sf-border bg-sf-surface">
        {h.style === "centered"
          ? <div className="mx-auto grid max-w-6xl gap-3 px-5 py-4"><div className="flex items-center justify-between gap-3"><div className="w-24">{theme.nav.style === "menu" ? nav : searchButton}</div><div className="flex justify-center">{brand}</div><div className="flex w-24 justify-end">{cartButton}</div></div>{theme.nav.style === "bar" && navLinks.length > 0 && <div className="flex justify-center">{nav}</div>}{theme.nav.style === "menu" && h.showSearch && <div className="flex justify-center">{searchButton}</div>}</div>
          : <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="flex min-w-0 items-center gap-6">{theme.nav.style === "menu" && nav}{brand}{h.style === "classic" && theme.nav.style === "bar" && <div className="hidden @2xl:block">{nav}</div>}</div><div className="flex items-center gap-1">{h.style === "minimal" && theme.nav.style === "bar" && <div className="mr-3 hidden @2xl:block">{nav}</div>}{searchButton}{cartButton}</div>{theme.nav.style === "bar" && navLinks.length > 0 && <div className="w-full @2xl:hidden">{nav}</div>}</div>}
        {searchOpen && <div className="mx-auto max-w-6xl px-5 pb-4"><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-11 w-full rounded-sf border border-sf-border bg-sf-bg px-4 text-sf-text outline-none focus:border-sf-primary" /></div>}
      </header>
    </div>

    <main>
      {props.notice && <div className="mx-auto max-w-6xl px-5 pt-6">{props.notice}</div>}
      {activePage ? <article id="sf-page" className="mx-auto max-w-3xl px-5 py-12">
        <button type="button" onClick={() => props.onPage?.(null)} className="mb-6 inline-flex items-center gap-1 text-sm text-sf-primary"><ArrowLeft className="size-4" />Back to shop</button>
        <h1 className="text-3xl font-bold">{activePage.title}</h1>
        <div className="mt-6 grid gap-4 leading-relaxed">{activePage.body.split(/\n{2,}/).filter(Boolean).map((para, i) => <p key={i} className="whitespace-pre-line text-sf-text">{para}</p>)}</div>
      </article>
      : theme.sections.filter(s => s.enabled).map(s => <section key={s.id} id={`sf-${s.id}`} {...selectable(s.id)}>
        <SectionBlock section={s} {...props} query={query} category={category} setCategory={setCategory} categories={categories} onCta={cta} onView={viewProduct} onJump={() => { const first = theme.sections.find(x => x.type === "products" && x.enabled); if (first) scrollTo(first.id); }} />
      </section>)}
      {!activePage && !theme.sections.some(s => s.enabled) && <p className="py-24 text-center text-sf-muted">This shop is being set up.</p>}
    </main>

    <div {...selectable("footer")}><Footer theme={theme} storeName={props.storeName} preview={preview} onPage={slug => { props.onPage?.(slug); if (!preview) window.scrollTo({ top: 0 }); }} /></div>

    <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
      <DialogContent className="storefront max-h-[90vh] overflow-y-auto sm:max-w-2xl" style={themeStyle(theme)}>
        {detail && <>
          <DialogHeader><DialogTitle className="sf-heading text-2xl">{detail.title}</DialogTitle><DialogDescription className="text-sf-muted">{detail.category ?? ""}</DialogDescription></DialogHeader>
          <div className="grid gap-5 sm:grid-cols-2">
            <ProductImage p={detail} images={images} theme={theme} />
            <div className="grid content-start gap-4"><Price p={detail} theme={theme} large /><p className="whitespace-pre-line text-sm text-sf-muted">{detail.description || "No description yet."}</p><QtyControl p={detail} qty={props.cart[detail.id] ?? 0} onSetQty={props.onSetQty} /></div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}

type BlockProps = Props & { section: ThemeSection; query: string; category: string | null; setCategory: (c: string | null) => void; categories: string[]; onCta: (h: string) => void; onView: (p: SFProduct) => void; onJump: () => void };

function SectionBlock(b: BlockProps) {
  const s = b.section, t = b.theme;
  const img = s.imagePath ? b.images[s.imagePath] : null;
  const ctaBtn = s.ctaLabel && <button type="button" onClick={() => b.onCta(s.ctaHref)} className="mt-6 inline-flex h-11 items-center rounded-sf bg-sf-primary px-6 font-medium text-sf-on-primary">{s.ctaLabel}</button>;
  switch (s.type) {
    case "hero":
      return <div className="relative overflow-hidden">
        {img && <img src={img} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className={`relative mx-auto max-w-6xl px-5 py-16 @2xl:py-24 ${img ? "text-white" : ""}`} style={img ? { background: "linear-gradient(90deg, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.1))" } : undefined}>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight @2xl:text-5xl">{s.title || b.storeName}</h1>
          {s.subtitle && <p className={`mt-4 max-w-xl text-lg ${img ? "" : "text-sf-muted"}`}>{s.subtitle}</p>}{ctaBtn}
        </div>
      </div>;
    case "products": {
      const q = b.query.trim().toLowerCase();
      const cat = b.category ?? (s.category || null);
      const list = b.products.filter(p => (!cat || p.category === cat) && (!q || `${p.title} ${p.description} ${p.category ?? ""}`.toLowerCase().includes(q)));
      return <ProductGrid section={s} list={list} b={b} activeCategory={b.category} />;
    }
    case "categories":
      return <div className="mx-auto max-w-6xl px-5 py-12">{s.title && <h2 className="mb-6 text-2xl font-semibold">{s.title}</h2>}
        {b.categories.length ? <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">{b.categories.map(c => <button key={c} type="button" onClick={() => { b.setCategory(c); b.onJump(); }} className={`rounded-sf p-5 text-left font-medium ${CARD[t.grid.cardStyle]} hover:text-sf-primary`}>{c}<span className="block text-xs text-sf-muted">{b.products.filter(p => p.category === c).length} products</span></button>)}</div>
          : <p className="text-sf-muted">Categories appear here once products have one.</p>}</div>;
    case "banner":
      return <div className="bg-sf-accent text-sf-on-accent"><div className="mx-auto flex max-w-6xl flex-col items-start gap-2 px-5 py-10 @2xl:flex-row @2xl:items-center @2xl:justify-between"><div><h2 className="text-2xl font-semibold">{s.title}</h2>{s.body && <p className="mt-1 opacity-90">{s.body}</p>}</div>{s.ctaLabel && <button type="button" onClick={() => b.onCta(s.ctaHref)} className="inline-flex h-11 items-center rounded-sf bg-sf-primary px-6 font-medium text-sf-on-primary">{s.ctaLabel}</button>}</div></div>;
    case "text":
      return <div className="mx-auto max-w-3xl px-5 py-12">{s.title && <h2 className="text-2xl font-semibold">{s.title}</h2>}{img && <img src={img} alt="" className="mt-6 w-full rounded-sf object-cover" />}<p className="mt-4 whitespace-pre-line text-sf-muted">{s.body}</p>{ctaBtn}</div>;
    case "testimonials":
      return <div className="mx-auto max-w-6xl px-5 py-12">{s.title && <h2 className="mb-6 text-2xl font-semibold">{s.title}</h2>}<div className="grid gap-4 @2xl:grid-cols-3">{s.items.map(i => <figure key={i.id} className={`rounded-sf p-5 ${CARD[t.grid.cardStyle]}`}><blockquote className="text-sm">“{i.body}”</blockquote><figcaption className="mt-3 text-sm font-semibold text-sf-primary">{i.title}</figcaption></figure>)}</div>{!s.items.length && <p className="text-sf-muted">Add customer quotes in the designer.</p>}</div>;
    case "faq":
      return <div className="mx-auto max-w-3xl px-5 py-12">{s.title && <h2 className="mb-6 text-2xl font-semibold">{s.title}</h2>}<div className="divide-y divide-sf-border border-y border-sf-border">{s.items.map(i => <details key={i.id} className="group py-4"><summary className="cursor-pointer list-none font-medium">{i.title}</summary><p className="mt-2 whitespace-pre-line text-sm text-sf-muted">{i.body}</p></details>)}</div>{!s.items.length && <p className="text-sf-muted">Add questions and answers in the designer.</p>}</div>;
    case "contact": {
      const f = t.footer;
      return <div className="mx-auto max-w-6xl px-5 py-12"><h2 className="text-2xl font-semibold">{s.title || "Contact us"}</h2>{s.body && <p className="mt-2 text-sf-muted">{s.body}</p>}
        <ul className="mt-5 grid gap-3 text-sm @2xl:grid-cols-3">{f.phone && <li className="flex items-center gap-2"><Phone className="size-4 text-sf-primary" /><a href={`tel:${f.phone}`}>{f.phone}</a></li>}{f.email && <li className="flex items-center gap-2"><Mail className="size-4 text-sf-primary" /><a href={`mailto:${f.email}`}>{f.email}</a></li>}{f.socials.whatsapp && <li className="flex items-center gap-2"><MessageCircle className="size-4 text-sf-primary" /><a href={`https://wa.me/${f.socials.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp us</a></li>}{f.address && <li className="flex items-center gap-2 @2xl:col-span-3"><MapPin className="size-4 shrink-0 text-sf-primary" />{f.address}</li>}</ul>
        {!f.phone && !f.email && !f.address && !f.socials.whatsapp && <p className="mt-3 text-sm text-sf-muted">Add your phone, email or address in the footer settings.</p>}</div>;
    }
  }
}

function ProductGrid({ section, list, b, activeCategory }: { section: ThemeSection; list: SFProduct[]; b: BlockProps; activeCategory: string | null }) {
  const g = b.theme.grid;
  const [page, setPage] = useState(1);
  const shown = list.slice(0, page * g.perPage);
  return <div className="mx-auto max-w-6xl px-5 py-12">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">{section.title && <h2 className="text-2xl font-semibold">{section.title}</h2>}
      {activeCategory && <button type="button" onClick={() => b.setCategory(null)} className="inline-flex items-center gap-1 rounded-full border border-sf-border px-3 py-1 text-sm">{activeCategory}<XIcon className="size-3" aria-label="Clear category" /></button>}</div>
    {!list.length ? <p className="py-10 text-center text-sf-muted">{b.products.length ? "No products match." : "This shop has no products yet."}</p>
      : <ul className="grid grid-cols-[repeat(var(--cols-m),minmax(0,1fr))] gap-4 @lg:grid-cols-2 @3xl:grid-cols-[repeat(var(--cols-d),minmax(0,1fr))]" style={{ "--cols-m": g.columnsMobile, "--cols-d": g.columnsDesktop } as CSSProperties}>
        {shown.map(p => <li key={p.id} className={`flex flex-col overflow-hidden rounded-sf ${CARD[g.cardStyle]}`}>
          <button type="button" onClick={() => b.onView(p)} className="relative block text-left" aria-label={`View ${p.title}`}>
            <ProductImage p={p} images={b.images} theme={b.theme} />
            {g.showSaleBadge && p.compare_at_price !== null && p.compare_at_price > p.price && <span className="absolute left-3 top-3 rounded-full bg-sf-accent px-2.5 py-1 text-xs font-semibold text-sf-on-accent">{Math.round((1 - p.price / p.compare_at_price) * 100)}% off</span>}
          </button>
          <div className={`flex flex-1 flex-col gap-2 ${g.cardStyle === "flat" ? "pt-3" : "p-4"}`}>
            {p.category && <p className="text-xs uppercase tracking-wide text-sf-muted">{p.category}</p>}
            <button type="button" onClick={() => b.onView(p)} className={`text-left font-semibold ${CLAMP[g.titleLines as 1 | 2 | 3]}`}>{p.title}</button>
            <div className="mt-auto flex items-center justify-between gap-2 pt-2"><Price p={p} theme={b.theme} /><QtyControl p={p} qty={b.cart[p.id] ?? 0} onSetQty={b.onSetQty} compact /></div>
          </div>
        </li>)}
      </ul>}
    {shown.length < list.length && <div className="mt-8 flex justify-center"><button type="button" onClick={() => setPage(n => n + 1)} className="h-11 rounded-sf border border-sf-border px-6 font-medium">Show more ({list.length - shown.length})</button></div>}
  </div>;
}

function ProductImage({ p, images, theme }: { p: SFProduct; images: Record<string, string>; theme: Theme }) {
  const url = p.image_path ? images[p.image_path] : null;
  return <div className={`${SHAPE[theme.grid.imageShape]} w-full overflow-hidden bg-sf-border`}>{url ? <img src={url} alt={p.title} loading="lazy" className={`size-full ${theme.grid.imageFit === "cover" ? "object-cover" : "object-contain"}`} /> : <div className="flex size-full items-center justify-center text-sf-muted"><ShoppingBag className="size-8 opacity-40" aria-hidden /></div>}</div>;
}

function Price({ p, theme, large }: { p: SFProduct; theme: Theme; large?: boolean }) {
  const sale = p.compare_at_price !== null && p.compare_at_price > p.price;
  return <span className={large ? "text-2xl font-semibold" : "font-semibold"}>{formatMoney(p.price)}{sale && theme.grid.showSaleBadge && <s className="ml-2 text-sm font-normal text-sf-muted">{formatMoney(p.compare_at_price!)}</s>}</span>;
}

function QtyControl({ p, qty, onSetQty, compact }: { p: SFProduct; qty: number; onSetQty: (p: SFProduct, q: number) => void; compact?: boolean }) {
  if (p.available <= 0) return <span className="text-sm text-sf-muted">Out of stock</span>;
  if (qty > 0) return <div className="flex items-center gap-1"><button type="button" aria-label={`Remove one ${p.title}`} onClick={() => onSetQty(p, qty - 1)} className="inline-flex size-9 items-center justify-center rounded-sf border border-sf-border"><Minus className="size-4" /></button><span className="w-6 text-center" aria-live="polite">{qty}</span><button type="button" aria-label={`Add one ${p.title}`} disabled={qty >= p.available} onClick={() => onSetQty(p, qty + 1)} className="inline-flex size-9 items-center justify-center rounded-sf border border-sf-border disabled:opacity-40"><Plus className="size-4" /></button></div>;
  return <button type="button" onClick={() => onSetQty(p, 1)} className={`inline-flex items-center gap-1 rounded-sf bg-sf-primary font-medium text-sf-on-primary ${compact ? "h-9 px-3 text-sm" : "h-11 px-6"}`}><Plus className="size-4" />Add</button>;
}

function Footer({ theme, storeName, preview, onPage }: { theme: Theme; storeName: string; preview: boolean; onPage: (slug: string) => void }) {
  const f = theme.footer;
  const socials = ([["instagram", Instagram, "Instagram"], ["facebook", Facebook, "Facebook"], ["youtube", Youtube, "YouTube"], ["x", XIcon, "X"]] as const)
    .map(([k, Icon, label]) => ({ href: safeHref(f.socials[k]), Icon, label })).filter(s => s.href);
  const year = new Date().getFullYear();
  const links = f.links.map(l => ({ ...l, href: safeHref(l.url) })).filter(l => l.href);
  const pages = theme.pages.filter(p => p.showInFooter);
  const pageLink = (p: (typeof pages)[number], cls: string) => <button key={p.id} type="button" onClick={() => onPage(p.slug)} className={cls}>{p.title}</button>;
  const copy = <p className="text-xs text-sf-muted">{f.copyright || `© ${year} ${storeName}`} · Powered by STORVA</p>;
  const a = (href: string) => (preview ? { href: undefined } : { href, target: href.startsWith("http") ? "_blank" : undefined, rel: "noreferrer" });
  if (f.style === "simple") return <footer className="border-t border-sf-border bg-sf-surface"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6">{copy}<div className="flex flex-wrap items-center gap-4 text-sm">{pages.map(p => pageLink(p, "hover:text-sf-primary"))}{links.map(l => <a key={l.id} {...a(l.href!)} className="hover:text-sf-primary">{l.label}</a>)}{socials.map(s => <a key={s.label} {...a(s.href!)} aria-label={s.label} className="hover:text-sf-primary"><s.Icon className="size-4" /></a>)}</div></div></footer>;
  return <footer className="border-t border-sf-border bg-sf-surface"><div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 @2xl:grid-cols-3">
    <div><p className="sf-heading text-lg font-bold">{storeName}</p>{f.about && <p className="mt-2 text-sm text-sf-muted">{f.about}</p>}{socials.length > 0 && <div className="mt-4 flex gap-3">{socials.map(s => <a key={s.label} {...a(s.href!)} aria-label={s.label} className="inline-flex size-9 items-center justify-center rounded-full border border-sf-border hover:text-sf-primary"><s.Icon className="size-4" /></a>)}</div>}</div>
    <div><p className="font-semibold">Contact</p><ul className="mt-2 grid gap-1.5 text-sm text-sf-muted">{f.phone && <li>{f.phone}</li>}{f.email && <li>{f.email}</li>}{f.socials.whatsapp && <li>WhatsApp: +{f.socials.whatsapp}</li>}{f.address && <li>{f.address}</li>}{!f.phone && !f.email && !f.address && !f.socials.whatsapp && <li>—</li>}</ul></div>
    <div><p className="font-semibold">Links</p><ul className="mt-2 grid gap-1.5 text-sm">{pages.map(p => <li key={p.id}>{pageLink(p, "text-left text-sf-muted hover:text-sf-primary")}</li>)}{links.map(l => <li key={l.id}><a {...a(l.href!)} className="text-sf-muted hover:text-sf-primary">{l.label}</a></li>)}{!links.length && !pages.length && <li className="text-sf-muted">—</li>}</ul></div>
  </div><div className="mx-auto max-w-6xl border-t border-sf-border px-5 py-4">{copy}</div></footer>;
}
