import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Award, Bell, Check, ChartNoAxesCombined, Copy, LayoutDashboard, Link2, Lock, Mail, MessageCircle, Monitor, Package, Palette, Plus, QrCode, Settings, ShoppingBag, Smartphone, Store, TrendingUp, Upload, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import bottleImg from '@/assets/product-bottle.jpg';

/**
 * Landing page storytelling (Part 3).
 *  - <StoryScroll />  Create → Manage → Grow. On desktop a sticky stage swaps scenes as the chapters scroll past;
 *                     on small screens every chapter carries its own scene.
 *  - <HowItWorks />   Four steps with a progress line that fills as the section scrolls into view.
 * Everything inside the scenes is sample content drawn in HTML/SVG (no network). Visual language follows the
 * hero and features sections: the `--sv-*` tokens are declared in styles.css. Motion is plain CSS and is switched
 * off by the global prefers-reduced-motion rule, so the resting state of every element is its final, visible state.
 */

type Css = Record<`--${string}`, string | number>;
const vars = (v: Css) => v as CSSProperties;
const k = (n: number) => vars({ '--k': n });
const rv = (n: number) => vars({ '--r': n });
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type ElRef = { current: HTMLElement | null };

/**
 * Scroll-triggered reveal. Every `[data-rv]` element inside `root` gets `data-in` the first time it scrolls into view;
 * the `.rv-item` children inside it then fade/slide in with a stagger (`--r`). The hidden starting state only exists once
 * `data-armed` is set here, so without JS, without IntersectionObserver or with reduced motion everything is simply visible.
 */
function useReveal(root: ElRef) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>('[data-rv]'));
    el.dataset.armed = 'true';
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).dataset.in = 'true';
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    targets.forEach(t => io.observe(t));
    return () => { io.disconnect(); delete el.dataset.armed; };
  }, [root]);
}

/**
 * Scroll-linked values without a permanent scroll listener: the listener is attached only while `target` is near the
 * viewport, is passive, and work is batched into one requestAnimationFrame per frame.
 */
function useScrollLink(target: ElRef, fn: (rect: DOMRect, viewportHeight: number) => void) {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let raf = 0;
    let live = false;
    const run = () => { raf = 0; latest.current(el.getBoundingClientRect(), window.innerHeight); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(run); };
    const attach = (on: boolean) => {
      if (on === live) return;
      live = on;
      if (on) { window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll(); }
      else { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); }
    };
    run();
    if (typeof IntersectionObserver === 'undefined') { attach(true); return () => attach(false); }
    const io = new IntersectionObserver(([e]) => attach(!!e?.isIntersecting), { rootMargin: '25% 0px 25% 0px' });
    io.observe(el);
    return () => { io.disconnect(); attach(false); if (raf) cancelAnimationFrame(raf); };
  }, [target]);
}

/* ---------- small shared pieces ---------- */

function Bottle() {
  return <img className="st-photo" src={bottleImg} alt="" width={816} height={816} loading="lazy" decoding="async" />;
}

function Glyph({ n }: { n: 0 | 1 | 2 }) {
  return <svg className="st-glyph" viewBox="0 0 60 60" aria-hidden="true">
    {n === 0 && <><rect x="22" y="6" width="16" height="9" rx="3" fill="currentColor" opacity=".55" /><rect x="18" y="14" width="24" height="42" rx="9" fill="currentColor" /></>}
    {n === 1 && <><path d="M30 5c3 4 4 6 0 9-4-3-3-5 0-9z" fill="currentColor" opacity=".55" /><rect x="15" y="17" width="30" height="7" rx="3" fill="currentColor" opacity=".7" /><rect x="13" y="22" width="34" height="34" rx="8" fill="currentColor" /></>}
    {n === 2 && <><path d="M22 24c-1-16 17-16 16 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" /><path d="M13 22h34l3 34H10z" fill="currentColor" /></>}
  </svg>;
}

function BrowserBar({ url }: { url: string }) {
  return <div className="st-bar"><i /><i /><i /><span className="st-url"><Lock />{url}</span></div>;
}

/* ====================================================================== */
/*  1 · CREATE                                                            */
/* ====================================================================== */

