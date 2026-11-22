import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Camera, ChartNoAxesCombined, Check, CheckCheck, ClipboardList, CreditCard, Lock, MessageCircle, Package, Palette, Plus, Search, ShoppingBag, Smartphone, Sparkles, Store, TrendingUp } from 'lucide-react';
import bottleImg from '@/assets/product-bottle.jpg';

/**
 * Landing page "features" section (Part 2).
 * A mixed bento layout: large cards carry small product-UI mockups, smaller cards carry lighter illustrations.
 * Everything inside the mockups is sample content drawn in HTML/SVG, so it needs no network.
 * Visual language (colors, type, radii, easing) follows the Part 1 hero: the `--sv-*` tokens are defined in styles.css.
 */

type Css = Record<`--${string}`, string | number>;
const vars = (v: Css) => v as CSSProperties;

/* ---------- small shared pieces ---------- */

function Bottle() {
  return <img className="fs-photo" src={bottleImg} alt="" width={816} height={816} loading="lazy" decoding="async" />;
}

function CandleArt() {
  return <svg className="fs-art" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 11c5 7 7 11 0 17-7-6-5-10 0-17z" fill="#F2A93B" />
    <rect x="25" y="35" width="50" height="11" rx="4.5" fill="#5A4636" />
    <rect x="23" y="44" width="54" height="46" rx="11" fill="#EAC98F" />
    <rect x="31" y="56" width="38" height="24" rx="4" fill="#FCF8EF" />
    <path d="M37 64h26M37 70h15" stroke="#267A52" strokeWidth="2.4" strokeLinecap="round" />
  </svg>;
}

