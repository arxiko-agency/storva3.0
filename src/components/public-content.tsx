import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, MessageCircle, Sparkles, Zap, Palette, Package, CreditCard, Users, ChartNoAxesCombined, Plus, TriangleAlert, RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { features, steps } from '@/lib/storva';
import { PublicShell } from './public-shell';
import { HowItWorks } from './story-flow';
import { supabase } from '@/integrations/supabase/client';
import { FEATURE_LABELS, formatINR, formatLimit, formatStorage, type Feature } from '@/lib/plan-rules';
import { normalizePlans, PLAN_COLUMNS, withTimeout, yearlySavingPercent, type PublicPlan } from '@/lib/public-plans';
import { getPublicPlans } from '@/lib/plans.functions';
import { Reveal } from './scroll-reveal';

/**
 * Plans come from the same `plans` table that drives limits and billing, so prices and limits shown here are always the real ones.
 * Loading tries the server first (works even if the browser cannot reach the database), then falls back to the browser client.
 * If both fail nothing is invented: the section shows an error with a Retry button.
 */
async function loadPlans(): Promise<PublicPlan[]> {
  try {
    return await withTimeout(getPublicPlans(), 10000);
  } catch {
    /* fall through to the browser client */
  }
  const { data, error } = await withTimeout(Promise.resolve(supabase.from('plans').select(PLAN_COLUMNS).order('sort')), 10000);
  if (error) throw error;
  return normalizePlans(data);
}
const publicPlansQuery = queryOptions({ queryKey: ['public-plans'], queryFn: loadPlans, retry: 1, retryDelay: 700, staleTime: 60_000 });

function PricingSkeleton() {
  return <div className="px-grid" aria-busy="true" aria-label="Loading plans">{[0, 1, 2].map(i => <div className="px-card px-skel" key={i} aria-hidden="true"><i className="w40" /><i className="w60 big" /><i className="w100 box" /><i className="w100 btn" /><i className="w80" /><i className="w70" /><i className="w80" /></div>)}</div>;
}

function PricingError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return <div className="px-error" role="alert">
    <span className="px-error-icon"><TriangleAlert /></span>
    <h3>We couldn’t load our plans right now.</h3>
    <p>Please check your connection and try again. Prices are only shown once they load, so you always see the real ones.</p>
    <Button type="button" size="lg" className="px-retry" onClick={onRetry} disabled={retrying}><RefreshCw className={retrying ? 'is-spinning' : undefined} />{retrying ? 'Retrying…' : 'Retry'}</Button>
  </div>;
}

export function PricingPlans({ yearly, setYearly }: { yearly: boolean; setYearly: (v: boolean) => void }) {
  const { data, isFetching, refetch } = useQuery(publicPlansQuery);
  const plans = data?.slice(0, 3);
  if (!plans) {
    // Without data this is either still loading (first attempt + one retry) or failed: never a blank section.
    return isFetching ? <PricingSkeleton /> : <PricingError retrying={false} onRetry={() => { void refetch(); }} />;
  }
  const bestSaving = Math.max(0, ...plans.map(yearlySavingPercent));
  return <>
    <div className="px-switch" role="group" aria-label="Billing interval" data-yearly={yearly ? 'true' : 'false'}>
      <span className="px-thumb" aria-hidden="true" />
      <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
      <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Yearly{bestSaving > 0 && <em>Save up to {bestSaving}%</em>}</button>
    </div>
    <div className="px-grid">{plans.map((p, i) => {
      const free = p.price_monthly === 0;
      const price = yearly ? p.price_yearly : p.price_monthly;
      const saving = yearly ? yearlySavingPercent(p) : 0;
      const known = p.features.filter((f): f is Feature => f in FEATURE_LABELS);
      return <Reveal as="article" delay={i} className={free ? 'px-card is-free' : 'px-card'} key={p.id}>
        {free && <span className="px-flag">Best place to start</span>}
        <h3>{p.name}</h3>
        <div className="px-price" key={yearly ? 'y' : 'm'}>
          <strong>{free ? '₹0' : formatINR(price)}</strong>{!free && <span>{yearly ? 'per year' : 'per month'}</span>}
          {saving > 0 && <em className="px-save">Save {saving}%</em>}
        </div>
        <p className="px-sub">{free ? 'Start for free, upgrade when you grow.' : yearly ? `About ${formatINR(Math.round(p.price_yearly / 12))} a month, billed yearly.` : 'Billed monthly. Cancel anytime from your dashboard.'}</p>
        {!free && p.trial_days > 0 && <p className="px-trial"><Clock />{p.trial_days}-day free trial</p>}
        <div className="px-limit"><Package /><span>{free ? <>Start your online store free with up to <b>{formatLimit(p.product_limit)} products</b></> : <>Up to <b>{formatLimit(p.product_limit)} products</b></>}</span></div>
        <Button asChild size="lg" variant={free ? 'default' : 'outline'} className="px-cta">{free ? <Link to="/login">Start for Free <ArrowRight /></Link> : <Link to="/login" search={{ redirect: '/billing' }}>Choose Plan <ArrowRight /></Link>}</Button>
        <ul>
          <li><Check />{formatLimit(p.order_limit)} orders / month</li>
          <li><Check />{formatStorage(p.storage_mb)} storage</li>
          <li><Check />{p.ai_limit.toLocaleString('en-IN')} AI requests / month</li>
          {known.map(f => <li key={f}><Check />{FEATURE_LABELS[f]}</li>)}
        </ul>
      </Reveal>;
    })}</div>
    <p className="px-note">Prices in Indian rupees. Plans, prices and limits are shown exactly as set in your STORVA account.</p>
  </>;
}

