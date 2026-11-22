import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowRight, ArrowDown, Check, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PublicShell } from '@/components/public-shell';
import { HeroVisual } from '@/components/hero-visual';
import { FeaturesShowcase } from '@/components/features-showcase';
import { BusinessCategories } from '@/components/business-categories';
import { HowItWorks, StoryScroll } from '@/components/story-flow';
import { FaqList, PricingPlans } from '@/components/public-content';
import { Reveal } from '@/components/scroll-reveal';
import { pageHead } from '@/lib/storva';

export const Route = createFileRoute('/')({
  head: () => pageHead('Your Business Deserves a Better Online Store', 'Create your online store, manage your products and grow your business with STORVA.'),
  component: Home,
});

const svDelay = (d: number) => ({ ['--d' as string]: d });
function Word({ d, children }: { d: number; children: string }) {
  return <span className="sv-w" style={svDelay(d)}>{children}</span>;
}

function Home() {
  const [yearly, setYearly] = useState(false);
  return <PublicShell><main>
    <section className="sv-hero" aria-labelledby="hero-title">
      <div className="sv-hero-bg" aria-hidden="true" />
      <div className="site-width sv-hero-grid">
        <div className="sv-copy">
          <span className="sv-label sv-in" style={svDelay(0)}><span className="sv-pulse" aria-hidden="true" />ONLINE STORES FOR SMALL BUSINESSES</span>
          <h1 id="hero-title" className="sv-title">
            <Word d={2}>Your</Word>{' '}<Word d={3}>Business</Word>{' '}<Word d={4}>Deserves</Word>{' '}<Word d={5}>a</Word>{' '}
            <span className="sv-hl"><Word d={6}>Better</Word>{' '}<Word d={7}>Online</Word>{' '}<Word d={8}>Store</Word></span><Word d={9}>.</Word>
          </h1>
          <p className="sv-desc sv-in" style={svDelay(11)}>Create your online store, manage your products and grow your business with <strong>STORVA</strong>.</p>
          <div className="sv-actions sv-in" style={svDelay(12)}>
            <Button asChild size="lg" className="sv-btn sv-btn-primary"><Link to="/login">Start for Free <ArrowRight /></Link></Button>
            <Button asChild variant="outline" size="lg" className="sv-btn sv-btn-secondary"><Link to="/" hash="features">Explore Features <ArrowDown /></Link></Button>
          </div>
          <ul className="sv-trust sv-in" style={svDelay(13)}>
            {['No coding needed', 'Easy store management', 'Mobile friendly'].map(t => <li key={t}><span><Check strokeWidth={3} /></span>{t}</li>)}
          </ul>
        </div>
        <HeroVisual />
      </div>
    </section>

    <section className="site-width lp-intro">
      <span className="lp-intro-icon"><Store /></span>
      <span className="eyebrow">WHAT IS STORVA</span>
      <h2>One simple home for your online business.</h2>
      <p>STORVA is an online store builder made for small businesses. Launch a clean, modern storefront, manage your products and orders, and take your business online with confidence, all from your phone or computer.</p>
    </section>

    <StoryScroll />

    <FeaturesShowcase />

    <BusinessCategories />

    <HowItWorks />

    <section id="pricing" className="px-section lp-anchor" aria-labelledby="pricing-title"><div className="px-bg" aria-hidden="true" /><div className="site-width">
      <Reveal className="px-head"><span className="px-eyebrow">PRICING</span><h2 id="pricing-title">Simple Plans. Powerful Possibilities.</h2><p>Start for free and upgrade as your business grows.</p></Reveal>
      <PricingPlans yearly={yearly} setYearly={setYearly} />
    </div></section>

    <section id="faq" className="fq-section lp-anchor" aria-labelledby="faq-title"><div className="site-width">
      <Reveal className="px-head"><span className="px-eyebrow">FAQ</span><h2 id="faq-title">Questions, Answered.</h2><p>Everything you want to know before you start.</p></Reveal>
      <FaqList />
    </div></section>

    <section className="start-band"><div className="site-width"><span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>Ready to open your store?</h2><p>Start on the free plan. Upgrade only when you grow.</p><Button asChild variant="secondary" size="lg"><Link to="/login">Start for Free <ArrowRight /></Link></Button></div></section>
  </main></PublicShell>;
}