function ToteArt() {
  return <svg className="fs-art" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M36 40c-2-24 28-24 28 0" fill="none" stroke="#C8B692" strokeWidth="3.4" strokeLinecap="round" />
    <path d="M23 38h54l4 51H19z" fill="#E6D9BF" />
    <rect x="39" y="55" width="22" height="17" rx="3" fill="#267A52" />
    <path d="M44 61h12M44 66h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

/** Recolourable product glyphs for the live designer preview (they follow the chosen palette). */
function Glyph({ n }: { n: 0 | 1 | 2 }) {
  return <svg className="fs-glyph" viewBox="0 0 60 60" aria-hidden="true">
    {n === 0 && <><rect x="22" y="6" width="16" height="9" rx="3" fill="currentColor" opacity=".55" /><rect x="18" y="14" width="24" height="42" rx="9" fill="currentColor" /></>}
    {n === 1 && <><path d="M30 5c3 4 4 6 0 9-4-3-3-5 0-9z" fill="currentColor" opacity=".55" /><rect x="15" y="17" width="30" height="7" rx="3" fill="currentColor" opacity=".7" /><rect x="13" y="22" width="34" height="34" rx="8" fill="currentColor" /></>}
    {n === 2 && <><path d="M22 24c-1-16 17-16 16 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" /><path d="M13 22h34l3 34H10z" fill="currentColor" /></>}
  </svg>;
}

function BrowserBar({ url }: { url: string }) {
  return <div className="fs-bar"><i /><i /><i /><span className="fs-url"><Lock />{url}</span></div>;
}

function Copy({ icon: Icon, title, text }: { icon: typeof Store; title: string; text: string }) {
  return <div className="fs-copy">
    <span className="fs-ico"><Icon /></span>
    <h3>{title}</h3>
    <p>{text}</p>
  </div>;
}

const k = (n: number) => vars({ '--k': n });

/* ---------- 1 · AI product creation ---------- */

function AiMock() {
  return <div className="fs-mock fs-stage fs-ai-mock" aria-hidden="true">
    <div className="fs-ai-in">
      <div className="fs-ai-photo">
        <Bottle />
        <span className="fs-scan" />
        <span className="fs-pill"><Camera />Photo added</span>
      </div>
      <div className="fs-ai-kw"><Search /><span>steel bottle, 750 ml</span></div>
    </div>
    <span className="fs-ai-link"><Sparkles /></span>
    <div className="fs-ai-draft">
      <div className="fs-draft-head"><strong>Product draft</strong><span className="fs-pill"><Sparkles />AI</span></div>
      <div className="fs-field fs-rise" style={k(1)}><small>Title</small><b>Sage Steel Bottle</b></div>
      <div className="fs-field fs-rise" style={k(2)}><small>Description</small><p>Double-wall steel bottle in a soft sage finish. Keeps drinks cold or hot all day.</p></div>
      <span className="fs-btn-mini fs-rise" style={k(3)}>Review draft</span>
    </div>
  </div>;
}

/* ---------- 2 · WhatsApp store management ---------- */

function WhatsAppMock() {
  return <div className="fs-mock fs-stage fs-wa-mock" aria-hidden="true">
    <div className="fs-chat-win">
      <div className="fs-chat-head"><span className="fs-av">O</span><div><b>Olive &amp; Oak</b><small>WhatsApp Business</small></div></div>
      <div className="fs-chat">
        <div className="fs-bub fs-rise" style={k(1)}>
          <b>Order #1042 confirmed</b>
          <span>2 items · ₹1,948. We’ll message you when it ships.</span>
          <em>10:42<CheckCheck /></em>
        </div>
        <div className="fs-bub fs-bub-prod fs-rise" style={k(2)}>
          <div className="fs-bub-card"><span className="fs-thumb fs-tone-a"><Bottle /></span><div><b>Sage Steel Bottle</b><small>₹1,299</small></div></div>
          <em>10:43<CheckCheck /></em>
        </div>
        <div className="fs-bub fs-rise" style={k(3)}>
          <b>Your order has shipped</b>
          <span>Order #1042 is on its way.</span>
          <em>Delivered<CheckCheck /></em>
        </div>
      </div>
    </div>
  </div>;
}

/* ---------- 3 · Easy online store creation ---------- */

function CreateMock() {
  return <div className="fs-mock fs-stage fs-create-mock" aria-hidden="true">
    <div className="fs-site">
      <BrowserBar url="oliveandoak.storva.app" />
      <div className="fs-site-body">
        <div className="fs-s-nav fs-rise" style={k(0)}><strong><span />Olive &amp; Oak</strong><i /><i /></div>
        <div className="fs-s-banner fs-rise" style={k(1)}><b /><u /></div>
        <div className="fs-s-tiles">
          <span className="fs-tone-a fs-rise" style={k(2)}><Bottle /></span>
          <span className="fs-tone-b fs-rise" style={k(3)}><CandleArt /></span>
          <span className="fs-tone-c fs-rise" style={k(4)}><ToteArt /></span>
        </div>
      </div>
    </div>
    <span className="fs-live"><i />Store is live</span>
  </div>;
}

/* ---------- 4 · Live store designer (interactive) ---------- */

const PALETTES = [
  { name: 'Banana leaf', primary: '#2f6f3e', bg: '#f6faf3', surface: '#ffffff', text: '#18261b', muted: '#55675a', on: '#ffffff' },
  { name: 'Backwater', primary: '#0f766e', bg: '#f0fdfa', surface: '#ffffff', text: '#102a27', muted: '#4b635f', on: '#ffffff' },
  { name: 'Lotus', primary: '#be185d', bg: '#fff7fa', surface: '#ffffff', text: '#2b1220', muted: '#6e5060', on: '#ffffff' },
  { name: 'Charcoal', primary: '#f97316', bg: '#18181b', surface: '#27272a', text: '#fafafa', muted: '#a1a1aa', on: '#18181b' },
] as const;
const FONTS = [
  { name: 'Space Grotesk', css: "'Space Grotesk', ui-sans-serif, sans-serif" },
  { name: 'DM Sans', css: "'DM Sans', ui-sans-serif, sans-serif" },
  { name: 'Playfair Display', css: "'Playfair Display', Georgia, serif" },
] as const;
const HEADERS = [{ id: 'classic', label: 'Classic' }, { id: 'centered', label: 'Centered' }, { id: 'minimal', label: 'Minimal' }] as const;

function DesignerCard() {
  const [pal, setPal] = useState(0);
  const [font, setFont] = useState(0);
  const [header, setHeader] = useState<(typeof HEADERS)[number]['id']>('classic');
  const p = PALETTES[pal]!;
  const f = FONTS[font]!;
  const preview = vars({ '--p-primary': p.primary, '--p-bg': p.bg, '--p-surface': p.surface, '--p-text': p.text, '--p-muted': p.muted, '--p-on': p.on, '--p-head': f.css });

  return <article className="fs-card fs-design" style={vars({ '--s': 1 })}>
    <div className="fs-design-side">
      <Copy icon={Palette} title="Live Store Designer" text="Customize store colors, fonts, layouts and appearance." />
      <div className="fs-controls">
        <div role="group" aria-label="Color palette">
          <span className="fs-label">Colors <em>{p.name}</em></span>
          <div className="fs-swatches">{PALETTES.map((x, i) => <button type="button" key={x.name} className="fs-sw" aria-label={x.name} aria-pressed={pal === i} onClick={() => setPal(i)} style={vars({ '--c1': x.primary, '--c2': x.bg })} />)}</div>
        </div>
        <div role="group" aria-label="Heading font">
          <span className="fs-label">Heading font</span>
          <div className="fs-chips">{FONTS.map((x, i) => <button type="button" key={x.name} className="fs-chipbtn" aria-pressed={font === i} onClick={() => setFont(i)} style={{ fontFamily: x.css }}>{x.name}</button>)}</div>
        </div>
        <div role="group" aria-label="Header layout">
          <span className="fs-label">Header layout</span>
          <div className="fs-seg">{HEADERS.map(h => <button type="button" key={h.id} aria-pressed={header === h.id} onClick={() => setHeader(h.id)}>{h.label}</button>)}</div>
        </div>
      </div>
    </div>

    <div className="fs-stage fs-design-stage">
      <div className="fs-preview" style={preview} aria-hidden="true">
        <BrowserBar url="oliveandoak.storva.app" />
        <div className="fs-p-body">
          <div className="fs-p-head" data-style={header}>
            <strong className="fs-p-logo">Olive &amp; Oak</strong>
            {header !== 'minimal' && <span className="fs-p-links"><b>Shop</b><b>Collections</b><b>About</b></span>}
            <span className="fs-p-icons"><Search /><ShoppingBag /></span>
          </div>
          <div className="fs-p-banner">
            <small>Autumn edit</small>
            <strong>Slow-living essentials</strong>
            <span>Shop collection</span>
          </div>
          <div className="fs-p-grid">
            {(['Sage Steel Bottle', 'Soy Wax Candle', 'Linen Tote Bag'] as const).map((name, i) => <div className="fs-p-prod" key={name}>
              <span className="fs-p-img"><Glyph n={i as 0 | 1 | 2} /></span>
              <b>{name}</b>
              <small>{['₹1,299', '₹649', '₹899'][i]}</small>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </article>;
}

/* ---------- 5 · Product & catalog management ---------- */

const catalog = [
  { name: 'Sage Steel Bottle', meta: 'Drinkware', price: '₹1,299', stock: 'In stock · 24', tone: 'ok', art: <Bottle />, bg: 'fs-tone-a' },
  { name: 'Soy Wax Candle', meta: 'Home', price: '₹649', stock: 'Low stock · 3', tone: 'low', art: <CandleArt />, bg: 'fs-tone-b' },
  { name: 'Linen Tote Bag', meta: 'Accessories', price: '₹899', stock: 'In stock · 12', tone: 'ok', art: <ToteArt />, bg: 'fs-tone-c' },
] as const;

function CatalogMock() {
  return <div className="fs-mock fs-stage fs-cat-mock" aria-hidden="true">
    <div className="fs-cat-top">
      <span className="fs-cat-tabs"><b className="on">All</b><b>Home</b><b>Drinkware</b></span>
      <span className="fs-btn-mini fs-btn-icon"><Plus />Add product</span>
    </div>
    <div className="fs-cat-list">
      {catalog.map((c, i) => <div className="fs-cat-row fs-rise" style={k(i)} key={c.name}>
        <span className={`fs-thumb ${c.bg}`}>{c.art}</span>
        <div className="fs-cat-name"><b>{c.name}</b><small>{c.meta}</small></div>
        <span className={`fs-stock fs-stock-${c.tone}`}>{c.stock}</span>
        <strong>{c.price}</strong>
      </div>)}
    </div>
  </div>;
}

/* ---------- 6 · Order management (filter is interactive) ---------- */

type OrderStatus = 'Pending' | 'Shipped' | 'Delivered';
const orders: { id: string; who: string; items: string; status: OrderStatus; amount: string }[] = [
  { id: '#1042', who: 'Priya S.', items: '2 items', status: 'Pending', amount: '₹1,948' },
  { id: '#1041', who: 'Arjun M.', items: '1 item', status: 'Shipped', amount: '₹649' },
  { id: '#1040', who: 'Meera K.', items: '3 items', status: 'Delivered', amount: '₹2,140' },
  { id: '#1039', who: 'Rahul N.', items: '1 item', status: 'Delivered', amount: '₹899' },
];
const FILTERS = ['All', 'Pending', 'Shipped', 'Delivered'] as const;

function OrdersMock() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const rows = filter === 'All' ? orders : orders.filter(o => o.status === filter);
  const count = (s: (typeof FILTERS)[number]) => (s === 'All' ? orders.length : orders.filter(o => o.status === s).length);
  return <div className="fs-mock fs-stage fs-ord-mock">
    <div className="fs-o-filters" role="group" aria-label="Filter sample orders by status">
      {FILTERS.map(s => <button type="button" key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}<em>{count(s)}</em></button>)}
    </div>
    <ul className="fs-o-list">
      {rows.map(o => <li className="fs-o-row" key={o.id}>
        <span className="fs-o-av" aria-hidden="true">{o.who[0]}</span>
        <div className="fs-o-who"><b>{o.who}</b><small>{o.id} · {o.items}</small></div>
        <span className={`fs-status fs-status-${o.status.toLowerCase()}`}><i />{o.status}</span>
        <strong>{o.amount}</strong>
      </li>)}
    </ul>
  </div>;
}

/* ---------- 7 · Online payments ---------- */

function PaymentsMock() {
  return <div className="fs-mock fs-stage fs-pay-mock" aria-hidden="true">
    <div className="fs-pay-card">
      <div className="fs-pay-head"><strong>Checkout</strong><span className="fs-secure"><Lock />Secure</span></div>
      <div className="fs-pay-total"><small>Order total</small><b>₹1,948</b></div>
      <div className="fs-pay-method"><span className="fs-radio"><Check /></span><div><b>Pay online</b><small>Through the payment integration</small></div></div>
      <span className="fs-pay-btn"><Lock />Pay ₹1,948</span>
    </div>
    <div className="fs-toast fs-rise" style={k(2)}>
      <span><Check /></span>
      <div><b>Payment received</b><small>Order #1042 · Just now</small></div>
    </div>
  </div>;
}

/* ---------- 8 · Business analytics ---------- */

function AnalyticsMock() {
  return <div className="fs-mock fs-stage fs-stat-mock" aria-hidden="true">
    <div className="fs-stat-card">
      <div className="fs-stat-head"><strong>Revenue</strong><span>Last 30 days</span></div>
      <div className="fs-stat-main"><b>₹84,320</b><span className="fs-delta"><TrendingUp />18.2%</span></div>
      <svg className="fs-chart" viewBox="0 0 220 64" preserveAspectRatio="none">
        <defs><linearGradient id="fs-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#267A52" stopOpacity=".26" /><stop offset="1" stopColor="#267A52" stopOpacity="0" /></linearGradient></defs>
        <path className="fs-area" d="M0 50C16 48 26 40 42 43S68 30 84 27 114 30 132 20 166 15 186 10 210 6 220 4V64H0Z" fill="url(#fs-area)" />
        <path className="fs-line" pathLength={1} d="M0 50C16 48 26 40 42 43S68 30 84 27 114 30 132 20 166 15 186 10 210 6 220 4" fill="none" stroke="#267A52" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="fs-stat-tiles">
        <span><b>126</b>Orders</span>
        <span><b>2,840</b>Visitors</span>
        <span><b>31</b>Repeat</span>
      </div>
    </div>
  </div>;
}

/* ---------- 9 · Mobile-friendly storefront ---------- */

function MobileMock() {
  return <div className="fs-mock fs-mob-mock" aria-hidden="true">
    <div className="fs-phone">
      <div className="fs-ph-status"><b>9:41</b><i /></div>
      <div className="fs-ph-nav"><strong><span />Olive &amp; Oak</strong><span className="fs-ph-bag"><ShoppingBag /><em>2</em></span></div>
      <div className="fs-ph-banner"><small>Autumn edit</small><strong>Slow-living essentials</strong></div>
      <div className="fs-ph-grid">
        <div><span className="fs-tone-a"><Bottle /></span><b>Sage Steel Bottle</b><small>₹1,299</small></div>
        <div><span className="fs-tone-b"><CandleArt /></span><b>Soy Wax Candle</b><small>₹649</small></div>
      </div>
      <div className="fs-ph-cart"><span>View cart · 2 items</span><b>₹1,948</b></div>
    </div>
  </div>;
}

/* ---------- section ---------- */

/** Reveals the cards once as they scroll into view; content stays visible if JS or IntersectionObserver is unavailable. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.fs-card'));
    if (typeof IntersectionObserver === 'undefined') { cards.forEach(c => c.classList.add('is-in')); return; }
    const vh = window.innerHeight;
    cards.forEach(c => { const r = c.getBoundingClientRect(); if (r.top < vh * 0.9 && r.bottom > 0) c.classList.add('is-in'); });
    root.dataset.armed = 'true';
    const io = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    cards.forEach(c => { if (!c.classList.contains('is-in')) io.observe(c); });
    return () => io.disconnect();
  }, []);
  return ref;
}

export function FeaturesShowcase() {
  const gridRef = useReveal<HTMLDivElement>();

  // Soft spotlight that follows the pointer inside the hovered card (mouse only).
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.fs-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }

  return <section id="features" className="sv-features lp-anchor" aria-labelledby="features-title">
    <div className="sv-features-bg" aria-hidden="true" />
    <div className="site-width">
      <header className="fs-head">
        <h2 id="features-title">Everything You Need to <span className="sv-hl">Sell Online</span>.</h2>
        <p>Simple tools that help business owners launch a store, manage it and grow.</p>
      </header>

      <div className="fs-grid" ref={gridRef} onPointerMove={onPointerMove}>
        <article className="fs-card fs-ai" style={vars({ '--s': 0 })}>
          <Copy icon={Sparkles} title="AI Product Creation" text="Create product drafts using product images or keywords." />
          <AiMock />
        </article>

        <article className="fs-card fs-wa" style={vars({ '--s': 1 })}>
          <Copy icon={MessageCircle} title="WhatsApp Store Management" text="Manage supported store operations through WhatsApp." />
          <WhatsAppMock />
        </article>

        <article className="fs-card fs-create" style={vars({ '--s': 0 })}>
          <Copy icon={Store} title="Easy Online Store Creation" text="Build an online storefront without coding." />
          <CreateMock />
        </article>

        <DesignerCard />

        <article className="fs-card fs-catalog" style={vars({ '--s': 0 })}>
          <Copy icon={Package} title="Product & Catalog Management" text="Manage products, images, prices, stock and categories." />
          <CatalogMock />
        </article>

        <article className="fs-card fs-orders" style={vars({ '--s': 1 })}>
          <Copy icon={ClipboardList} title="Order Management" text="View and manage customer orders." />
          <OrdersMock />
        </article>

        <article className="fs-card fs-pay" style={vars({ '--s': 0 })}>
          <Copy icon={CreditCard} title="Online Payments" text="Support available payment integrations." />
          <PaymentsMock />
        </article>

        <article className="fs-card fs-stats" style={vars({ '--s': 1 })}>
          <Copy icon={ChartNoAxesCombined} title="Business Analytics" text="Understand business performance using available analytics." />
          <AnalyticsMock />
        </article>

        <article className="fs-card fs-mobile" style={vars({ '--s': 2 })}>
          <Copy icon={Smartphone} title="Mobile-Friendly Storefront" text="Provide a smooth shopping experience on mobile devices." />
          <MobileMock />
        </article>
      </div>
    </div>
  </section>;
}
