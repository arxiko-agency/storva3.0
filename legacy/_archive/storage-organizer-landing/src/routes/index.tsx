import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BellRing,
  Camera,
  CheckCircle2,
  Package,
  ScanSearch,
  Sparkles,
  Star,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import heroImg from "@/assets/storva-hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "STORVA — Every box, item, and space, finally organized" },
      {
        name: "description",
        content:
          "STORVA is the smart storage organizer that catalogs what you own and where it lives, so you can find anything in seconds.",
      },
      { property: "og:title", content: "STORVA — Every box, item, and space, finally organized" },
      {
        property: "og:description",
        content:
          "Catalog what you own and where it lives. Find anything in seconds with STORVA, the smart storage organizer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: Camera,
    title: "Photo catalogs",
    description:
      "Snap a photo of each box or shelf. STORVA tags what's inside so your inventory builds itself.",
  },
  {
    icon: ScanSearch,
    title: "Instant search",
    description:
      "Type “winter jacket” and get the exact box, room, and shelf it's on — no more digging.",
  },
  {
    icon: BellRing,
    title: "Smart reminders",
    description:
      "Get nudged before warranties expire, seasons change, or borrowed items should come home.",
  },
  {
    icon: Users,
    title: "Shared spaces",
    description:
      "Invite family or roommates so everyone knows where things live — and where to put them back.",
  },
];

const steps = [
  {
    number: "01",
    title: "Snap",
    description: "Photograph a box, bin, or shelf and add it to a space in seconds.",
  },
  {
    number: "02",
    title: "Label",
    description: "STORVA suggests categories and items from your photos. Confirm and done.",
  },
  {
    number: "03",
    title: "Find",
    description: "Search anything you own and go straight to it. That's the whole trick.",
  },
];

const stats = [
  { value: "12k+", label: "homes organized" },
  { value: "240k", label: "items cataloged" },
  { value: "4.9", label: "average rating" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="#top" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Package className="size-4.5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">STORVA</span>
          </a>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#testimonials" className="transition-colors hover:text-foreground">
              Loved by
            </a>
          </nav>
          <Button className="rounded-full px-5">Get started</Button>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--color-accent),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 text-center md:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold text-accent-foreground">
            <Sparkles className="size-3.5 text-primary" />
            The smart way to organize your storage
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-bold tracking-tight text-balance md:text-6xl">
            Every box, item, and space —{" "}
            <span className="text-primary">finally organized.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
            STORVA catalogs what you own and exactly where it lives, so you can find anything in
            seconds instead of opening every box in the garage.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="rounded-full px-7">
              Start organizing
              <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-full px-7">
              See how it works
            </Button>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="flex text-primary">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-4 fill-current" />
              ))}
            </span>
            Loved by 12,000+ organized households
          </div>

          <div className="mt-14 rounded-2xl border border-border bg-card p-2 shadow-[0_24px_80px_-24px_color-mix(in_oklab,var(--color-primary)_35%,transparent)]">
            <img
              src={heroImg}
              alt="The STORVA dashboard showing organized storage boxes, categories, and recently added items"
              width={1600}
              height={1008}
              className="w-full rounded-xl"
            />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-border px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1 py-10">
              <span className="font-display text-4xl font-bold text-primary">{stat.value}</span>
              <span className="text-sm font-medium text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-balance md:text-4xl">
              Everything you need to know where everything is
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From the attic to the junk drawer, STORVA keeps a living map of your belongings.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-[0_16px_48px_-16px_color-mix(in_oklab,var(--color-primary)_30%,transparent)]"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-y border-border bg-secondary/50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-balance md:text-4xl">
              Organized in three simple steps
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              No spreadsheets, no label maker marathons. Just your phone and a few minutes.
            </p>
          </div>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="relative">
                <span className="font-display text-5xl font-bold text-primary/25">
                  {step.number}
                </span>
                <h3 className="mt-3 font-display text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section id="testimonials" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="flex justify-center gap-1 text-primary">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="size-5 fill-current" />
            ))}
          </span>
          <blockquote className="mt-6 font-display text-2xl font-semibold text-balance md:text-3xl">
            “We moved last spring and I found every single thing within a minute of looking. STORVA
            paid for itself before the boxes were even unpacked.”
          </blockquote>
          <p className="mt-6 text-sm font-semibold">Maya Lindqvist</p>
          <p className="text-sm text-muted-foreground">Homeowner, Gothenburg</p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-8 py-16 text-center text-ink-foreground md:py-20">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight text-balance md:text-4xl">
            Your future self will thank you
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-ink-foreground/70">
            Start your free catalog today. Ten minutes now saves hours of searching later.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="rounded-full px-7">
              Get started free
              <ArrowRight className="size-4" />
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-foreground/60">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-primary" /> Free for up to 3 spaces
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-primary" /> No credit card required
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
          <a href="#top" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Package className="size-4" />
            </span>
            <span className="font-display font-bold tracking-tight">STORVA</span>
          </a>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} STORVA. A place for everything.
          </p>
        </div>
      </footer>
    </div>
  );
}
