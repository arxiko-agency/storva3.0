import { z } from "zod";

/** Storefront theme: shared by the designer, the server and the public shop page. */
export const FONT_OPTIONS = [
  "DM Sans", "Space Grotesk", "Work Sans", "Rubik", "Nunito Sans", "Montserrat",
  "Playfair Display", "Lora", "Merriweather", "Cormorant Garamond", "Manjari", "Noto Sans Malayalam",
] as const;
export type FontName = (typeof FONT_OPTIONS)[number];

export const SECTION_TYPES = ["hero", "products", "categories", "banner", "text", "testimonials", "faq", "contact"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero banner", products: "Product grid", categories: "Categories", banner: "Promo banner",
  text: "Text block", testimonials: "Testimonials", faq: "FAQ", contact: "Contact",
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1d6b52");
const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const short = (max: number) => z.string().trim().max(max);
/** Storage path inside the merchant's own folder, or empty. */
const imagePath = z.union([z.literal(""), z.string().regex(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/)]);

/** Only https links, same-site paths, mailto/tel and in-page anchors are allowed. */
export function safeHref(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^#[a-z0-9-]{1,40}$/.test(v)) return v;
  if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(v)) return v;
  if (/^mailto:[^\s<>"]+$/.test(v) || /^tel:\+?[\d\s-]{6,20}$/.test(v)) return v;
  try { const u = new URL(v); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}
const href = short(300).refine(v => v === "" || safeHref(v) !== null, "Links must start with https://, / or #");

export const itemSchema = z.object({ id, title: short(120).default(""), body: short(600).default("") });
export const sectionSchema = z.object({
  id,
  type: z.enum(SECTION_TYPES),
  enabled: z.boolean().default(true),
  title: short(120).default(""),
  subtitle: short(240).default(""),
  body: short(2000).default(""),
  imagePath: imagePath.default(""),
  ctaLabel: short(40).default(""),
  ctaHref: href.default(""),
  category: short(80).default(""),
  limit: z.number().int().min(1).max(48).default(8),
  items: z.array(itemSchema).max(12).default([]),
});
export type ThemeSection = z.infer<typeof sectionSchema>;

export const navLinkSchema = z.object({
  id, label: short(40).min(1, "Give the link a label"),
  type: z.enum(["section", "category", "page", "external"]),
  target: short(300),
}).refine(l => l.type !== "external" || safeHref(l.target) !== null, { message: "External links must start with https://", path: ["target"] });

/** Extra shop pages (About, policies…), shown at /shop/<link>?page=<slug>. */
export const pageSlug = z.string().regex(/^[a-z0-9-]{1,40}$/, "Page address: lowercase letters, numbers and dashes");
export const pageSchema = z.object({
  id, slug: pageSlug,
  title: short(80).min(1, "Give the page a title"),
  body: short(10000).default(""),
  showInFooter: z.boolean().default(true),
});
export type ShopPage = z.infer<typeof pageSchema>;
export type NavLink = z.infer<typeof navLinkSchema>;

export const footerLinkSchema = z.object({ id, label: short(40).min(1), url: href });

export const themeSchema = z.object({
  version: z.literal(1).default(1),
  preset: short(40).default("classic"),
  colors: z.object({
    primary: hex.default("#1d6b52"), background: hex.default("#fbfaf6"), surface: hex.default("#ffffff"),
    text: hex.default("#1f2a24"), muted: hex.default("#5b6b62"), accent: hex.default("#e9b44c"),
  }).default({ primary: "#1d6b52", background: "#fbfaf6", surface: "#ffffff", text: "#1f2a24", muted: "#5b6b62", accent: "#e9b44c" }),
  fonts: z.object({ heading: z.enum(FONT_OPTIONS).default("Space Grotesk"), body: z.enum(FONT_OPTIONS).default("DM Sans") }).default({ heading: "Space Grotesk", body: "DM Sans" }),
  radius: z.enum(["none", "small", "large"]).default("small"),
  header: z.object({
    style: z.enum(["classic", "centered", "minimal"]).default("classic"),
    showLogo: z.boolean().default(false),
    logoPath: imagePath.default(""),
    sticky: z.boolean().default(true),
    showSearch: z.boolean().default(true),
    showCart: z.boolean().default(true),
    announcement: z.object({ enabled: z.boolean().default(false), text: short(140).default(""), href: href.default("") }).default({ enabled: false, text: "", href: "" }),
  }).default({ style: "classic", showLogo: false, logoPath: "", sticky: true, showSearch: true, showCart: true, announcement: { enabled: false, text: "", href: "" } }),
  nav: z.object({ style: z.enum(["bar", "menu"]).default("bar"), links: z.array(navLinkSchema).max(12).default([]) }).default({ style: "bar", links: [] }),
  sections: z.array(sectionSchema).max(20).default([]),
  grid: z.object({
    columnsDesktop: z.number().int().min(2).max(5).default(3),
    columnsMobile: z.number().int().min(1).max(2).default(1),
    cardStyle: z.enum(["bordered", "shadow", "flat"]).default("bordered"),
    imageShape: z.enum(["square", "portrait", "landscape"]).default("square"),
    imageFit: z.enum(["cover", "contain"]).default("cover"),
    showSaleBadge: z.boolean().default(true),
    titleLines: z.number().int().min(1).max(3).default(2),
    perPage: z.number().int().min(4).max(48).default(12),
  }).default({ columnsDesktop: 3, columnsMobile: 1, cardStyle: "bordered", imageShape: "square", imageFit: "cover", showSaleBadge: true, titleLines: 2, perPage: 12 }),
  footer: z.object({
    style: z.enum(["simple", "columns"]).default("columns"),
    about: short(400).default(""),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""),
    phone: short(20).default(""),
    address: short(300).default(""),
    socials: z.object({ instagram: href.default(""), facebook: href.default(""), x: href.default(""), youtube: href.default(""), whatsapp: short(15).regex(/^\d*$/).default("") })
      .default({ instagram: "", facebook: "", x: "", youtube: "", whatsapp: "" }),
    links: z.array(footerLinkSchema).max(12).default([]),
    copyright: short(120).default(""),
  }).default({ style: "columns", about: "", email: "", phone: "", address: "", socials: { instagram: "", facebook: "", x: "", youtube: "", whatsapp: "" }, links: [], copyright: "" }),
  pages: z.array(pageSchema).max(10).default([]),
}).superRefine((t, ctx) => {
  const seen = new Set<string>();
  t.pages.forEach((p, i) => { if (seen.has(p.slug)) ctx.addIssue({ code: "custom", message: `Two pages use the address "${p.slug}"`, path: ["pages", i, "slug"] }); seen.add(p.slug); });
  t.nav.links.forEach((l, i) => { if (l.type === "page" && !seen.has(l.target)) ctx.addIssue({ code: "custom", message: `Menu link "${l.label}" points to a page that does not exist`, path: ["nav", "links", i, "target"] }); });
});
export type Theme = z.infer<typeof themeSchema>;

export function newId(prefix = "s") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSections(): ThemeSection[] {
  return [
    sectionSchema.parse({ id: "hero", type: "hero", title: "Fresh picks, delivered to your door", subtitle: "Order online and pay cash on delivery.", ctaLabel: "Shop now", ctaHref: "#products" }),
    sectionSchema.parse({ id: "products", type: "products", title: "Our products", limit: 12 }),
    sectionSchema.parse({ id: "contact", type: "contact", title: "Questions? We're here to help" }),
  ];
}

export const PRESETS: Record<string, { label: string; colors: Theme["colors"]; fonts: Theme["fonts"]; radius: Theme["radius"]; cardStyle: Theme["grid"]["cardStyle"]; headerStyle: Theme["header"]["style"] }> = {
  classic: { label: "Kerala green", colors: { primary: "#1d6b52", background: "#fbfaf6", surface: "#ffffff", text: "#1f2a24", muted: "#5b6b62", accent: "#e9b44c" }, fonts: { heading: "Space Grotesk", body: "DM Sans" }, radius: "small", cardStyle: "bordered", headerStyle: "classic" },
  spice: { label: "Spice market", colors: { primary: "#9a3412", background: "#fff8f1", surface: "#ffffff", text: "#2b1a12", muted: "#7c5a48", accent: "#f59e0b" }, fonts: { heading: "Playfair Display", body: "Nunito Sans" }, radius: "large", cardStyle: "shadow", headerStyle: "centered" },
  monsoon: { label: "Monsoon blue", colors: { primary: "#1e40af", background: "#f5f8ff", surface: "#ffffff", text: "#0f172a", muted: "#475569", accent: "#06b6d4" }, fonts: { heading: "Montserrat", body: "Work Sans" }, radius: "small", cardStyle: "flat", headerStyle: "classic" },
  boutique: { label: "Boutique", colors: { primary: "#111111", background: "#faf7f2", surface: "#ffffff", text: "#111111", muted: "#6b6258", accent: "#b08d57" }, fonts: { heading: "Cormorant Garamond", body: "Lora" }, radius: "none", cardStyle: "flat", headerStyle: "minimal" },
  night: { label: "Night bazaar", colors: { primary: "#facc15", background: "#111827", surface: "#1f2937", text: "#f9fafb", muted: "#9ca3af", accent: "#fb7185" }, fonts: { heading: "Rubik", body: "DM Sans" }, radius: "large", cardStyle: "bordered", headerStyle: "classic" },
  malayalam: { label: "Malayalam", colors: { primary: "#7c2d12", background: "#fffbeb", surface: "#ffffff", text: "#1c1917", muted: "#57534e", accent: "#15803d" }, fonts: { heading: "Manjari", body: "Noto Sans Malayalam" }, radius: "small", cardStyle: "bordered", headerStyle: "centered" },
};

/** Colour-only palettes (presets also change fonts and layout). */
export const PALETTES: { label: string; colors: Theme["colors"] }[] = [
  { label: "Banana leaf", colors: { primary: "#2f6f3e", background: "#f6faf3", surface: "#ffffff", text: "#18261b", muted: "#55675a", accent: "#f2c14e" } },
  { label: "Kasavu", colors: { primary: "#8a6d1d", background: "#fffdf7", surface: "#ffffff", text: "#2a2414", muted: "#6b604a", accent: "#c9a227" } },
  { label: "Backwater", colors: { primary: "#0f766e", background: "#f0fdfa", surface: "#ffffff", text: "#102a27", muted: "#4b635f", accent: "#f97316" } },
  { label: "Turmeric", colors: { primary: "#b45309", background: "#fffbeb", surface: "#ffffff", text: "#292017", muted: "#6b5b45", accent: "#16a34a" } },
  { label: "Peacock", colors: { primary: "#155e75", background: "#f4fbfd", surface: "#ffffff", text: "#0c2530", muted: "#4a6470", accent: "#a21caf" } },
  { label: "Lotus", colors: { primary: "#be185d", background: "#fff7fa", surface: "#ffffff", text: "#2b1220", muted: "#6e5060", accent: "#0d9488" } },
  { label: "Charcoal", colors: { primary: "#f97316", background: "#18181b", surface: "#27272a", text: "#fafafa", muted: "#a1a1aa", accent: "#22d3ee" } },
  { label: "Paper", colors: { primary: "#262626", background: "#fafafa", surface: "#ffffff", text: "#171717", muted: "#525252", accent: "#dc2626" } },
];

/** Starter text for common shop pages. Merchants must review it; it is not legal advice. */
export const PAGE_TEMPLATES: { slug: string; title: string; body: string }[] = [
  { slug: "about", title: "About us", body: "Tell shoppers who you are, what you sell and why.\n\n[Your story here]" },
  { slug: "shipping", title: "Shipping policy", body: "We deliver across [states you deliver to].\n\nOrders are packed within [1–2] working days and usually arrive in [3–7] working days.\n\nDelivery charges are shown at checkout before you place the order.\n\nYou will receive your courier and tracking number once the order is shipped." },
  { slug: "refunds", title: "Returns & refund policy", body: "If an item arrives damaged or wrong, contact us within [2] days of delivery with a photo.\n\nWe will replace the item or refund the amount within [7] working days of approving the return.\n\n[Items that cannot be returned, e.g. food or opened items]" },
  { slug: "privacy", title: "Privacy policy", body: "We collect your name, phone number, email and delivery address only to deliver your order and contact you about it.\n\nWe do not sell your details. Couriers receive only what they need to deliver.\n\nTo see or delete your details, contact us at [email or phone]." },
  { slug: "terms", title: "Terms & conditions", body: "Prices are in Indian rupees and include or exclude GST as shown at checkout.\n\nPayment is cash on delivery unless stated otherwise.\n\nWe may cancel an order if an item is out of stock; you will not be charged.\n\n[Business name, address, GSTIN]" },
  { slug: "contact", title: "Contact us", body: "Phone: [number]\nEmail: [email]\nAddress: [address]\n\nWe reply within [one working day]." },
];

export function applyPalette(theme: Theme, index: number): Theme {
  const p = PALETTES[index];
  return p ? { ...theme, preset: "custom", colors: { ...p.colors } } : theme;
}

export function applyPreset(theme: Theme, key: string): Theme {
  const p = PRESETS[key];
  if (!p) return theme;
  return { ...theme, preset: key, colors: { ...p.colors }, fonts: { ...p.fonts }, radius: p.radius, grid: { ...theme.grid, cardStyle: p.cardStyle }, header: { ...theme.header, style: p.headerStyle } };
}

export function defaultTheme(): Theme {
  return { ...themeSchema.parse({}), sections: defaultSections() };
}

/** Reads any stored JSON as a valid theme; anything malformed falls back to defaults. */
export function parseTheme(value: unknown): Theme {
  if (!value || typeof value !== "object" || Object.keys(value as object).length === 0) return defaultTheme();
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultTheme();
}

/** Image paths referenced by a theme (logo + section images), for signing. */
export function themeImagePaths(theme: Theme): string[] {
  return [theme.header.logoPath, ...theme.sections.map(s => s.imagePath)].filter((p): p is string => !!p);
}

// ---------- colour contrast (WCAG 2.1) ----------
function channel(c: number) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
export function luminance(hexColor: string) {
  const n = parseInt(hexColor.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  const l1 = Math.max(la, lb), l2 = Math.min(la, lb);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}
/** Black or white, whichever reads better on the given colour. */
export function readableOn(hexColor: string) {
  return contrastRatio(hexColor, "#ffffff") >= contrastRatio(hexColor, "#111111") ? "#ffffff" : "#111111";
}
export type ContrastWarning = { pair: string; ratio: number };
/** Pairs below WCAG AA (4.5:1 for text, 3:1 for buttons/large text). */
export function contrastWarnings(colors: Theme["colors"]): ContrastWarning[] {
  const checks: [string, string, string, number][] = [
    ["Text on background", colors.text, colors.background, 4.5],
    ["Text on cards", colors.text, colors.surface, 4.5],
    ["Secondary text on background", colors.muted, colors.background, 4.5],
    ["Button colour on background", colors.primary, colors.background, 3],
  ];
  return checks.filter(([, a, b, min]) => contrastRatio(a, b) < min).map(([pair, a, b]) => ({ pair, ratio: contrastRatio(a, b) }));
}

export function googleFontsHref(fonts: Theme["fonts"]) {
  const families = [...new Set([fonts.heading, fonts.body])].map(f => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`);
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

/** Moves an item in a list (used by drag-and-drop and keyboard reordering). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}