const PALETTES = [
  { name: 'Banana leaf', primary: '#2f6f3e', bg: '#f6faf3', surface: '#ffffff', text: '#18261b', muted: '#55675a', on: '#ffffff', font: 'Space Grotesk', css: "'Space Grotesk', ui-sans-serif, sans-serif" },
  { name: 'Backwater', primary: '#0f766e', bg: '#f0fdfa', surface: '#ffffff', text: '#102a27', muted: '#4b635f', on: '#ffffff', font: 'DM Sans', css: "'DM Sans', ui-sans-serif, sans-serif" },
  { name: 'Lotus', primary: '#be185d', bg: '#fff7fa', surface: '#ffffff', text: '#2b1220', muted: '#6e5060', on: '#ffffff', font: 'Manrope', css: "'Manrope', ui-sans-serif, sans-serif" },
  { name: 'Charcoal', primary: '#f97316', bg: '#18181b', surface: '#27272a', text: '#fafafa', muted: '#a1a1aa', on: '#18181b', font: 'Space Grotesk', css: "'Space Grotesk', ui-sans-serif, sans-serif" },
] as const;

function CreateScene({ active }: { active: boolean }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!active) return;
    setP(0);
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => { if (!document.hidden) setP(x => (x + 1) % PALETTES.length); }, 2400);
    return () => window.clearInterval(t);
  }, [active]);
  const P = PALETTES[p]!;
  return <div className="st-win st-create">
    <BrowserBar url="storva.app/create-store" />
    <div className="st-create-body">
      <div className="st-setup">
        <div className="st-field st-rise" style={k(0)}>
          <small>Store name</small>
          <div className="st-input"><span className="st-typed">Olive &amp; Oak</span><i className="st-caret" /></div>
        </div>
        <div className="st-field st-rise" style={k(1)}>
          <small>Store link</small>
          <div className="st-link"><Link2 /><span>oliveandoak<b>.storva.app</b></span><Check className="st-ok" /></div>
        </div>
        <div className="st-field st-rise" style={k(2)}>
          <small>Colors <em>{P.name}</em></small>
          <div className="st-swatches">{PALETTES.map((x, i) => <span key={x.name} className={i === p ? 'on' : ''} style={{ background: `linear-gradient(135deg, ${x.primary} 52%, ${x.bg} 52%)` }} />)}</div>
        </div>
        <div className="st-field st-rise" style={k(3)}>
          <small>Heading font</small>
          <div className="st-chips">{['Space Grotesk', 'DM Sans', 'Manrope'].map(f => <span key={f} className={f === P.font ? 'on' : ''}>{f}</span>)}</div>
        </div>
        <div className="st-field st-rise" style={k(4)}>
          <small>Header layout</small>
          <div className="st-chips">{['Classic', 'Centered', 'Minimal'].map((f, i) => <span key={f} className={i === 0 ? 'on' : ''}>{f}</span>)}</div>
        </div>
      </div>
      <div className="st-pv st-rise" style={{ ...vars({ '--pv-primary': P.primary, '--pv-bg': P.bg, '--pv-surface': P.surface, '--pv-text': P.text, '--pv-muted': P.muted, '--pv-on': P.on, '--pv-font': P.css, '--k': 1 }) }}>
        <div className="st-pv-nav"><strong><span />Olive &amp; Oak</strong><i /><i /><ShoppingBag /></div>
        <div className="st-pv-banner"><small>Autumn edit</small><b>Slow-living essentials</b><u>Shop collection</u></div>
        <div className="st-pv-tiles">
          {([['Sage Steel Bottle', '₹1,299'], ['Soy Wax Candle', '₹649'], ['Linen Tote Bag', '₹899']] as const).map(([n, pr], i) => <div key={n}><span><Glyph n={i as 0 | 1 | 2} /></span><b>{n}</b><small>{pr}</small></div>)}
        </div>
      </div>
    </div>
    <div className="st-create-foot st-rise" style={k(5)}>
      <span className="st-seg"><span className="on"><Monitor />Desktop</span><span><Smartphone />Mobile</span></span>
      <span className="st-btn">Continue<ArrowRight /></span>
    </div>
  </div>;
}

function CreateFloat() {
  return <span className="st-float st-float-live" style={vars({ '--d': 3 })}><i />Live preview</span>;
}

/* ====================================================================== */
/*  2 · MANAGE                                                            */
/* ====================================================================== */

