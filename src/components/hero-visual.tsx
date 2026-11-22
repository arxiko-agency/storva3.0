import type { CSSProperties } from 'react';
import { Check, Lock, Plus, Search, ShoppingBag, TrendingUp } from 'lucide-react';
import bottleImg from '@/assets/product-bottle.jpg';

/**
 * Decorative product preview for the landing hero: a sample storefront (what shoppers see),
 * the merchant dashboard (what the owner sees) and the live moments in between (order, cart).
 * Everything is sample content drawn in HTML/SVG, so it scales with the container and needs no network.
 */

type Css = Record<`--${string}`, string | number>;
const vars = (v: Css) => v as CSSProperties;

function Bottle() {
  return <img className="sv-photo" src={bottleImg} alt="" width={816} height={816} decoding="async" />;
}

function CandleArt() {
  return <svg className="sv-art" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="sv-jar" x1="0" x2="1"><stop offset="0" stopColor="#E9C58B" /><stop offset=".55" stopColor="#F4DDB2" /><stop offset="1" stopColor="#D9AE6E" /></linearGradient>
      <linearGradient id="sv-lid" x1="0" x2="1"><stop offset="0" stopColor="#6B5240" /><stop offset="1" stopColor="#4A3628" /></linearGradient>
    </defs>
    <ellipse cx="50" cy="90" rx="29" ry="4.5" fill="#6B4E2E" opacity=".16" />
    <path d="M50 11c5 7 7 11 0 17-7-6-5-10 0-17z" fill="#F2A93B" />
    <path d="M50 17c2 3 3 5 0 8-3-3-2-5 0-8z" fill="#FFE9A8" />
    <rect x="48.8" y="27" width="2.4" height="8" rx="1.2" fill="#2F2218" />
    <rect x="25" y="35" width="50" height="11" rx="4.5" fill="url(#sv-lid)" />
    <rect x="23" y="44" width="54" height="46" rx="11" fill="url(#sv-jar)" />
    <rect x="31" y="56" width="38" height="24" rx="4" fill="#FCF8EF" />
    <path d="M37 64h26M37 70h15" stroke="#267A52" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M29 52c-1 10-1 22 1 32" stroke="#fff" strokeOpacity=".45" strokeWidth="2.4" strokeLinecap="round" fill="none" />
  </svg>;
}

