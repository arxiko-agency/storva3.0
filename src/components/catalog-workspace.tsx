import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Pencil, Trash2, Save, RefreshCw, Package, Upload, X, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getStoreSettings, updateStoreSettings, listProducts, saveProduct, deleteProduct } from "@/lib/store.functions";
import { formatMoney, productSchema, storeSettingsSchema } from "@/lib/order-rules";
import { GST_RATES } from "@/lib/pricing-rules";
import { uploadImage } from "@/lib/upload-image";

type Product = Awaited<ReturnType<typeof listProducts>>[number];
type Draft = { id?: string; title: string; description: string; price: string; stock: string; category: string; compareAtPrice: string; hsnCode: string; gstRate: string; imagePath?: string; imageUrl: string | null };
const empty: Draft = { title: "", description: "", price: "", stock: "", category: "", compareAtPrice: "", hsnCode: "", gstRate: "", imageUrl: null };

function StoreSettings() {
  const get = useServerFn(getStoreSettings), update = useServerFn(updateStoreSettings);
  const client = useQueryClient();
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["store-settings"], queryFn: () => get() });
  const [name, setName] = useState(""), [slug, setSlug] = useState(""), [alerts, setAlerts] = useState(true), [saving, setSaving] = useState(false), [problem, setProblem] = useState("");
  useEffect(() => { if (data) { setName(data.store_name); setSlug(data.store_slug ?? ""); setAlerts(data.order_alerts); } }, [data]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setProblem("");
    const parsed = storeSettingsSchema.safeParse({ storeName: name, storeSlug: slug, orderAlerts: alerts });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? "Check the form."); return; }
    setSaving(true);
    try { await update({ data: parsed.data }); await client.invalidateQueries({ queryKey: ["store-settings"] }); toast.success("Store settings saved."); }
    catch (err) { setProblem(err instanceof Error ? err.message : "Could not save."); }
    finally { setSaving(false); }
  }
  if (isPending) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>;
  if (error || !data) return <div role="alert" className="text-destructive">{error?.message ?? "Unavailable"} <Button variant="link" onClick={() => refetch()}>Try again</Button></div>;
  return <form onSubmit={save} className="grid gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-2">
    <h2 className="font-display text-xl font-semibold sm:col-span-2">Your store</h2>
    <label className="grid gap-2 text-sm">Store name<Input value={name} maxLength={80} required onChange={e => setName(e.target.value)} /></label>
    <label className="grid gap-2 text-sm">Shop link<div className="flex items-center gap-1"><span className="text-muted-foreground">/shop/</span><Input value={slug} maxLength={40} required onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} aria-describedby="slug-help" /></div><span id="slug-help" className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens.</span></label>
    <div className="flex items-start gap-3 sm:col-span-2"><Switch id="alerts" checked={alerts} onCheckedChange={setAlerts} /><label htmlFor="alerts" className="text-sm"><span className="font-medium">Email me about every new order</span><span className="block text-muted-foreground">{data.alertEmail ? <>Alerts go to <b>{data.alertEmail}</b>, sent from the connected Gmail account.</> : "Your account has no email address."}{!data.gmailConfigured && " Gmail is not connected, so alerts can't be sent yet."}</span></label></div>
    {problem && <p role="alert" className="text-sm text-destructive sm:col-span-2">{problem}</p>}
    <div className="sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save store settings</Button></div>
  </form>;
}

