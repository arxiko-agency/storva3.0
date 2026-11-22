import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Compass, Layers, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atelier — A studio for thoughtful work" },
      {
        name: "description",
        content:
          "Atelier is a small studio crafting considered products, brands, and experiences. See our work, our approach, and start a project.",
      },
      { property: "og:title", content: "Atelier — A studio for thoughtful work" },
      {
        property: "og:description",
        content:
          "Atelier is a small studio crafting considered products, brands, and experiences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const services = [
  {
    icon: Compass,
    title: "Strategy",
    description:
      "We start with why. Research, positioning, and a clear plan before a single pixel is placed.",
  },
  {
    icon: Layers,
    title: "Design",
    description:
      "Interfaces and identities built on strong systems — beautiful on day one, maintainable on day one thousand.",
  },
  {
    icon: Sparkles,
    title: "Build",
    description:
      "We ship what we design. Fast, accessible, and measured against the goals we set together.",
  },
];

function Index() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-xl font-semibold tracking-tight">Atelier</span>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground sm:flex">
          <a href="#work" className="transition-colors hover:text-foreground">
            Work
          </a>
          <a href="#services" className="transition-colors hover:text-foreground">
            Services
          </a>
          <a href="#contact" className="transition-colors hover:text-foreground">
            Contact
          </a>
        </nav>
        <a
          href="#contact"
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Start a project
        </a>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Independent studio
        </p>
        <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
          Thoughtful work, made to last.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          We partner with founders and teams to design and build products people
          genuinely enjoy using — no noise, no shortcuts.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#work"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            See our work <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="#services"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
          >
            What we do
          </a>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="border-t border-border bg-secondary/50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            What we do
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Three disciplines, one team, end to end.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {services.map((service) => (
              <div
                key={service.title}
                className="rounded-2xl border border-border bg-card p-8 transition-shadow hover:shadow-lg"
              >
                <service.icon className="h-8 w-8 text-primary" />
                <h3 className="mt-5 font-display text-xl font-semibold">{service.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Work / highlight band */}
      <section id="work" className="mx-auto max-w-6xl px-6 py-24">
        <div className="rounded-3xl bg-primary px-8 py-16 text-center text-primary-foreground sm:px-16">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Selected work, coming soon.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-primary-foreground/80">
            We're preparing case studies from recent projects. Tell us about yours
            and it might be next.
          </p>
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Let's build something together.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Tell us where you're headed. We'll reply within two business days.
          </p>
          <a
            href="mailto:hello@example.com"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            hello@example.com <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span className="font-display font-semibold text-foreground">Atelier</span>
          <span>© {new Date().getFullYear()} Atelier Studio. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