const NAV: [typeof Store, string][] = [[LayoutDashboard, 'Overview'], [Package, 'Products'], [ShoppingBag, 'Orders'], [Users, 'Customers'], [Palette, 'Designer'], [Settings, 'Settings']];

function ManageScene(_props: { active: boolean }) {
  return <div className="st-win st-dash">
    <BrowserBar url="storva.app/dashboard" />
    <div className="st-dash-body">
      <aside className="st-side">
        <strong className="st-side-brand"><span />Olive &amp; Oak</strong>
        {NAV.map(([Icon, label]) => <span key={label} className={label === 'Products' ? 'on' : ''}><Icon /><b>{label}</b></span>)}
      </aside>
      <div className="st-main">
        <div className="st-main-head st-rise" style={k(0)}>
          <div><h4>Products</h4><small>48 products · 3 low on stock</small></div>
          <span className="st-btn"><Plus />Add product</span>
        </div>
        <div className="st-tiles st-rise" style={k(1)}>
          <div><small>Orders today</small><b>12</b></div>
          <div><small>Revenue</small><b>₹14,260</b></div>
          <div><small>Low stock</small><b className="warn">3</b></div>
        </div>
        <div className="st-panel st-rise" style={k(2)}>
          {[
            { n: 'Sage Steel Bottle', c: 'Drinkware', s: 'In stock · 24', pr: '₹1,299', t: 'a', art: <Bottle /> },
            { n: 'Soy Wax Candle', c: 'Home', s: 'Low stock · 3', pr: '₹649', t: 'b', low: true },
            { n: 'Linen Tote Bag', c: 'Accessories', s: 'In stock · 12', pr: '₹899', t: 'c' },
          ].map(r => <div className="st-row" key={r.n}>
            <span className={`st-thumb st-tone-${r.t}`}>{r.art ?? <Glyph n={r.t === 'b' ? 1 : 2} />}</span>
            <div className="st-row-main"><b>{r.n}</b><small>{r.c}</small></div>
            <span className={r.low ? 'st-pill warn' : 'st-pill'}>{r.s}</span>
            <strong>{r.pr}</strong>
          </div>)}
        </div>
        <div className="st-panel st-rise" style={k(3)}>
          <div className="st-panel-head"><b>Recent orders</b><span className="st-pill">4 open</span></div>
          {[
            { n: 'Priya S.', id: '#1042 · 2 items', s: 'Pending', c: 'gold', a: '₹1,948' },
            { n: 'Arjun M.', id: '#1041 · 1 item', s: 'Shipped', c: 'blue', a: '₹649' },
            { n: 'Meera K.', id: '#1040 · 3 items', s: 'Delivered', c: 'green', a: '₹2,140' },
          ].map(r => <div className="st-row st-row-order" key={r.id}>
            <span className="st-av">{r.n[0]}</span>
            <div className="st-row-main"><b>{r.n}</b><small>{r.id}</small></div>
            <span className={`st-pill st-${r.c}`}>{r.s}</span>
            <strong>{r.a}</strong>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}

function ManageFloat() {
  return <span className="st-float st-float-toast" style={vars({ '--d': 3 })}>
    <span className="st-toast-ico"><Bell /></span>
    <span><b>New order received</b><small>#1043 · Priya S. · ₹1,948</small></span>
  </span>;
}

/* ====================================================================== */
/*  3 · GROW                                                              */
/* ====================================================================== */

const LINE = 'M0 78C16 76 26 66 44 68S72 52 92 50 126 54 148 38 188 34 212 22 262 14 300 6';

function GrowScene(_props: { active: boolean }) {
  const id = useId().replace(/:/g, '');
  return <div className="st-win st-grow">
    <BrowserBar url="storva.app/analytics" />
    <div className="st-grow-body">
      <div className="st-panel st-chart st-rise" style={k(0)}>
        <div className="st-panel-head"><b>Revenue</b><span className="st-pill">Last 30 days</span></div>
        <div className="st-chart-main"><strong>₹84,320</strong><span className="st-delta"><TrendingUp />18.2%</span></div>
        <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="st-spark" aria-hidden="true">
          <defs><linearGradient id={`${id}a`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#267A52" stopOpacity=".3" /><stop offset="1" stopColor="#267A52" stopOpacity="0" /></linearGradient></defs>
          {[22, 44, 66].map(y => <path key={y} d={`M0 ${y}H300`} stroke="rgba(15,36,25,.07)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
          <path className="st-area" d={`${LINE}V90H0Z`} fill={`url(#${id}a)`} />
          <path className="st-draw" d={LINE} pathLength={1} fill="none" stroke="#267A52" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="st-axis"><span>Wk 1</span><span>Wk 2</span><span>Wk 3</span><span>Wk 4</span></div>
      </div>
      <div className="st-tiles st-rise" style={k(1)}>
        <div><small>Orders</small><b>126</b></div>
        <div><small>Visitors</small><b>2,840</b></div>
        <div><small>Repeat customers</small><b>31</b></div>
      </div>
      <div className="st-grow-cols">
        <div className="st-panel st-rise" style={k(2)}>
          <div className="st-panel-head"><b>Top products</b></div>
          {[['Sage Steel Bottle', 86], ['Soy Wax Candle', 58], ['Linen Tote Bag', 37]].map(([n, w], i) => <div className="st-bar-row" key={n}>
            <span>{n}</span><i><u className="st-grow-bar" style={vars({ '--w': `${w}%`, '--b': i })} /></i>
          </div>)}
        </div>
        <div className="st-panel st-rise" style={k(3)}>
          <div className="st-panel-head"><b>Growth tools</b></div>
          <div className="st-tool"><span><Link2 /></span><b>Share store link</b><em><Copy />Copy</em></div>
          <div className="st-tool"><span><QrCode /></span><b>Store QR code</b><em>Open</em></div>
          <div className="st-tool"><span><MessageCircle /></span><b>WhatsApp updates</b><em className="on">On</em></div>
        </div>
      </div>
    </div>
  </div>;
}

function GrowFloat() {
  return <span className="st-float st-float-win" style={vars({ '--d': 3 })}>
    <span className="st-toast-ico"><Award /></span>
    <span><b>100 orders reached</b><small>Your store is growing</small></span>
  </span>;
}

/* ====================================================================== */
/*  Story section                                                         */
/* ====================================================================== */

const CHAPTERS = [
  { key: 'create', label: 'Create', icon: Store, title: 'Open your store in minutes.', text: 'Choose a store name, pick your colors and fonts, and watch your storefront take shape. No code and no designer needed.', points: ['Pick your store name and link', 'Choose colors, fonts and layout', 'Preview it before you go live'], Scene: CreateScene, Float: CreateFloat },
  { key: 'manage', label: 'Manage', icon: LayoutDashboard, title: 'Run everything from one dashboard.', text: 'Add products, keep stock up to date and follow every order from first click to delivery, from your phone or your computer.', points: ['Products, prices and stock', 'Orders from pending to delivered', 'Customers and store settings'], Scene: ManageScene, Float: ManageFloat },
  { key: 'grow', label: 'Grow', icon: ChartNoAxesCombined, title: 'See what works. Do more of it.', text: 'Understand your sales with business analytics, then bring in more customers with sharing tools built for your store.', points: ['Revenue, orders and visitors at a glance', 'Share your link and QR code', 'Stay in touch through WhatsApp'], Scene: GrowScene, Float: GrowFloat },
] as const;

export function StoryScroll() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useReveal(sectionRef);
  // 0 → 1 while the chapters scroll past; drives the thin progress bar under the sticky stage
  useScrollLink(layoutRef, (r, vh) => {
    sectionRef.current?.style.setProperty('--sp', clamp01((vh * 0.5 - r.top) / Math.max(r.height, 1)).toFixed(3));
  });

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    // a thin band across the middle of the viewport decides which chapter is "current"
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number((e.target as HTMLElement).dataset.i);
        if (!Number.isNaN(i)) setActive(i);
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    refs.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (i: number) => refs.current[i]?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

  return <section ref={sectionRef} id="story" className="st-section lp-anchor" aria-labelledby="story-title">
    <div className="st-bg" aria-hidden="true" />
    <div className="site-width">
      <header className="st-head" data-rv>
        <span className="st-label rv-item" style={rv(0)}><span className="st-pulse" aria-hidden="true" />THE STORVA WAY</span>
        <h2 id="story-title" className="rv-item" style={rv(1)}>From first idea to a <span className="st-hl">growing business</span>.</h2>
        <p className="rv-item" style={rv(2)}>Three simple stages. One simple platform.</p>
      </header>

      <div className="st-layout" ref={layoutRef}>
        <ol className="st-chapters">
          {CHAPTERS.map(({ key, label, icon: Icon, title, text, points, Scene, Float }, i) => <li key={key} ref={el => { refs.current[i] = el; }} data-i={i} data-rv className={i === active ? 'st-chapter is-active' : 'st-chapter'}>
            <div className="st-copy">
              <div className="st-kicker rv-item" style={rv(0)}><span className="st-num">0{i + 1}</span><span className="st-tag"><Icon />{label.toUpperCase()}</span></div>
              <h3 className="rv-item" style={rv(1)}>{title}</h3>
              <p className="rv-item" style={rv(2)}>{text}</p>
              <ul className="rv-item" style={rv(3)}>{points.map(t => <li key={t}><span><Check strokeWidth={3} /></span>{t}</li>)}</ul>
            </div>
            {/* small screens: each chapter carries its own scene, which plays when the chapter scrolls into view */}
            <div className="st-inline" aria-hidden="true">
              <div className="st-panelbg"><div className={i === active ? 'st-scene is-active' : 'st-scene'}><div className="st-frame"><Scene active={i === active} /><Float /></div></div></div>
            </div>
          </li>)}
        </ol>

        {/* large screens: one sticky stage that swaps scenes */}
        <div className="st-sticky" aria-hidden="true">
          <div className="st-stage">
            <div className="st-tabs" role="presentation">
              {CHAPTERS.map(({ key, label }, i) => <button key={key} type="button" tabIndex={-1} className={i === active ? 'on' : i < active ? 'done' : ''} onClick={() => jump(i)}><span>0{i + 1}</span>{label}</button>)}
            </div>
            <div className="st-panelbg">
              <div className="st-stack">
                {CHAPTERS.map(({ key, Scene, Float }, i) => <div key={key} className={i === active ? 'st-scene is-active' : 'st-scene'}><div className="st-frame"><Scene active={i === active} /><Float /></div></div>)}
              </div>
            </div>
            <div className="st-progress"><i /></div>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

/* ====================================================================== */
/*  How it works                                                          */
/* ====================================================================== */

function VisAccount() {
  return <div className="hv hv-account">
    <div className="hv-card">
      <div className="hv-line hv-rise" style={k(0)}><Mail /><span>you@business.com</span></div>
      <div className="hv-line hv-rise" style={k(1)}><Lock /><span className="hv-dots">••••••••</span></div>
      <span className="hv-btn hv-rise" style={k(2)}><UserPlus />Create account</span>
    </div>
    <span className="hv-float hv-pop" style={vars({ '--d': 3 })}><Check strokeWidth={3} />Account created</span>
  </div>;
}

function VisStore() {
  return <div className="hv hv-store">
    <div className="hv-card">
      <div className="hv-field hv-rise" style={k(0)}><small>Store name</small><b>Olive &amp; Oak</b></div>
      <div className="hv-field hv-rise" style={k(1)}><small>Business type</small><div className="hv-chips"><span className="on">Home &amp; living</span><span>Fashion</span></div></div>
      <div className="hv-toggle hv-rise" style={k(2)}><span>Order alerts</span><i className="on"><u /></i></div>
    </div>
  </div>;
}

function VisProduct() {
  return <div className="hv hv-product">
    <div className="hv-card hv-prod-card">
      <span className="hv-photo hv-rise" style={k(0)}><Bottle /><em><Upload />Added</em></span>
      <div className="hv-prod-fields">
        <div className="hv-field hv-rise" style={k(1)}><small>Name</small><b>Sage Steel Bottle</b></div>
        <div className="hv-two hv-rise" style={k(2)}>
          <div className="hv-field"><small>Price</small><b>₹1,299</b></div>
          <div className="hv-field"><small>Stock</small><b>24</b></div>
        </div>
      </div>
    </div>
  </div>;
}

function VisLaunch() {
  return <div className="hv hv-launch">
    <div className="hv-site">
      <div className="st-bar"><i /><i /><i /><span className="st-url"><Lock />oliveandoak.storva.app<Copy className="hv-copy" /></span></div>
      <div className="hv-site-body">
        <div className="hv-banner hv-rise" style={k(0)}><b /><u /></div>
        <div className="hv-tiles hv-rise" style={k(1)}><span className="st-tone-a"><Bottle /></span><span className="st-tone-b"><Glyph n={1} /></span><span className="st-tone-c"><Glyph n={2} /></span></div>
      </div>
    </div>
    <span className="hv-float hv-live hv-pop" style={vars({ '--d': 4 })}><i />Store is live</span>
  </div>;
}

const STEPS = [
  { title: 'Create Your Account', text: 'Sign up and get started.', Vis: VisAccount },
  { title: 'Set Up Your Store', text: 'Add business details, store name and preferences.', Vis: VisStore },
  { title: 'Add Your Products', text: 'Upload product images, add names, descriptions, prices and stock.', Vis: VisProduct },
  { title: 'Launch Your Online Store', text: 'Customize your storefront and share your store link.', Vis: VisLaunch },
] as const;

export function HowItWorks({ headless = false }: { headless?: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const [armed, setArmed] = useState(false);
  const [lit, setLit] = useState(0); // how many steps the progress line has reached, 0–4

  useReveal(rootRef);
  useEffect(() => setArmed(true), []);

  // The line is measured from the step nodes themselves, so it fits the zig-zag layout on desktop and the single column on phones.
  useScrollLink(wrapRef, (r, vh) => {
    const wrap = wrapRef.current;
    const centers = nodes.current.flatMap(n => { if (!n) return []; const b = n.getBoundingClientRect(); return [b.top + b.height / 2]; });
    if (!wrap || centers.length < 2) return;
    const first = centers[0]!;
    const last = centers[centers.length - 1]!;
    const anchor = vh * 0.6; // progress is measured against a line 60% of the way down the screen
    wrap.style.setProperty('--ty', `${(first - r.top).toFixed(1)}px`);
    wrap.style.setProperty('--th', `${Math.max(0, last - first).toFixed(1)}px`);
    wrap.style.setProperty('--fill', clamp01((anchor - first) / Math.max(last - first, 1)).toFixed(3));
    const next = centers.filter(y => y <= anchor).length;
    setLit(prev => (prev === next ? prev : next));
  });

  const list = <div ref={wrapRef} className="hiw-wrap">
    <div className="hiw-track" aria-hidden="true"><span className="hiw-fill" /></div>
    <ol className="hiw-list">
      {STEPS.map(({ title, text, Vis }, i) => <li key={title} data-rv className={i < lit || !armed ? 'hiw-step is-on' : 'hiw-step'}>
        <span ref={el => { nodes.current[i] = el; }} className="hiw-node" aria-hidden="true">0{i + 1}</span>
        <div className="hiw-copy">
          <span className="hiw-tag rv-item" style={rv(1)}>STEP 0{i + 1}</span>
          <h3 className="rv-item" style={rv(2)}>{title}</h3>
          <p className="rv-item" style={rv(3)}>{text}</p>
        </div>
        <div className="hiw-vis-wrap rv-item" style={rv(2)}>
          <div className="hiw-vis" aria-hidden="true"><Vis /></div>
        </div>
      </li>)}
    </ol>
  </div>;

  if (headless) return <div ref={el => { rootRef.current = el; }} className="hiw-headless">{list}</div>;
  return <section ref={rootRef} id="how-it-works" className="hiw-section lp-anchor" aria-labelledby="hiw-title">
    <div className="st-bg" aria-hidden="true" />
    <div className="site-width">
      <header className="st-head st-head-center" data-rv>
        <span className="st-label rv-item" style={rv(0)}><span className="st-pulse" aria-hidden="true" />HOW IT WORKS</span>
        <h2 id="hiw-title" className="rv-item" style={rv(1)}>From setup to success in <span className="st-hl">four simple steps</span>.</h2>
        <p className="rv-item" style={rv(2)}>Everything you need to take your business online, without the complexity.</p>
      </header>
      {list}
      <div className="hiw-cta"><Button asChild size="lg" className="st-btn-primary"><Link to="/login">Start for Free <ArrowRight /></Link></Button></div>
    </div>
  </section>;
}
