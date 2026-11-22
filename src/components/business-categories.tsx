import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Check, Clock, Heart, MessageCircle, ShoppingBag, Sparkles, Star, Truck } from 'lucide-react';

/**
 * Landing page "Made for Businesses Like Yours." (Part 4).
 * An editorial bento: five categories, each with its own composition, palette and store mockup.
 * Everything drawn is sample content in HTML/SVG, so it needs no network. Tokens (--sv-*) come from styles.css.
 * Reveal motion is armed by this component only when IntersectionObserver exists and motion is allowed;
 * without that, every card is simply visible.
 */

type Css = Record<`--${string}`, string | number>;
const vars = (v: Css) => v as CSSProperties;

/* ------------------------------ shared pieces ------------------------------ */

function Chrome({ url, children }: { url: string; children: ReactNode }) {
  return <div className="bc-browser" aria-hidden="true">
    <div className="bc-bar"><i /><i /><i /><span>{url}</span></div>
    {children}
  </div>;
}

function Price({ children }: { children: string }) { return <b className="bc-price">{children}</b>; }

/* ------------------------------ 1. Boutiques ------------------------------ */

function Dress({ c, c2, x }: { c: string; c2: string; x: number }) {
  return <g transform={`translate(${x} 0)`}>
    <path d="M30 8v10" stroke="#8A7A6A" strokeWidth="2" strokeLinecap="round" />
    <path d="M30 18c-6 0-14 4-16 9l8 5 2 52c4 4 20 4 24 0l2-52 8-5c-2-5-10-9-16-9z" fill={c} />
    <path d="M23 32c2 5 12 5 14 0" fill="none" stroke={c2} strokeWidth="2" strokeLinecap="round" />
    <path d="M24 56h12" stroke={c2} strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </g>;
}

function BoutiqueArt() {
  return <Chrome url="lumiere.storva.shop">
    <div className="bc-shop bc-boutique">
      <div className="bc-nav"><b>Lumière</b><span>New in</span><span>Dresses</span><span>Sale</span><ShoppingBag /></div>
      <div className="bc-boutique-body">
        <div className="bc-hero-tile">
          <small>AUTUMN EDIT</small>
          <strong>Soft tailoring for slow weekends</strong>
          <span className="bc-pill">Shop the collection</span>
          <svg viewBox="0 0 210 110" aria-hidden="true" className="bc-rack">
            <path d="M6 12h198" stroke="#8A7A6A" strokeWidth="3" strokeLinecap="round" />
            <Dress c="#E7B7B3" c2="#fff" x={4} />
            <Dress c="#F3DDB8" c2="#B07A44" x={52} />
            <Dress c="#C9D9C5" c2="#fff" x={100} />
            <Dress c="#8FA9C7" c2="#fff" x={148} />
          </svg>
        </div>
        <div className="bc-products">
          {[['Linen wrap dress', '₹2,490', '#E7B7B3'], ['Cotton shirt', '₹1,290', '#C9D9C5'], ['Silk scarf', '₹890', '#F3DDB8']].map(([n, p, c]) =>
            <div key={n} className="bc-prod"><span style={{ background: c }} /><em>{n}</em><Price>{p}</Price></div>)}
        </div>
      </div>
    </div>
  </Chrome>;
}

/* ------------------------------ 2. Bakeries ------------------------------ */