const icons = [MessageCircle, Sparkles, Zap, Palette, Package, CreditCard, Users, ChartNoAxesCombined];
export function FeatureGrid({ compact = false }: { compact?: boolean }) {
  return <div className="feature-grid">{features.slice(0, compact ? 4 : 8).map(([title, text], i) => { const Icon = icons[i] ?? Package; return <article className="feature-item" key={title}><span className={`feature-icon tone-${i % 4}`}><Icon /></span><h3>{title}</h3><p>{text}</p><span className="feature-number">0{i + 1}</span></article>; })}</div>;
}
export const faqs = [['Do I need coding or design skills?', 'No. Pick a theme and change colors, fonts and content in the visual store designer.'], ['What payment options can I offer?', 'The supplied store supports online payments through Razorpay. Gateway activation and transaction charges are set by Razorpay.'], ['Can I use my own domain?', 'Custom domains are not available yet. Every store gets its own STORVA link that you can share with customers.'], ['Can I manage my store on my phone?', 'Yes. The store and management pages are designed for mobile, tablet and desktop.'], ['Which languages does the WhatsApp assistant support?', 'English, Malayalam, Tamil, Hindi, Kannada, Telugu, Arabic, Bengali and Urdu. Availability may vary by message type and official WhatsApp template availability.'], ['Who is STORVA for?', 'Creators, beginners and small brands who want to sell online without the complexity of traditional platforms.']];
export function FaqList() {
  const [open, setOpen] = useState<number | null>(0);
  const uid = useId();
  return <div className="fq-list">{faqs.map(([q, a], i) => {
    const isOpen = open === i;
    const base = `${uid}-${i}`;
    return <Reveal key={q} delay={i} className="fq-item">
      <div data-open={isOpen ? 'true' : 'false'}>
        <h3><button type="button" id={`${base}-q`} className="fq-q" aria-expanded={isOpen} aria-controls={`${base}-a`} onClick={() => setOpen(isOpen ? null : i)}><span>{q}</span><span className="fq-icon" aria-hidden="true"><Plus /></span></button></h3>
        <div id={`${base}-a`} role="region" aria-labelledby={`${base}-q`} className="fq-panel"><div><p>{a}</p></div></div>
      </div>
    </Reveal>;
  })}</div>;
}
export function StartBand() {
  return <section className="start-band"><div className="site-width"><span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>Ready to open your store?</h2><p>Start on the free plan. Upgrade only when you grow.</p><Button asChild variant="secondary" size="lg"><Link to="/login">Create my store <ArrowRight /></Link></Button></div></section>;
}
export function PublicContent({ page }: { page: 'about' | 'services' | 'how-it-works' | 'pricing' | 'faq' }) {
  const [yearly, setYearly] = useState(false);
  const titles = { about: ['ABOUT STORVA', 'Small businesses deserve a big stage.', 'A simpler way to get your products online. Built for beginners, creators and small businesses.'], services: ['EVERYTHING, TOGETHER', 'Less busywork. More business.', 'From your first product to your next order, keep everything in one place.'], 'how-it-works': ['HOW IT WORKS', 'Your store in four steps.', 'A little setup. A lot of possibility.'], pricing: ['PRICING', 'Simple Plans. Powerful Possibilities.', 'Start for free and upgrade as your business grows.'], faq: ['A LITTLE CLARITY', 'Questions, Answered.', 'Everything you want to know before you start.'] };
  const [eyebrow, title, subtitle] = titles[page];
  return <PublicShell><main><section className="page-intro site-width"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></section><section className="site-width content-section">
    {page === 'services' && <FeatureGrid />}
    {page === 'about' && <><img className="about-image" src={steps[3]?.image} alt="Launching an online store with STORVA" /><div className="about-columns">{[['What it is', 'A simple store builder that helps you launch a clean, modern online store without code.'], ['Why it exists', 'Less complexity. More clarity. A few thoughtful templates and a straightforward path to launch.'], ['What you get', 'Your storefront, product catalog, orders and WhatsApp tools, all in one place.']].map(([h, p]) => <article key={h}><h2>{h}</h2><p>{p}</p></article>)}</div></>}
    {page === 'how-it-works' && <HowItWorks headless />}
    {page === 'pricing' && <PricingPlans yearly={yearly} setYearly={setYearly} />}
    {page === 'faq' && <FaqList />}
  </section><StartBand /></main></PublicShell>;
}
