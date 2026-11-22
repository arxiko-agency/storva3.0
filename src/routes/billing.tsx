import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, CreditCard, Loader2, ExternalLink } from "lucide-react";
import { StoreShell } from "@/components/store-shell";
import { Button } from "@/components/ui/button";
import { getBillingOverview, startTrial, createCheckout, verifyCheckout, changePlan, cancelSubscription } from "@/lib/billing.functions";
import { formatINR, formatStorage, formatLimit, FEATURE_LABELS, planFeatures, type BillingInterval } from "@/lib/plan-rules";
import { toast } from "sonner";

export const Route = createFileRoute("/billing")({ head: () => ({ meta: [{ title: "STORVA — Subscription & billing" }, { name: "description", content: "Manage your STORVA subscription, monthly usage, invoices and payments." }, { property: "og:title", content: "STORVA — Subscription & billing" }, { property: "og:description", content: "Your store plan, usage and payment history in one place." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }), component: () => <StoreShell><Billing /></StoreShell> });

type RzResult = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(name: string, fn: (response: { error?: { description?: string } }) => void): void }; } }

async function loadCheckout() {
  if (window.Razorpay) return;
  await new Promise<void>((resolve,reject)=>{ const script=document.createElement("script");script.src="https://checkout.razorpay.com/v1/checkout.js";script.onload=()=>resolve();script.onerror=()=>reject(new Error("Could not load Razorpay checkout."));document.head.appendChild(script); });
}