function BakeryArt() {
  return <div className="bc-bakeryart" aria-hidden="true">
    <div className="bc-fresh"><span><Sparkles /></span><div><b>Fresh out at 7 am</b>12 loaves left today</div></div>
    <div className="bc-phone">
    <div className="bc-notch" />
    <div className="bc-phone-screen bc-bakery">
      <div className="bc-phone-head"><b>Crumb &amp; Co.</b><span><Clock /> Order by 6 pm</span></div>
      <svg viewBox="0 0 200 110" className="bc-bread">
        <ellipse cx="100" cy="98" rx="86" ry="8" fill="#000" opacity=".07" />
        <path d="M24 88c-6-30 14-52 40-52s46 22 40 52z" fill="#E0A458" />
        <path d="M40 58c8-8 14 0 8 8M58 52c8-8 14 0 8 8M76 58c8-8 14 0 8 8" stroke="#B9782E" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M118 88c-4-22 8-38 28-38s34 16 28 38z" fill="#F0C27E" />
        <path d="M134 62l8 10M148 58l8 10" stroke="#C68A3E" strokeWidth="3" strokeLinecap="round" />
        <circle cx="30" cy="30" r="3" fill="#fff" opacity=".7" /><circle cx="176" cy="26" r="2" fill="#fff" opacity=".7" />
      </svg>
      {[['Sourdough loaf', '₹320'], ['Butter croissant', '₹140'], ['Cinnamon roll', '₹120'], ['Almond tea cake', '₹180'], ['Brown butter cookies', '₹90']].map(([n, p]) =>
        <div key={n} className="bc-line"><span>{n}</span><Price>{p}</Price><i>+</i></div>)}
      <div className="bc-cta">Pick up tomorrow · 8 am</div>
    </div>
    </div>
  </div>;
}

/* ------------------------------ 3. Handmade Sellers ------------------------------ */

function HandmadeArt() {
  return <div className="bc-craft" aria-hidden="true">
    <svg viewBox="0 0 240 150" className="bc-pots">
      <ellipse cx="120" cy="138" rx="108" ry="8" fill="#000" opacity=".08" />
      <path d="M44 136c-14-6-16-44-2-62 4-4 8-8 8-14h30c0 6 4 10 8 14 14 18 12 56-2 62z" fill="#D98E6A" />
      <path d="M44 92h62" stroke="#fff" strokeWidth="3" opacity=".55" strokeLinecap="round" /><path d="M48 106h54" stroke="#fff" strokeWidth="3" opacity=".35" strokeLinecap="round" />
      <path d="M118 136c-8-4-10-30-2-44 2-4 4-6 4-10h40c0 4 2 6 4 10 8 14 6 40-2 44z" fill="#7C9A8C" />
      <path d="M124 104l8-8 8 8 8-8 8 8" fill="none" stroke="#fff" strokeWidth="3" opacity=".7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M178 136c-6-3-6-22 0-32h30c6 10 6 29 0 32z" fill="#E9C46A" />
      <path d="M186 104c0-6 8-10 8-16M200 104c0-6 8-10 8-16" stroke="#9C6B3C" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
    <div className="bc-tag"><Heart /> Made by hand</div>
    <div className="bc-note"><Sparkles /><span><b>Only 3 left</b>Glazed this week</span></div>
  </div>;
}

/* ------------------------------ 4. Gift Shops ------------------------------ */

function GiftArt() {
  return <div className="bc-gifts" aria-hidden="true">
    <svg viewBox="0 0 220 150" className="bc-boxes">
      <ellipse cx="110" cy="140" rx="98" ry="7" fill="#000" opacity=".07" />
      <g><rect x="22" y="76" width="74" height="62" rx="8" fill="#E26D5C" /><rect x="14" y="62" width="90" height="20" rx="6" fill="#EE8878" />
        <rect x="52" y="62" width="14" height="76" fill="#FFE9B8" /><path d="M59 62c-12-18-30-12-22 0zM59 62c12-18 30-12 22 0z" fill="#FFE9B8" /></g>
      <g><rect x="108" y="92" width="62" height="46" rx="7" fill="#4C8C77" /><rect x="102" y="82" width="74" height="16" rx="5" fill="#6BAA94" />
        <rect x="132" y="82" width="12" height="56" fill="#fff" opacity=".85" /></g>
      <g><rect x="162" y="106" width="44" height="32" rx="6" fill="#F2B84B" /><rect x="158" y="98" width="52" height="12" rx="4" fill="#F7CC76" /><rect x="178" y="98" width="10" height="40" fill="#fff" opacity=".85" /></g>
      <path d="M170 26l4 9 9 4-9 4-4 9-4-9-9-4 9-4z" fill="#F2B84B" /><circle cx="30" cy="34" r="3.5" fill="#E26D5C" /><circle cx="196" cy="62" r="2.5" fill="#4C8C77" />
    </svg>
    <ul className="bc-occ">{['Birthdays', 'Weddings', 'Diwali', 'Thank you'].map(o => <li key={o}>{o}</li>)}</ul>
  </div>;
}