export function CatalogWorkspace() {
  const list = useServerFn(listProducts), save = useServerFn(saveProduct), remove = useServerFn(deleteProduct);
  const client = useQueryClient();
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["products"], queryFn: () => list() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickImage(file?: File) {
    if (!file || !draft) return; setUploading(true); setProblem("");
    try { const path = await uploadImage(file); setDraft(d => d && ({ ...d, imagePath: path, imageUrl: URL.createObjectURL(file) })); }
    catch (err) { setProblem(err instanceof Error ? err.message : "Upload failed."); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function edit(p?: Product) { setProblem(""); setDraft(p ? { id: p.id, title: p.title, description: p.description, price: String(p.price), stock: String(p.stock), category: p.category ?? "", compareAtPrice: p.compare_at_price === null ? "" : String(p.compare_at_price), hsnCode: p.hsn_code ?? "", gstRate: p.gst_rate === null ? "" : String(p.gst_rate), imageUrl: p.image_url } : { ...empty }); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!draft) return; setProblem("");
    if (draft.price.trim() === "" || draft.stock.trim() === "") { setProblem("Enter a price and stock quantity."); return; }
    const parsed = productSchema.safeParse({ id: draft.id, title: draft.title, description: draft.description, category: draft.category, price: Number(draft.price), stock: Number(draft.stock), compareAtPrice: draft.compareAtPrice.trim() === "" ? null : Number(draft.compareAtPrice), hsnCode: draft.hsnCode, gstRate: draft.gstRate === "" ? null : Number(draft.gstRate), imagePath: draft.imagePath });
    if (!parsed.success) { setProblem(parsed.error.issues[0]?.message ?? "Check the form."); return; }
    setBusy(true);
    try { await save({ data: parsed.data }); await client.invalidateQueries({ queryKey: ["products"] }); toast.success(draft.id ? "Product updated." : "Product added."); setDraft(null); }
    catch (err) { setProblem(err instanceof Error ? err.message : "Could not save this product."); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!deleting) return; setBusy(true);
    try { await remove({ data: { id: deleting.id } }); await client.invalidateQueries({ queryKey: ["products"] }); toast.success("Product deleted."); setDeleting(null); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not delete."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
    <p className="text-sm font-medium text-primary">CATALOG</p><h1 className="mb-6 font-display text-3xl font-semibold">Store & products</h1>
    <StoreSettings />
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">Products</h2><Button onClick={() => edit()}><Plus />Add product</Button></div>
      {isPending ? <div className="flex justify-center p-10"><Loader2 className="animate-spin text-primary" /></div>
        : error ? <div role="alert" className="mt-4 text-destructive">{error.message} <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw />Try again</Button></div>
        : !data?.length ? <div className="mt-4 rounded-md border border-dashed border-border p-10 text-center"><Package className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No products yet</p><p className="mt-1 text-sm text-muted-foreground">Add your first product so shoppers can order it.</p></div>
        : <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-card">{data.map(p => <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {p.image_url ? <img src={p.image_url} alt="" className="size-12 rounded object-cover" /> : <div className="flex size-12 items-center justify-center rounded bg-muted"><ImageIcon className="size-5 text-muted-foreground" /></div>}
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{p.category ? `${p.category} · ` : ""}{p.stock > 0 ? `${p.stock} in stock` : <span className="text-destructive">Out of stock</span>}</p></div>
            <span className="text-right font-semibold">{formatMoney(p.price)}{p.compare_at_price !== null && <s className="block text-xs font-normal text-muted-foreground">{formatMoney(p.compare_at_price)}</s>}</span>
            <Button variant="ghost" size="icon" aria-label={`Edit ${p.title}`} onClick={() => edit(p)}><Pencil /></Button>
            <Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} onClick={() => setDeleting(p)}><Trash2 /></Button>
          </li>)}</ul>}
    </section>

    <Dialog open={!!draft} onOpenChange={open => !open && !busy && setDraft(null)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{draft?.id ? "Edit product" : "Add product"}</DialogTitle><DialogDescription>Prices are in rupees. Stock goes down automatically when orders are placed.</DialogDescription></DialogHeader>
        {draft && <form id="product-form" onSubmit={submit} className="grid gap-4">
          <label className="grid gap-2 text-sm">Name<Input required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm">Price (₹)<Input required type="number" inputMode="decimal" min={0} step="0.01" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /></label><label className="grid gap-2 text-sm">Stock<Input required type="number" inputMode="numeric" min={0} step={1} value={draft.stock} onChange={e => setDraft({ ...draft, stock: e.target.value })} /></label></div>
          <div className="flex items-center gap-3">{draft.imageUrl && draft.imagePath !== "" ? <img src={draft.imageUrl} alt="" className="size-16 rounded object-cover" /> : <div className="flex size-16 items-center justify-center rounded border border-dashed border-border"><ImageIcon className="size-5 text-muted-foreground" /></div>}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" aria-label="Product photo" onChange={e => pickImage(e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Upload />}{draft.imageUrl ? "Change photo" : "Add photo"}</Button>
            {draft.imageUrl && draft.imagePath !== "" && <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, imagePath: "", imageUrl: null })}><X />Remove</Button>}</div>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm">Compare-at price (₹, optional)<Input type="number" inputMode="decimal" min={0} step="0.01" value={draft.compareAtPrice} onChange={e => setDraft({ ...draft, compareAtPrice: e.target.value })} /><span className="text-xs text-muted-foreground">Shows a sale badge when higher than the price.</span></label><label className="grid gap-2 text-sm">Category<Input maxLength={80} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm">HSN code (optional)<Input inputMode="numeric" maxLength={8} value={draft.hsnCode} onChange={e => setDraft({ ...draft, hsnCode: e.target.value.replace(/\D/g, "") })} /></label><label className="grid gap-2 text-sm">GST rate<select className="h-9 rounded-md border border-input bg-background px-2" value={draft.gstRate} onChange={e => setDraft({ ...draft, gstRate: e.target.value })}><option value="">Store default</option>{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></label></div>
          <label className="grid gap-2 text-sm">Description<Textarea rows={4} maxLength={5000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        </form>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Close</Button><Button type="submit" form="product-form" disabled={busy || uploading}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save product</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle><AlertDialogDescription>It disappears from your shop. Past orders keep their item details.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); confirmDelete(); }}>{busy && <Loader2 className="animate-spin" />}Delete</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