function ToteArt() {
  return <svg className="sv-art" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="sv-linen" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#EFE5D2" /><stop offset="1" stopColor="#DCCDB1" /></linearGradient>
    </defs>
    <ellipse cx="50" cy="91" rx="31" ry="4.5" fill="#3F5B48" opacity=".16" />
    <path d="M36 40c-2-24 28-24 28 0" fill="none" stroke="#C8B692" strokeWidth="3.4" strokeLinecap="round" />
    <path d="M23 38h54l4 51H19z" fill="url(#sv-linen)" />
    <path d="M23 38h54l1 9H22z" fill="#fff" opacity=".28" />
    <path d="M28 56h44M27 64h46M26 72h48M25 80h50" stroke="#B9A67F" strokeOpacity=".35" strokeWidth=".9" />
    <rect x="39" y="55" width="22" height="17" rx="3" fill="#267A52" />
    <path d="M44 61h12M44 66h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

const products = [
  { name: 'Sage Steel Bottle', price: '₹1,299', tone: 'sv-tone-a', art: <Bottle /> },
  { name: 'Soy Wax Candle', price: '₹649', tone: 'sv-tone-b', art: <CandleArt /> },
  { name: 'Linen Tote Bag', price: '₹899', tone: 'sv-tone-c', art: <ToteArt /> },
];

export function HeroVisual() {
  return <div className="sv-visual" role="img" aria-label="Preview of a STORVA online store with its dashboard, a new order and a shopping cart">
    <div className="sv-stage" aria-hidden="true">
      {/* decorative shapes */}
      <span className="sv-deco sv-blob" />
      <span className="sv-deco sv-ring" />
      <span className="sv-deco sv-dots" />

      {/* storefront, as customers see it */}
      <div className="sv-piece sv-browser-wrap" style={vars({ '--d': 1 })}>
        <div className="sv-float" style={vars({ '--fd': '11s', '--fo': '-3s', '--fa': 3 })}>
          <div className="sv-browser">
            <div className="sv-bar">
              <i /><i /><i />
              <span className="sv-url"><Lock />oliveandoak.storva.app</span>
            </div>
            <div className="sv-site">
              <div className="sv-snav">
                <strong className="sv-slogo"><span />Olive &amp; Oak</strong>
                <span className="sv-slinks"><b>Shop</b><b>Collections</b><b>About</b></span>
                <span className="sv-sicons"><Search /><span className="sv-bag"><ShoppingBag /><em>2</em></span></span>
              </div>
              <div className="sv-banner">
                <div>
                  <small>Autumn edit</small>
                  <strong>Slow-living essentials</strong>
                  <span className="sv-banner-btn">Shop collection</span>
                </div>
                <span className="sv-banner-orb sv-orb-1" /><span className="sv-banner-orb sv-orb-2" />
              </div>
              <div className="sv-sec-head">
                <strong>Bestsellers</strong>
                <span><b className="on">All</b><b>Home</b><b>Drinkware</b></span>
              </div>
              <div className="sv-grid">
                {products.map(p => <div className="sv-prod" key={p.name}>
                  <div className={`sv-prod-img ${p.tone}`}>{p.art}</div>
                  <div className="sv-prod-name">{p.name}</div>
                  <div className="sv-prod-row"><strong>{p.price}</strong><span className="sv-add"><Plus /></span></div>
                </div>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* new order notification */}
      <div className="sv-piece sv-order-wrap" style={vars({ '--d': 3 })}>
        <div className="sv-float" style={vars({ '--fd': '8s', '--fo': '-1s', '--fa': 6 })}>
          <div className="sv-card sv-order">
            <span className="sv-order-icon"><Check /></span>
            <div className="sv-order-text"><strong>New order received</strong><span>#1042 · Priya S. · 2 items</span></div>
            <div className="sv-order-amt"><strong>₹1,948</strong><span>Just now</span></div>
          </div>
        </div>
      </div>

      {/* owner dashboard */}
      <div className="sv-piece sv-stats-wrap" style={vars({ '--d': 4 })}>
        <div className="sv-float" style={vars({ '--fd': '9.5s', '--fo': '-5s', '--fa': 5 })}>
          <div className="sv-card sv-stats">
            <div className="sv-stats-head"><strong>Dashboard</strong><span>Today</span></div>
            <div className="sv-stats-label">Total sales</div>
            <div className="sv-stats-main"><strong>₹24,850</strong><span className="sv-delta"><TrendingUp />18.2%</span></div>
            <svg className="sv-spark" viewBox="0 0 200 56" preserveAspectRatio="none">
              <defs><linearGradient id="sv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#267A52" stopOpacity=".28" /><stop offset="1" stopColor="#267A52" stopOpacity="0" /></linearGradient></defs>
              <path d="M0 44C14 42 22 36 36 38S60 28 74 25 102 27 118 18 150 14 168 10 192 6 200 4V56H0Z" fill="url(#sv-area)" />
              <path d="M0 44C14 42 22 36 36 38S60 28 74 25 102 27 118 18 150 14 168 10 192 6 200 4" fill="none" stroke="#267A52" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <circle cx="200" cy="4" r="3.2" fill="#267A52" />
            </svg>
            <div className="sv-stats-foot"><span><b>38</b> orders</span><span><b>3.4%</b> conversion</span></div>
          </div>
        </div>
      </div>

      {/* shopper's cart */}
      <div className="sv-piece sv-cart-wrap" style={vars({ '--d': 5 })}>
        <div className="sv-float" style={vars({ '--fd': '10s', '--fo': '-7s', '--fa': 5 })}>
          <div className="sv-card sv-cart">
            <div className="sv-cart-head"><strong>Your cart</strong><em>2</em></div>
            <div className="sv-cart-row"><span className="sv-thumb sv-tone-a"><Bottle /></span><div><b>Sage Steel Bottle</b><small>Qty 1</small></div><strong>₹1,299</strong></div>
            <div className="sv-cart-row"><span className="sv-thumb sv-tone-b"><CandleArt /></span><div><b>Soy Wax Candle</b><small>Qty 1</small></div><strong>₹649</strong></div>
            <div className="sv-cart-total"><span>Total</span><strong>₹1,948</strong></div>
            <span className="sv-checkout"><Lock />Checkout</span>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