/* ------------------------------ 5. Home Businesses ------------------------------ */

function HomeArt() {
  return <div className="bc-home" aria-hidden="true">
    <div className="bc-phone bc-phone-sm">
      <div className="bc-notch" />
      <div className="bc-phone-screen bc-homeshop">
        <b>Amma’s Kitchen</b>
        <div className="bc-jars">{['#E9A23B', '#C8553D', '#7A9E5D'].map(c => <span key={c} style={{ background: c }} />)}</div>
        <div className="bc-line"><span>Mango pickle</span><Price>₹260</Price></div>
        <div className="bc-cta"><MessageCircle /> Order on WhatsApp</div>
      </div>
    </div>
    <div className="bc-order bc-order-a"><span><Check /></span><div><b>New order</b>2 × Mango pickle</div></div>
    <div className="bc-order bc-order-b"><span><Truck /></span><div><b>Shipped</b>Order #1042</div></div>
  </div>;
}

/* ------------------------------ section ------------------------------ */

const cats = [
  { id: 'boutiques', cls: 'bc-c1', n: '01', title: 'Boutiques', text: 'Show every collection beautifully, from new arrivals to the sale rail.', tags: ['Collections', 'Size options', 'Seasonal drops'], art: <BoutiqueArt /> },
  { id: 'bakeries', cls: 'bc-c2', n: '02', title: 'Bakeries', text: 'Take orders for fresh, daily bakes with a pickup time that suits you.', tags: ['Daily menu', 'Pre-orders'], art: <BakeryArt /> },
  { id: 'handmade', cls: 'bc-c3', n: '03', title: 'Handmade Sellers', text: 'Give your craft a home of its own, one piece at a time.', tags: ['Limited stock', 'Made to order'], art: <HandmadeArt /> },
  { id: 'gifts', cls: 'bc-c4', n: '04', title: 'Gift Shops', text: 'Make gifting simple for every occasion and every budget.', tags: ['Occasions', 'Bundles'], art: <GiftArt /> },
  { id: 'home', cls: 'bc-c5', n: '05', title: 'Home Businesses', text: 'Turn your kitchen table into a real store, run from your phone.', tags: ['WhatsApp orders', 'No setup fuss'], art: <HomeArt /> },
];

export function BusinessCategories() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.bc-card'));
    el.dataset.armed = 'true';
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.in = 'true'; io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    cards.forEach(c => io.observe(c));
    return () => { io.disconnect(); delete el.dataset.armed; };
  }, []);

  return <section ref={ref} className="bc-section" aria-labelledby="bc-title">
    <div className="bc-glow" aria-hidden="true" />
    <div className="site-width">
      <header className="bc-head">
        <span className="bc-eyebrow"><Star /> WHO CAN USE STORVA</span>
        <h2 id="bc-title">Made for <span>Businesses</span> Like Yours.</h2>
        <p>Whether you sell dresses, sourdough or handmade pottery, STORVA gives your business a store that looks the part.</p>
      </header>
      <div className="bc-grid">
        {cats.map((c, i) => <article key={c.id} className={`bc-card ${c.cls}`} style={vars({ '--i': i })}>
          <div className="bc-copy">
            <span className="bc-num">{c.n}</span>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <ul className="bc-tags">{c.tags.map(t => <li key={t}>{t}</li>)}</ul>
          </div>
          <div className="bc-art">{c.art}</div>
          <span className="bc-arrow" aria-hidden="true"><ArrowUpRight /></span>
        </article>)}
      </div>
    </div>
  </section>;
}
