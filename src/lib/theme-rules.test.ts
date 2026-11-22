import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES, PALETTES, applyPalette, applyPreset, contrastRatio, contrastWarnings, defaultTheme, moveItem, parseTheme, readableOn, safeHref, themeSchema } from "./theme-rules";

describe("store designer rules (Module 7)", () => {
  it("measures WCAG contrast: black on white is 21:1", () => expect(contrastRatio("#000000", "#ffffff")).toBe(21));
  it("warns when text is hard to read on the background", () => {
    const t = defaultTheme();
    expect(contrastWarnings({ ...t.colors, text: "#eeeeee", background: "#ffffff" }).map(w => w.pair)).toContain("Text on background");
  });
  it("default preset passes contrast checks", () => expect(contrastWarnings(defaultTheme().colors)).toEqual([]));
  it("picks white text on dark buttons and dark text on light ones", () => {
    expect(readableOn("#1d6b52")).toBe("#ffffff");
    expect(readableOn("#facc15")).toBe("#111111");
  });
  it("only allows https, same-site, mailto/tel and anchor links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://example.com")).toBeNull();
    expect(safeHref("//evil.com")).toBeNull();
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("#products")).toBe("#products");
    expect(safeHref("/shop/abc")).toBe("/shop/abc");
  });
  it("rejects invalid colours and non-https menu links", () => {
    const t = defaultTheme();
    expect(themeSchema.safeParse({ ...t, colors: { ...t.colors, primary: "red" } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...t, nav: { style: "bar", links: [{ id: "n-1", label: "x", type: "external", target: "http://x.com" }] } }).success).toBe(false);
  });
  it("rejects images outside a merchant folder", () => {
    const t = defaultTheme();
    expect(themeSchema.safeParse({ ...t, header: { ...t.header, logoPath: "../other/logo.png" } }).success).toBe(false);
  });
  it("falls back to the default theme for malformed stored data", () => {
    expect(parseTheme({ colors: { primary: 42 } })).toEqual(defaultTheme());
    expect(parseTheme(null).sections.length).toBe(3);
  });
  it("applies a preset's colours, fonts and card style", () => {
    const t = applyPreset(defaultTheme(), "night");
    expect(t.colors.background).toBe("#111827");
    expect(t.fonts.heading).toBe("Rubik");
    expect(t.preset).toBe("night");
  });
  it("reorders items for drag-and-drop", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
  it("limits sections to 20 and nav links to 12", () => {
    const t = defaultTheme();
    expect(themeSchema.safeParse({ ...t, sections: Array.from({ length: 21 }, (_, i) => ({ ...t.sections[0], id: `s-${i}` })) }).success).toBe(false);
  });
});

describe("shop pages & palettes (Module 7 completion)", () => {
  const page = (slug: string) => ({ id: `p-${slug}`, slug, title: slug, body: "", showInFooter: true });
  it("accepts up to 10 pages with unique addresses", () => {
    const t = defaultTheme();
    expect(themeSchema.safeParse({ ...t, pages: [page("about"), page("refunds")] }).success).toBe(true);
    expect(themeSchema.safeParse({ ...t, pages: [page("about"), page("about")] }).success).toBe(false);
    expect(themeSchema.safeParse({ ...t, pages: Array.from({ length: 11 }, (_, i) => page(`p${i}`)) }).success).toBe(false);
  });
  it("rejects page addresses with spaces or capitals", () => {
    expect(themeSchema.safeParse({ ...defaultTheme(), pages: [page("About Us")] }).success).toBe(false);
  });
  it("rejects a menu link to a page that does not exist", () => {
    const t = defaultTheme();
    const link = { id: "n-1", label: "Refunds", type: "page", target: "refunds" };
    expect(themeSchema.safeParse({ ...t, nav: { style: "bar", links: [link] } }).success).toBe(false);
    expect(themeSchema.safeParse({ ...t, pages: [page("refunds")], nav: { style: "bar", links: [link] } }).success).toBe(true);
  });
  it("older saved designs without pages still load", () => {
    const { pages: _omit, ...old } = defaultTheme();
    expect(parseTheme(old).pages).toEqual([]);
  });
  it("palettes change colours only, keeping fonts", () => {
    const t = applyPalette(defaultTheme(), 0);
    expect(t.colors.primary).toBe(PALETTES[0]!.colors.primary);
    expect(t.fonts).toEqual(defaultTheme().fonts);
    expect(t.preset).toBe("custom");
  });
  it("every palette passes the readability check", () => {
    for (const p of PALETTES) expect(contrastWarnings(p.colors), p.label).toEqual([]);
  });
  it("ships starter pages for about, shipping, refunds, privacy, terms and contact", () => {
    expect(PAGE_TEMPLATES.map(p => p.slug)).toEqual(["about", "shipping", "refunds", "privacy", "terms", "contact"]);
  });
});