function Billing() {
  const get=useServerFn(getBillingOverview),trial=useServerFn(startTrial),checkout=useServerFn(createCheckout),verify=useServerFn(verifyCheckout),change=useServerFn(changePlan),cancel=useServerFn(cancelSubscription);
  const client=useQueryClient();
  const {data,error,isPending}=useQuery({queryKey:["billing"],queryFn:()=>get()});
  const [interval,setInterval]=useState<BillingInterval>("monthly");
  const [busy,setBusy]=useState("");
  const plan=data?.plans.find(p=>p.id===data.usage.plan_id);
  const sub=data?.subscription;
  async function action(id:string, mode:"trial"|"subscribe") {
    if(id!=="starter" && id!=="pro") return;
    setBusy(id);
    try {
      if(mode==="trial") { await trial({data:{planId:id}});toast.success("Your trial is active."); }
      else if(sub?.razorpay_subscription_id && ["active","past_due"].includes(sub.status)) { const result=await change({data:{planId:id,interval}});toast.success(result.applied === "now" ? "Plan changed." : "Plan change scheduled for renewal."); }
      else {
        await loadCheckout();
        const result=await checkout({data:{planId:id,interval}});
        const Rz=window.Razorpay;if(!Rz) throw new Error("Razorpay checkout is unavailable.");
        const instance=new Rz({ key:result.keyId,subscription_id:result.subscriptionId,name:"STORVA",description:`${id} · ${interval}`,handler:async (response:RzResult)=>{try{await verify({data:{paymentId:response.razorpay_payment_id,subscriptionId:response.razorpay_subscription_id,signature:response.razorpay_signature}});toast.success("Payment verified.");client.invalidateQueries({queryKey:["billing"]});}catch(e){toast.error(e instanceof Error?e.message:"Payment verification failed.");}},modal:{ondismiss:()=>setBusy("")} });
        instance.on("payment.failed",r=>toast.error(r.error?.description??"Payment failed. Update your payment method and try again."));instance.open();
      }
      client.invalidateQueries({queryKey:["billing"]});
    }catch(e){toast.error(e instanceof Error?e.message:"Could not update your subscription.");}finally{setBusy("");}
  }
  if(isPending) return <div className="flex justify-center p-20"><Loader2 className="animate-spin"/></div>;
  if(error || !data) return <p role="alert" className="p-8 text-destructive">{error?.message??"Billing unavailable"}</p>;
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold text-primary">STORVA / YOUR SUBSCRIPTION</p><h1 className="font-display text-4xl font-semibold">Subscription & billing</h1></div><div className="flex rounded-md border border-input p-1"><Button variant={interval==="monthly"?"secondary":"ghost"} onClick={()=>setInterval("monthly")}>Monthly</Button><Button variant={interval==="yearly"?"secondary":"ghost"} onClick={()=>setInterval("yearly")}>Yearly</Button></div></div>
    <section className="mt-8 flex flex-wrap items-center justify-between gap-5 border-y border-border py-6"><div><h2 className="font-display text-2xl font-semibold">{plan?.name??"Free"} plan</h2><p className="mt-1 text-sm text-muted-foreground">{sub?.status??"free"}{sub?.cancel_at_period_end?" · Cancels at period end":""}{sub?.pending_plan_id?` · ${sub.pending_plan_id} scheduled at renewal`:""}</p>{(sub?.trial_ends_at && sub.status==="trialing" || sub?.current_period_end) && <p className="mt-1 text-sm text-muted-foreground">{sub.status==="trialing"?"Trial ends":"Current period ends"}: {new Date(sub.status==="trialing"?sub.trial_ends_at??"":sub.current_period_end??"").toLocaleDateString()}</p>}</div>{sub && ["active","trialing","past_due"].includes(sub.status) && !sub.cancel_at_period_end && <Button variant="outline" onClick={async()=>{if(!window.confirm("Cancel your subscription? Active paid access remains until the current period ends."))return;try{await cancel();client.invalidateQueries({queryKey:["billing"]});toast.success("Subscription cancelled.");}catch(e){toast.error(e instanceof Error?e.message:"Cancellation failed.");}}}>Cancel subscription</Button>}</section>
    {!data.paymentsConfigured && <p role="status" className="mt-5 rounded-md border border-border bg-secondary px-5 py-4 text-sm">Razorpay payments are not configured yet. Free access and trials are available; paid checkout is unavailable.</p>}{sub?.last_payment_error && <div role="alert" className="mt-4 border border-destructive p-4 text-sm text-destructive">{sub.last_payment_error}{sub.razorpay_short_url && <Button variant="link" asChild><a href={sub.razorpay_short_url} target="_blank" rel="noreferrer">Update payment method<ExternalLink/></a></Button>}</div>}
    <section className="mt-8 grid grid-cols-2 gap-5 lg:grid-cols-4">{[{name:"Products",used:data.usage.products,limit:formatLimit(plan?.product_limit??null)},{name:"Orders this month",used:data.usage.orders_month,limit:formatLimit(plan?.order_limit??null)},{name:"Storage",used:`${Math.round((data.usage.storage_bytes??0)/1024/1024)} MB`,limit:formatStorage(plan?.storage_mb??0)},{name:"AI requests",used:data.usage.ai_month,limit:plan?.ai_limit??0}].map(u=><div key={u.name} className="border-l-2 border-primary pl-4"><p className="text-xs text-muted-foreground">{u.name}</p><p className="mt-2 text-xl font-semibold">{u.used}<span className="text-sm font-normal text-muted-foreground"> / {u.limit}</span></p></div>)}</section>
    <section className="mt-10"><h2 className="mb-5 font-display text-xl font-semibold">Available plans</h2><div className="grid gap-4 sm:grid-cols-3">{data.plans.map(p=><article key={p.id} className={`flex flex-col rounded-md border bg-card p-6 ${p.id===plan?.id?"border-primary":"border-border"}`}><div className="flex justify-between"><h3 className="font-display text-xl font-semibold">{p.name}</h3>{p.id===plan?.id&&<Check className="size-5 text-primary"/>}</div><p className="mt-5 text-3xl font-semibold">{formatINR(interval==="monthly"?p.price_monthly:p.price_yearly)}</p><p className="mt-1 text-xs text-muted-foreground">per {interval==="monthly"?"month":"year"}</p><ul className="my-6 space-y-3 text-sm"><li>{formatLimit(p.product_limit)} products</li><li>{formatLimit(p.order_limit)} orders / month</li><li>{formatStorage(p.storage_mb)} storage</li><li>{p.ai_limit.toLocaleString()} AI requests / month</li>{planFeatures(p).map(f=><li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary"/>{FEATURE_LABELS[f]}</li>)}</ul><div className="mt-auto space-y-2">{p.id!=="free"&&<Button className="w-full" disabled={!!busy||!data.paymentsConfigured||(p.id===sub?.plan_id&&interval===sub.billing_interval)} onClick={()=>action(p.id,"subscribe")}><CreditCard/>{busy===p.id?"Please wait…":sub?.razorpay_subscription_id?"Change plan":"Subscribe"}</Button>}{p.id!=="free"&&!sub?.trial_used&&!['active','past_due'].includes(sub?.status??'')&&<Button variant="outline" className="w-full" disabled={!!busy} onClick={()=>action(p.id,"trial")}>Start {p.trial_days}-day trial</Button>}{p.id==="free"&&<p className="text-sm text-muted-foreground">{plan?.id==="free"?"Current plan":"Available after paid access ends"}</p>}</div></article>)}</div></section>
    <section className="mt-10 border-t border-border pt-6"><h2 className="font-display text-xl font-semibold">Billing history & invoices</h2><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="border-b border-border text-muted-foreground"><tr><th className="py-3">Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead><tbody>{data.invoices.map(i=><tr key={i.id} className="border-b border-border"><td className="py-4">{new Date(i.created_at).toLocaleDateString()}</td><td>{i.plan_id}</td><td>{formatINR(i.amount)}</td><td>{i.status}{i.failure_reason&&<p className="text-xs text-destructive">{i.failure_reason}</p>}</td><td>{i.invoice_url?<Button variant="link" asChild><a href={i.invoice_url} target="_blank" rel="noreferrer">Open<ExternalLink/></a></Button>:"—"}</td></tr>)}</tbody></table>{!data.invoices.length&&<p className="py-8 text-sm text-muted-foreground">No billing transactions yet.</p>}</div></section>
  </main>;
}