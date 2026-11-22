import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Monitor, Tablet, Smartphone, Save, Rocket, ExternalLink, Plus, Trash2, Eye, EyeOff, History, RotateCcw, AlertTriangle, Upload, X, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StorefrontView, type SFProduct } from "@/components/storefront-view";
import { SortableList } from "@/components/sortable-list";
import { getThemeEditor, saveThemeDraft, publishTheme, restoreThemeVersion, deleteThemeVersion, signOwnImage } from "@/lib/theme.functions";
import { FONT_OPTIONS, PAGE_TEMPLATES, PALETTES, PRESETS, SECTION_LABELS, SECTION_TYPES, applyPalette, applyPreset, contrastWarnings, newId, sectionSchema, themeSchema, type Theme, type ThemeSection, type SectionType, type NavLink, type ShopPage } from "@/lib/theme-rules";
import { uploadImage } from "@/lib/upload-image";

type Device = "desktop" | "tablet" | "mobile";
const WIDTH: Record<Device, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };
type Editor = Awaited<ReturnType<typeof getThemeEditor>>;

const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>;
const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => <label className="flex items-center justify-between gap-3 text-sm"><span>{label}</span><Switch checked={checked} onCheckedChange={onChange} aria-label={label} /></label>;
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>{options.map(o => <Button key={String(o.value)} type="button" size="sm" role="radio" aria-checked={value === o.value} variant={value === o.value ? "default" : "outline"} onClick={() => onChange(o.value)}>{o.label}</Button>)}</div></div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <div className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><div className="flex items-center gap-2">
    <input type="color" aria-label={`${label} colour picker`} value={value} onChange={e => onChange(e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-border bg-transparent" />
    <Input aria-label={`${label} hex code`} value={text} maxLength={7} onChange={e => { const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`; setText(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase()); }} className="font-mono" />
  </div></div>;
}

function ImageField({ label, path, images, onChange, onSigned }: { label: string; path: string; images: Record<string, string>; onChange: (p: string) => void; onSigned: (p: string, url: string) => void }) {
  const sign = useServerFn(signOwnImage);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function pick(file?: File) {
    if (!file) return; setBusy(true);
    try { const p = await uploadImage(file); const { url } = await sign({ data: { path: p } }); if (url) onSigned(p, url); onChange(p); toast.success("Image uploaded."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><div className="flex items-center gap-2">
    {path && images[path] ? <img src={images[path]} alt="" className="size-14 rounded border border-border object-cover" /> : <div className="flex size-14 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">None</div>}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" aria-label={`Upload ${label}`} onChange={e => pick(e.target.files?.[0])} />
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="animate-spin" /> : <Upload />}Upload</Button>
    {path && <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}><X />Remove</Button>}
  </div></div>;
}

export function ThemeDesigner() {
  const load = useServerFn(getThemeEditor);
  const q = useQuery({ queryKey: ["theme-editor"], queryFn: () => load() });
  if (q.isPending) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;
  if (q.error || !q.data) return <div role="alert" className="mx-auto max-w-xl p-10 text-center"><p className="text-destructive">{q.error?.message ?? "Unavailable"}</p><Button className="mt-4" variant="outline" onClick={() => q.refetch()}><RefreshCw />Try again</Button></div>;
  return <DesignerBody data={q.data} />;
}

function DesignerBody({ data }: { data: Editor }) {
  const client = useQueryClient();
  const save = useServerFn(saveThemeDraft), publish = useServerFn(publishTheme), restore = useServerFn(restoreThemeVersion), remove = useServerFn(deleteThemeVersion);
  const [theme, setThemeState] = useState<Theme>(data.draft);
  const [images, setImages] = useState<Record<string, string>>(data.images);
  const [device, setDevice] = useState<Device>("desktop");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("look");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [busy, setBusy] = useState("");
  const [previewVersion, setPreviewVersion] = useState<Editor["versions"][number] | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  const setTheme = (fn: (t: Theme) => Theme) => { setThemeState(t => fn(t)); setDirty(true); };
  const warnings = useMemo(() => contrastWarnings(theme.colors), [theme.colors]);
  const products: SFProduct[] = data.products;
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter((c): c is string => !!c))], [products]);

  // Autosave the draft 1.5 s after the last change.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void saveDraft(true); }, 1500);
    return () => clearTimeout(t);
  }, [theme, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDraft(quiet = false) {
    const parsed = themeSchema.safeParse(theme);
    if (!parsed.success) { if (!quiet) toast.error(parsed.error.issues[0]?.message ?? "Check your design settings."); return false; }
    setSaving(true);
    try { const r = await save({ data: { theme: parsed.data } }); setDirty(false); setSavedAt(r.savedAt); if (!quiet) toast.success("Draft saved."); return true; }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); return false; }
    finally { setSaving(false); }
  }
  async function doPublish() {
    const parsed = themeSchema.safeParse(theme);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check your design settings."); return; }
    setBusy("publish");
    try { await publish({ data: { theme: parsed.data, name: versionName.trim() || `Published ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` } }); setDirty(false); setPublishOpen(false); setVersionName(""); toast.success("Your shop now shows this design."); await client.invalidateQueries({ queryKey: ["theme-editor"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not publish."); }
    finally { setBusy(""); }
  }
  async function doRestore(v: Editor["versions"][number], andPublish: boolean) {
    setBusy(`restore-${v.id}-${andPublish}`);
    try { await restore({ data: { id: v.id, publish: andPublish } }); setThemeState(v.config); setDirty(false); setPreviewVersion(null); toast.success(andPublish ? `Restored and published “${v.name}”.` : `“${v.name}” loaded into your draft.`); await client.invalidateQueries({ queryKey: ["theme-editor"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not restore."); }
    finally { setBusy(""); }
  }
  async function doDelete(v: Editor["versions"][number]) {
    setBusy(`delete-${v.id}`);
    try { await remove({ data: { id: v.id } }); if (previewVersion?.id === v.id) setPreviewVersion(null); await client.invalidateQueries({ queryKey: ["theme-editor"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete."); }
    finally { setBusy(""); }
  }

  function selectFromPreview(target: string) {
    setSelected(target);
    setTab(target === "header" ? "header" : target === "footer" ? "footer" : "sections");
  }
  const updateSection = (id: string, patch: Partial<ThemeSection>) => setTheme(t => ({ ...t, sections: t.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  function addSection(type: SectionType) {
    const s = sectionSchema.parse({ id: newId("s"), type, title: SECTION_LABELS[type] });
    setTheme(t => ({ ...t, sections: [...t.sections, s] })); setSelected(s.id);
  }
  const signed = (p: string, url: string) => setImages(m => ({ ...m, [p]: url }));
  const current = theme.sections.find(s => s.id === selected) ?? null;
  const shown = previewVersion ? previewVersion.config : theme;

  return <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-medium text-primary">STORE DESIGNER</p><h1 className="font-display text-3xl font-semibold">Design your shop</h1>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{saving ? "Saving draft…" : dirty ? "Unsaved changes" : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : data.unpublishedChanges ? "Draft has changes not yet published" : data.hasPublished ? `Live since ${new Date(data.publishedAt!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "Not published yet — your shop uses the default look"}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={saving || !dirty} onClick={() => saveDraft()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save draft</Button>
        <Button onClick={() => setPublishOpen(true)}><Rocket />Publish</Button>
        <Button variant="ghost" asChild><a href={`/shop/${data.store.store_slug}`} target="_blank" rel="noreferrer"><ExternalLink />View live shop</a></Button>
      </div>
    </div>

    <div className="mt-6 grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <aside className="order-2 lg:order-1">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1">
            {([["look", "Look"], ["header", "Header"], ["menu", "Menu"], ["sections", "Sections"], ["grid", "Products"], ["pages", "Pages"], ["footer", "Footer"], ["versions", "History"]] as const).map(([v, l]) => <TabsTrigger key={v} value={v} className="text-xs">{l}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="look" className="mt-4 grid gap-5">
            <div className="grid gap-2"><span className="text-sm font-medium">Presets</span><div className="grid grid-cols-2 gap-2">{Object.entries(PRESETS).map(([k, p]) => <button key={k} type="button" onClick={() => setTheme(t => applyPreset(t, k))} className={`rounded-md border p-2 text-left text-xs ${theme.preset === k ? "border-primary" : "border-border"}`} aria-pressed={theme.preset === k}><span className="mb-1.5 flex gap-1">{[p.colors.primary, p.colors.background, p.colors.accent, p.colors.text].map(c => <span key={c} className="size-4 rounded-full border border-border" style={{ background: c }} />)}</span>{p.label}</button>)}</div></div>
            <div className="grid gap-2"><span className="text-sm font-medium">Colour palettes</span><p className="text-xs text-muted-foreground">Changes colours only; your fonts and layout stay.</p><div className="grid grid-cols-2 gap-2">{PALETTES.map((p, i) => { const active = (Object.keys(p.colors) as (keyof Theme["colors"])[]).every(k => theme.colors[k] === p.colors[k]); return <button key={p.label} type="button" onClick={() => setTheme(t => applyPalette(t, i))} aria-pressed={active} className={`rounded-md border p-2 text-left text-xs ${active ? "border-primary" : "border-border"}`}><span className="mb-1.5 flex gap-1">{[p.colors.primary, p.colors.background, p.colors.accent, p.colors.text].map(c => <span key={c} className="size-4 rounded-full border border-border" style={{ background: c }} />)}</span>{p.label}</button>; })}</div></div>
            <div className="grid grid-cols-2 gap-3">
              {([["primary", "Buttons & links"], ["accent", "Highlights"], ["background", "Page background"], ["surface", "Cards & header"], ["text", "Text"], ["muted", "Secondary text"]] as const).map(([k, l]) => <ColorField key={k} label={l} value={theme.colors[k]} onChange={v => setTheme(t => ({ ...t, preset: "custom", colors: { ...t.colors, [k]: v } }))} />)}
            </div>
            {warnings.length > 0 && <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm"><p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="size-4" />Hard to read for some shoppers</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{warnings.map(w => <li key={w.pair}>{w.pair}: contrast {w.ratio}:1</li>)}</ul></div>}
            <Field label="Heading font"><select className="h-10 rounded-md border border-input bg-background px-3" value={theme.fonts.heading} onChange={e => setTheme(t => ({ ...t, fonts: { ...t.fonts, heading: e.target.value as Theme["fonts"]["heading"] } }))}>{FONT_OPTIONS.map(f => <option key={f}>{f}</option>)}</select></Field>
            <Field label="Body font"><select className="h-10 rounded-md border border-input bg-background px-3" value={theme.fonts.body} onChange={e => setTheme(t => ({ ...t, fonts: { ...t.fonts, body: e.target.value as Theme["fonts"]["body"] } }))}>{FONT_OPTIONS.map(f => <option key={f}>{f}</option>)}</select></Field>
            <Choice label="Corners" value={theme.radius} options={[{ value: "none", label: "Square" }, { value: "small", label: "Soft" }, { value: "large", label: "Round" }]} onChange={v => setTheme(t => ({ ...t, radius: v }))} />
          </TabsContent>

          <TabsContent value="header" className="mt-4 grid gap-4">
            <Choice label="Header layout" value={theme.header.style} options={[{ value: "classic", label: "Classic" }, { value: "centered", label: "Centered" }, { value: "minimal", label: "Minimal" }]} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, style: v } }))} />
            <Toggle label="Show logo" checked={theme.header.showLogo} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, showLogo: v } }))} />
            {theme.header.showLogo && <ImageField label="Logo" path={theme.header.logoPath} images={images} onSigned={signed} onChange={p => setTheme(t => ({ ...t, header: { ...t.header, logoPath: p } }))} />}
            <Toggle label="Stick to top while scrolling" checked={theme.header.sticky} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, sticky: v } }))} />
            <Toggle label="Search button" checked={theme.header.showSearch} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, showSearch: v } }))} />
            <Toggle label="Cart button" checked={theme.header.showCart} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, showCart: v } }))} />
            <Toggle label="Announcement bar" checked={theme.header.announcement.enabled} onChange={v => setTheme(t => ({ ...t, header: { ...t.header, announcement: { ...t.header.announcement, enabled: v } } }))} />
            {theme.header.announcement.enabled && <><Field label="Announcement text"><Input maxLength={140} value={theme.header.announcement.text} onChange={e => setTheme(t => ({ ...t, header: { ...t.header, announcement: { ...t.header.announcement, text: e.target.value } } }))} /></Field>
              <Field label="Announcement link (optional)" hint="https://…, /shop/… or #section"><Input maxLength={300} value={theme.header.announcement.href} onChange={e => setTheme(t => ({ ...t, header: { ...t.header, announcement: { ...t.header.announcement, href: e.target.value } } }))} /></Field></>}
          </TabsContent>

          <TabsContent value="menu" className="mt-4 grid gap-4">
            <Choice label="Menu style" value={theme.nav.style} options={[{ value: "bar", label: "Links bar" }, { value: "menu", label: "Menu button" }]} onChange={v => setTheme(t => ({ ...t, nav: { ...t.nav, style: v } }))} />
            <SortableList items={theme.nav.links} label={l => l.label || "link"} onChange={links => setTheme(t => ({ ...t, nav: { ...t.nav, links } }))} render={l => <NavLinkEditor link={l} sections={theme.sections} categories={categories} pages={theme.pages} onChange={patch => setTheme(t => ({ ...t, nav: { ...t.nav, links: t.nav.links.map(x => (x.id === l.id ? { ...x, ...patch } as NavLink : x)) } }))} onRemove={() => setTheme(t => ({ ...t, nav: { ...t.nav, links: t.nav.links.filter(x => x.id !== l.id) } }))} />} />
            <Button variant="outline" disabled={theme.nav.links.length >= 12} onClick={() => setTheme(t => ({ ...t, nav: { ...t.nav, links: [...t.nav.links, { id: newId("n"), label: "New link", type: "section", target: t.sections[0]?.id ?? "" }] } }))}><Plus />Add menu link</Button>
          </TabsContent>

          <TabsContent value="sections" className="mt-4 grid gap-4">
            <p className="text-xs text-muted-foreground">Drag to reorder. Click a section here or in the preview to edit it.</p>
            <SortableList items={theme.sections} label={s => SECTION_LABELS[s.type]} onChange={sections => setTheme(t => ({ ...t, sections }))} render={s => <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSelected(s.id)} className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm ${selected === s.id ? "bg-accent font-medium" : ""} ${s.enabled ? "" : "text-muted-foreground line-through"}`}>{s.title || SECTION_LABELS[s.type]}<span className="block text-xs text-muted-foreground no-underline">{SECTION_LABELS[s.type]}</span></button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={s.enabled ? `Hide ${s.title || SECTION_LABELS[s.type]}` : `Show ${s.title || SECTION_LABELS[s.type]}`} onClick={() => updateSection(s.id, { enabled: !s.enabled })}>{s.enabled ? <Eye /> : <EyeOff />}</Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Remove ${s.title || SECTION_LABELS[s.type]}`} onClick={() => { setTheme(t => ({ ...t, sections: t.sections.filter(x => x.id !== s.id), nav: { ...t.nav, links: t.nav.links.filter(l => !(l.type === "section" && l.target === s.id)) } })); if (selected === s.id) setSelected(null); }}><Trash2 /></Button>
            </div>} />
            <div className="flex flex-wrap gap-1">{SECTION_TYPES.map(type => <Button key={type} type="button" size="sm" variant="outline" disabled={theme.sections.length >= 20} onClick={() => addSection(type)}><Plus />{SECTION_LABELS[type]}</Button>)}</div>
            {current && <SectionEditor key={current.id} section={current} categories={categories} images={images} onSigned={signed} onChange={patch => updateSection(current.id, patch)} />}
          </TabsContent>

          <TabsContent value="grid" className="mt-4 grid gap-4">
            <Choice label="Columns on large screens" value={theme.grid.columnsDesktop} options={[2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, columnsDesktop: v } }))} />
            <Choice label="Columns on phones" value={theme.grid.columnsMobile} options={[1, 2].map(n => ({ value: n, label: String(n) }))} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, columnsMobile: v } }))} />
            <Choice label="Card style" value={theme.grid.cardStyle} options={[{ value: "bordered", label: "Outlined" }, { value: "shadow", label: "Shadow" }, { value: "flat", label: "Flat" }]} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, cardStyle: v } }))} />
            <Choice label="Image shape" value={theme.grid.imageShape} options={[{ value: "square", label: "Square" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, imageShape: v } }))} />
            <Choice label="Image fit" value={theme.grid.imageFit} options={[{ value: "cover", label: "Fill" }, { value: "contain", label: "Whole image" }]} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, imageFit: v } }))} />
            <Choice label="Title lines" value={theme.grid.titleLines} options={[1, 2, 3].map(n => ({ value: n, label: String(n) }))} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, titleLines: v } }))} />
            <Field label="Products per page"><Input type="number" min={4} max={48} value={theme.grid.perPage} onChange={e => setTheme(t => ({ ...t, grid: { ...t.grid, perPage: Math.max(4, Math.min(48, Number(e.target.value) || 12)) } }))} /></Field>
            <Toggle label="Show sale badge and old price" checked={theme.grid.showSaleBadge} onChange={v => setTheme(t => ({ ...t, grid: { ...t.grid, showSaleBadge: v } }))} />
          </TabsContent>

          <TabsContent value="pages" className="mt-4 grid gap-4">
            <p className="text-xs text-muted-foreground">Extra pages such as About us and your shipping, refund and privacy policies. Payment providers like Razorpay ask for these before approving a shop. Starter text is a guide, not legal advice — replace everything in [brackets].</p>
            <SortableList items={theme.pages} label={p => p.title} onChange={pages => setTheme(t => ({ ...t, pages }))} render={p => <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSelectedPage(p.id)} className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm ${selectedPage === p.id ? "bg-accent font-medium" : ""}`}>{p.title}<span className="block text-xs text-muted-foreground">?page={p.slug}{p.showInFooter ? " · in footer" : ""}</span></button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Preview ${p.title}`} onClick={() => setPreviewPage(previewPage === p.slug ? null : p.slug)}>{previewPage === p.slug ? <EyeOff /> : <Eye />}</Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Remove ${p.title}`} onClick={() => { setTheme(t => ({ ...t, pages: t.pages.filter(x => x.id !== p.id), nav: { ...t.nav, links: t.nav.links.filter(l => !(l.type === "page" && l.target === p.slug)) } })); if (selectedPage === p.id) setSelectedPage(null); if (previewPage === p.slug) setPreviewPage(null); }}><Trash2 /></Button>
            </div>} />
            <div className="flex flex-wrap gap-1">{PAGE_TEMPLATES.filter(tpl => !theme.pages.some(p => p.slug === tpl.slug)).map(tpl => <Button key={tpl.slug} type="button" size="sm" variant="outline" disabled={theme.pages.length >= 10} onClick={() => { const pg: ShopPage = { id: newId("p"), slug: tpl.slug, title: tpl.title, body: tpl.body, showInFooter: true }; setTheme(t => ({ ...t, pages: [...t.pages, pg] })); setSelectedPage(pg.id); setPreviewPage(pg.slug); }}><Plus />{tpl.title}</Button>)}
              <Button type="button" size="sm" variant="outline" disabled={theme.pages.length >= 10} onClick={() => { let n = 1; while (theme.pages.some(p => p.slug === `page-${n}`)) n++; const pg: ShopPage = { id: newId("p"), slug: `page-${n}`, title: "New page", body: "", showInFooter: true }; setTheme(t => ({ ...t, pages: [...t.pages, pg] })); setSelectedPage(pg.id); setPreviewPage(pg.slug); }}><Plus />Blank page</Button></div>
            {(() => { const pg = theme.pages.find(p => p.id === selectedPage); if (!pg) return null; const patch = (v: Partial<ShopPage>) => { setTheme(t => ({ ...t, pages: t.pages.map(x => (x.id === pg.id ? { ...x, ...v } : x)), nav: v.slug !== undefined ? { ...t.nav, links: t.nav.links.map(l => (l.type === "page" && l.target === pg.slug ? { ...l, target: v.slug! } : l)) } : t.nav })); if (v.slug !== undefined && previewPage === pg.slug) setPreviewPage(v.slug); };
              return <div key={pg.id} className="grid gap-3 rounded-md border border-primary/40 bg-card p-4"><p className="text-sm font-semibold">Edit page</p>
                <Field label="Page title"><Input maxLength={80} value={pg.title} onChange={e => patch({ title: e.target.value })} /></Field>
                <Field label="Page address" hint={`Shoppers open it at /shop/${data.store.store_slug}?page=${pg.slug}`}><Input maxLength={40} value={pg.slug} onChange={e => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) })} /></Field>
                <Field label="Page text" hint="Leave a blank line between paragraphs."><Textarea rows={10} maxLength={10000} value={pg.body} onChange={e => patch({ body: e.target.value })} /></Field>
                <Toggle label="Show in footer" checked={pg.showInFooter} onChange={v => patch({ showInFooter: v })} />
              </div>; })()}
          </TabsContent>

          <TabsContent value="footer" className="mt-4 grid gap-4">
            <Choice label="Footer layout" value={theme.footer.style} options={[{ value: "columns", label: "Columns" }, { value: "simple", label: "Simple" }]} onChange={v => setTheme(t => ({ ...t, footer: { ...t.footer, style: v } }))} />
            <Field label="About your shop"><Textarea rows={3} maxLength={400} value={theme.footer.about} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, about: e.target.value } }))} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Phone"><Input maxLength={20} value={theme.footer.phone} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, phone: e.target.value } }))} /></Field><Field label="Email"><Input type="email" maxLength={254} value={theme.footer.email} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, email: e.target.value } }))} /></Field></div>
            <Field label="Address"><Input maxLength={300} value={theme.footer.address} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, address: e.target.value } }))} /></Field>
            <div className="grid grid-cols-2 gap-3">{([["instagram", "Instagram link"], ["facebook", "Facebook link"], ["youtube", "YouTube link"], ["x", "X link"]] as const).map(([k, l]) => <Field key={k} label={l}><Input placeholder="https://" maxLength={300} value={theme.footer.socials[k]} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, socials: { ...t.footer.socials, [k]: e.target.value } } }))} /></Field>)}
              <Field label="WhatsApp number" hint="With country code, digits only"><Input inputMode="numeric" maxLength={15} value={theme.footer.socials.whatsapp} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, socials: { ...t.footer.socials, whatsapp: e.target.value.replace(/\D/g, "") } } }))} /></Field></div>
            <span className="text-sm font-medium">Footer links</span>
            <SortableList items={theme.footer.links} label={l => l.label} onChange={links => setTheme(t => ({ ...t, footer: { ...t.footer, links } }))} render={l => <div className="grid gap-1 sm:grid-cols-[1fr_1.4fr_auto]"><Input aria-label="Link label" value={l.label} maxLength={40} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, links: t.footer.links.map(x => (x.id === l.id ? { ...x, label: e.target.value } : x)) } }))} /><Input aria-label="Link address" placeholder="https://" value={l.url} maxLength={300} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, links: t.footer.links.map(x => (x.id === l.id ? { ...x, url: e.target.value } : x)) } }))} /><Button type="button" size="icon" variant="ghost" aria-label={`Remove ${l.label}`} onClick={() => setTheme(t => ({ ...t, footer: { ...t.footer, links: t.footer.links.filter(x => x.id !== l.id) } }))}><Trash2 /></Button></div>} />
            <Button variant="outline" disabled={theme.footer.links.length >= 12} onClick={() => setTheme(t => ({ ...t, footer: { ...t.footer, links: [...t.footer.links, { id: newId("f"), label: "New link", url: "https://" }] } }))}><Plus />Add footer link</Button>
            <Field label="Copyright line"><Input maxLength={120} placeholder={`© ${new Date().getFullYear()} ${data.store.store_name}`} value={theme.footer.copyright} onChange={e => setTheme(t => ({ ...t, footer: { ...t.footer, copyright: e.target.value } }))} /></Field>
          </TabsContent>

          <TabsContent value="versions" className="mt-4 grid gap-3">
            <p className="text-sm text-muted-foreground">Every publish is saved here (last 30). Preview one before restoring it.</p>
            {!data.versions.length ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No published versions yet.</p>
              : <ul className="grid gap-2">{data.versions.map(v => <li key={v.id} className={`rounded-md border p-3 ${previewVersion?.id === v.id ? "border-primary" : "border-border"}`}>
                <p className="font-medium">{v.name}</p><p className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}><Eye />{previewVersion?.id === v.id ? "Stop preview" : "Preview"}</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={() => doRestore(v, false)}><RotateCcw />Restore to draft</Button><Button size="sm" disabled={!!busy} onClick={() => doRestore(v, true)}>{busy === `restore-${v.id}-true` ? <Loader2 className="animate-spin" /> : <Rocket />}Restore & publish</Button><Button size="sm" variant="ghost" aria-label={`Delete version ${v.name}`} disabled={!!busy} onClick={() => doDelete(v)}><Trash2 /></Button></div>
              </li>)}</ul>}
          </TabsContent>
        </Tabs>
      </aside>

      <section className="order-1 lg:order-2" aria-label="Live preview">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" role="radiogroup" aria-label="Preview size">{([["desktop", Monitor, "Desktop"], ["tablet", Tablet, "Tablet"], ["mobile", Smartphone, "Phone"]] as const).map(([d, Icon, l]) => <Button key={d} size="sm" role="radio" aria-checked={device === d} variant={device === d ? "default" : "outline"} onClick={() => setDevice(d)}><Icon />{l}</Button>)}</div>
          {previewVersion ? <p className="flex items-center gap-2 text-sm"><History className="size-4 text-primary" />Previewing “{previewVersion.name}”<Button size="sm" variant="ghost" onClick={() => setPreviewVersion(null)}>Back to draft</Button></p> : <p className="text-xs text-muted-foreground">Click any part of the preview to edit it.</p>}
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-muted p-2 sm:p-4">
          <div className="mx-auto max-h-[78vh] overflow-y-auto rounded border border-border shadow-sm transition-[width]" style={{ width: WIDTH[device], maxWidth: "100%" }}>
            <StorefrontView storeName={data.store.store_name} theme={shown} products={products} images={images} mode="preview" page={previewPage} onPage={setPreviewPage} selected={previewVersion ? null : selected} {...(previewVersion ? {} : { onSelect: selectFromPreview })}
              cart={cart} cartCount={Object.values(cart).reduce((a, b) => a + b, 0)} cartTotal={0} onOpenCart={() => {}} onSetQty={(p, n) => setCart(c => ({ ...c, [p.id]: n }))} />
          </div>
        </div>
      </section>
    </div>

    <Dialog open={publishOpen} onOpenChange={o => !busy && setPublishOpen(o)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish this design?</DialogTitle><DialogDescription>Shoppers see it right away. A copy is saved in History so you can go back.</DialogDescription></DialogHeader>
        <Field label="Version name (optional)"><Input maxLength={80} value={versionName} placeholder="e.g. Onam sale look" onChange={e => setVersionName(e.target.value)} /></Field>
        {warnings.length > 0 && <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4" />Some colours are hard to read. You can still publish.</p>}
        <DialogFooter><Button variant="outline" disabled={!!busy} onClick={() => setPublishOpen(false)}>Cancel</Button><Button disabled={!!busy} onClick={doPublish}>{busy === "publish" ? <Loader2 className="animate-spin" /> : <Check />}Publish now</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
}

function NavLinkEditor({ link, sections, categories, pages, onChange, onRemove }: { link: NavLink; sections: ThemeSection[]; categories: string[]; pages: ShopPage[]; onChange: (p: Partial<NavLink>) => void; onRemove: () => void }) {
  return <div className="grid gap-1">
    <div className="flex gap-1"><Input aria-label="Menu link label" value={link.label} maxLength={40} onChange={e => onChange({ label: e.target.value })} /><Button type="button" size="icon" variant="ghost" aria-label={`Remove ${link.label}`} onClick={onRemove}><Trash2 /></Button></div>
    <div className="grid grid-cols-[7rem_1fr] gap-1">
      <select aria-label="Link type" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={link.type} onChange={e => onChange({ type: e.target.value as NavLink["type"], target: e.target.value === "section" ? sections[0]?.id ?? "" : e.target.value === "category" ? categories[0] ?? "" : e.target.value === "page" ? pages[0]?.slug ?? "" : "https://" })}><option value="section">Section</option><option value="category">Category</option><option value="page" disabled={!pages.length}>Page</option><option value="external">Website</option></select>
      {link.type === "section" ? <select aria-label="Section" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={link.target} onChange={e => onChange({ target: e.target.value })}>{sections.map(s => <option key={s.id} value={s.id}>{s.title || SECTION_LABELS[s.type]}</option>)}</select>
        : link.type === "page" ? <select aria-label="Page" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={link.target} onChange={e => onChange({ target: e.target.value })}>{pages.map(p => <option key={p.id} value={p.slug}>{p.title}</option>)}</select>
        : link.type === "category" ? <select aria-label="Category" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={link.target} onChange={e => onChange({ target: e.target.value })}><option value="">All products</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
        : <Input aria-label="Website address" value={link.target} maxLength={300} onChange={e => onChange({ target: e.target.value })} />}
    </div>
  </div>;
}

function SectionEditor({ section: s, categories, images, onSigned, onChange }: { section: ThemeSection; categories: string[]; images: Record<string, string>; onSigned: (p: string, u: string) => void; onChange: (p: Partial<ThemeSection>) => void }) {
  const hasItems = s.type === "testimonials" || s.type === "faq";
  return <div className="grid gap-3 rounded-md border border-primary/40 bg-card p-4">
    <p className="text-sm font-semibold">Edit: {SECTION_LABELS[s.type]}</p>
    <Field label="Title"><Input maxLength={120} value={s.title} onChange={e => onChange({ title: e.target.value })} /></Field>
    {s.type === "hero" && <Field label="Subtitle"><Input maxLength={240} value={s.subtitle} onChange={e => onChange({ subtitle: e.target.value })} /></Field>}
    {(s.type === "text" || s.type === "banner" || s.type === "contact") && <Field label="Text"><Textarea rows={4} maxLength={2000} value={s.body} onChange={e => onChange({ body: e.target.value })} /></Field>}
    {(s.type === "hero" || s.type === "text") && <ImageField label="Image" path={s.imagePath} images={images} onSigned={onSigned} onChange={p => onChange({ imagePath: p })} />}
    {(s.type === "hero" || s.type === "banner" || s.type === "text") && <div className="grid grid-cols-2 gap-2"><Field label="Button label"><Input maxLength={40} value={s.ctaLabel} onChange={e => onChange({ ctaLabel: e.target.value })} /></Field><Field label="Button link" hint="#products, /… or https://"><Input maxLength={300} value={s.ctaHref} onChange={e => onChange({ ctaHref: e.target.value })} /></Field></div>}
    {s.type === "products" && <Field label="Show only this category"><select className="h-10 rounded-md border border-input bg-background px-3" value={s.category} onChange={e => onChange({ category: e.target.value })}><option value="">All products</option>{categories.map(c => <option key={c}>{c}</option>)}</select></Field>}
    {hasItems && <><span className="text-sm font-medium">{s.type === "faq" ? "Questions" : "Quotes"}</span>
      <SortableList items={s.items} label={i => i.title || "item"} onChange={items => onChange({ items })} render={i => <div className="grid gap-1"><Input aria-label={s.type === "faq" ? "Question" : "Customer name"} placeholder={s.type === "faq" ? "Question" : "Customer name"} maxLength={120} value={i.title} onChange={e => onChange({ items: s.items.map(x => (x.id === i.id ? { ...x, title: e.target.value } : x)) })} /><Textarea aria-label={s.type === "faq" ? "Answer" : "Quote"} rows={2} placeholder={s.type === "faq" ? "Answer" : "What they said"} maxLength={600} value={i.body} onChange={e => onChange({ items: s.items.map(x => (x.id === i.id ? { ...x, body: e.target.value } : x)) })} /><Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => onChange({ items: s.items.filter(x => x.id !== i.id) })}><Trash2 />Remove</Button></div>} />
      <Button type="button" variant="outline" size="sm" disabled={s.items.length >= 12} onClick={() => onChange({ items: [...s.items, { id: newId("i"), title: "", body: "" }] })}><Plus />Add</Button></>}
  </div>;
}
