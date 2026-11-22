import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Sparkles, Lock, ArrowUpRight, Copy, Loader2, History, ImagePlus } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { getBillingOverview } from "@/lib/billing.functions";
import { generateAi, getAiHistory } from "@/lib/ai.functions";
import { AI_TOOLS, canUseAi, plainAiText, type AiInput } from "@/lib/ai-tools";
import { toast } from "sonner";
import bottle from "@/assets/product-bottle.jpg";

export function AiStudio() {
  const billingFn = useServerFn(getBillingOverview);
  const historyFn = useServerFn(getAiHistory);
  const generate = useServerFn(generateAi);
  const client = useQueryClient();
  const billing = useQuery({ queryKey: ["billing"], queryFn: () => billingFn() });
  const history = useQuery({ queryKey: ["ai-history"], queryFn: () => historyFn() });
  const [kind, setKind] = useState<AiInput["kind"]>("title");
  const [details, setDetails] = useState("");
  const [language, setLanguage] = useState<AiInput["language"]>("English");
  const [tone, setTone] = useState<AiInput["tone"]>("Natural");
  const [image, setImage] = useState<string>();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const plan = billing.data?.plans.find(p => p.id === billing.data.usage.plan_id);
  const allowed = canUseAi(plan?.features, kind);
  const used = billing.data?.usage.ai_month ?? 0;
  const tool = AI_TOOLS.find(t => t.id === kind);
  async function run() {
    setBusy(true); setError(""); setResult("");
    try { const response = await generate({ data: { kind, details, language, tone, ...(image && kind === "image_extract" ? { image } : {}) } }); if (response.error) setError(response.error); else setResult(plainAiText(response.text ?? "")); }
    catch(e) { setError(e instanceof Error ? e.message : "Generation failed."); }
    finally { setBusy(false); client.invalidateQueries({ queryKey: ["billing"] }); client.invalidateQueries({ queryKey: ["ai-history"] }); }
  }
  return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-xs font-semibold uppercase text-primary">GEMINI / CREATIVE WORKSPACE</p><h1 className="font-display text-4xl font-semibold">AI studio</h1></div><div className="flex items-center gap-4"><div className="text-right"><p className="text-sm font-semibold">{used} / {plan?.ai_limit ?? "—"} requests</p><p className="text-xs text-muted-foreground">This month · {plan?.name ?? "Loading"}</p></div><Button variant="outline" asChild><Link to="/billing">View plan<ArrowUpRight /></Link></Button></div></div>
    {billing.error && <p role="alert" className="mt-6 text-destructive">{billing.error.message}</p>}
    <div className="mt-9 grid grid-cols-2 gap-3 md:grid-cols-4">{AI_TOOLS.map(t => <Button key={t.id} variant={kind === t.id ? "secondary" : "outline"} className={`h-auto min-h-24 items-start justify-start whitespace-normal px-4 py-4 text-left ${kind === t.id ? "border border-primary" : ""}`} onClick={() => { setKind(t.id); setError(""); }}><div className="min-w-0 flex-1"><p className="flex items-center justify-between gap-2 font-medium">{t.label}{plan && !canUseAi(plan.features,t.id) ? <Lock className="size-3 text-muted-foreground" /> : <Sparkles className="size-3 text-primary" />}</p><p className="mt-2 text-xs font-normal text-muted-foreground">{t.detail}</p></div></Button>)}</div>
    <div className="mt-9 grid gap-8 lg:grid-cols-[1.05fr_1fr]">
      <section className="min-w-0"><div className="mb-5 flex items-center justify-between"><h2 className="font-display text-xl font-semibold">{tool?.label}</h2><span className="text-xs text-muted-foreground">01 / BRIEF</span></div>
        <label className="grid gap-2 text-sm font-medium">Product details<Textarea value={details} onChange={e => setDetails(e.target.value)} rows={7} maxLength={8000} placeholder="Product name, materials, features, audience…" className="resize-y bg-card font-normal" /></label>
        {kind === "image_extract" && <label className="mt-4 flex cursor-pointer flex-col items-center gap-3 rounded-md border border-dashed border-input bg-card p-5 text-sm"><ImagePlus className="text-primary" />Product photo · JPEG, PNG or WebP · up to 5 MB<input aria-label="Product photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file=e.target.files?.[0]; if(!file) return; if(file.size>5*1024*1024) { toast.error("Choose a photo under 5 MB."); return; } const reader=new FileReader(); reader.onload=()=>setImage(typeof reader.result === "string" ? reader.result : undefined); reader.readAsDataURL(file); }} />{image && <img src={image} alt="Selected product" width={160} height={160} className="size-40 object-contain" />}</label>}
        <div className="mt-5 grid grid-cols-2 gap-4"><label className="grid gap-2 text-sm">Language<select aria-label="Language" className="h-10 rounded-md border border-input bg-card px-3" value={language} onChange={e => setLanguage(e.target.value as AiInput["language"])}>{["English","Malayalam","Hindi"].map(v=><option key={v}>{v}</option>)}</select></label><label className="grid gap-2 text-sm">Tone<select aria-label="Tone" className="h-10 rounded-md border border-input bg-card px-3" value={tone} onChange={e => setTone(e.target.value as AiInput["tone"])}>{["Natural","Professional","Playful","Luxury"].map(v=><option key={v}>{v}</option>)}</select></label></div>
        <Button className="mt-6 h-11 w-full" disabled={busy || !allowed || details.trim().length < 3 || (kind === "image_extract" && !image) || used >= (plan?.ai_limit ?? 0)} onClick={run}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? "Creating…" : "Generate content"}</Button>
        {!allowed && plan && <p className="mt-3 text-sm text-muted-foreground">This tool is not included in {plan.name}. <Link className="text-primary underline" to="/billing">Choose a plan</Link></p>}{error && <p role="alert" className="mt-4 break-words text-sm text-destructive">{error}</p>}
      </section>
      <section className="min-w-0"><div className="mb-5 flex items-center justify-between"><h2 className="font-display text-xl font-semibold">Your content</h2><Button size="icon" variant="ghost" title="Copy content" aria-label="Copy content" disabled={!result} onClick={() => navigator.clipboard.writeText(result).then(() => toast.success("Copied"))}><Copy /></Button></div><div className="min-h-80 rounded-md border border-border bg-card p-6">{result ? <p className="whitespace-pre-wrap break-words text-sm leading-7" data-testid="ai-result">{result}</p> : <div className="flex min-h-64 flex-col items-center justify-center text-center"><img src={bottle} width={128} height={128} alt="Example product bottle" className="size-32 rounded-md object-cover" /><p className="mt-5 font-medium">{busy ? "Gemini is creating your content…" : "A fresh start for your next product"}</p><p className="mt-2 text-xs text-muted-foreground">{busy ? "Request in progress" : "No content generated yet"}</p></div>}</div></section>
    </div>
    <section className="mt-12 border-t border-border pt-6"><div className="flex items-center justify-between"><h2 className="font-display text-xl font-semibold">Request history</h2><Button variant="ghost" onClick={() => setShowHistory(!showHistory)}><History />{showHistory ? "Hide history" : "Show history"}</Button></div>{showHistory && <div className="mt-4 divide-y divide-border">{history.error && <p role="alert">{history.error.message}</p>}{!history.data?.length && <p className="py-6 text-sm text-muted-foreground">No requests yet.</p>}{history.data?.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{AI_TOOLS.find(t=>t.id===r.kind)?.label ?? r.kind} <span className={r.status === "error" ? "text-destructive" : "text-muted-foreground"}>· {r.status}</span></p><p className="mt-1 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>{r.error && <p className="mt-1 text-xs text-destructive">{r.error}</p>}</div><Button variant="outline" size="sm" disabled={!r.output} onClick={()=>{ const out=r.output as {text?:string}|null;setResult(plainAiText(out?.text ?? "")); }}>View result</Button></div>)}</div>}</section>
  </main>;
}