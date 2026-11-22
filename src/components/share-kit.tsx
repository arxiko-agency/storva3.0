import { useEffect, useState } from "react";
import { Download, QrCode, Share2, Copy, Facebook, Send, Mail, MessageCircle, Instagram } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { shareLinks } from "@/lib/share-rules";

/** QR code + one-tap share buttons for the merchant's shop link. */
export function ShareKit({ shopUrl, storeName, slug }: { shopUrl: string; storeName: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const links = shareLinks(shopUrl, storeName);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    import("qrcode").then(m => m.toDataURL(links.qr, { width: 640, margin: 2, errorCorrectionLevel: "M" })).then(url => { if (alive) setQr(url); }).catch(() => toast.error("Could not make the QR code."));
    return () => { alive = false; };
  }, [open, links.qr]);

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); } catch { toast.error("Could not copy."); }
  }
  async function nativeShare() {
    try { await navigator.share({ title: storeName, text: `Shop at ${storeName}`, url: links.qr.replace("utm_source=qr", "utm_source=share") }); } catch { /* cancelled */ }
  }
  const ext = { target: "_blank", rel: "noreferrer" } as const;

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><QrCode />QR & share</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>Share your shop</DialogTitle><DialogDescription>Print the QR code for your counter or packaging, or send the link. Analytics shows which one brought each visitor.</DialogDescription></DialogHeader>
      <div className="grid justify-items-center gap-3">
        {qr ? <img src={qr} alt={`QR code for ${storeName}`} className="size-56 rounded-md border border-border bg-card" /> : <div className="size-56 animate-pulse rounded-md bg-muted" aria-label="Making QR code" />}
        <Button asChild size="sm" variant="outline" disabled={!qr}><a href={qr ?? undefined} download={`${slug}-qr.png`}><Download />Download QR code</a></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline"><a href={links.whatsapp} {...ext}><MessageCircle />WhatsApp</a></Button>
        <Button asChild variant="outline"><a href={links.facebook} {...ext}><Facebook />Facebook</a></Button>
        <Button asChild variant="outline"><a href={links.telegram} {...ext}><Send />Telegram</a></Button>
        <Button asChild variant="outline"><a href={links.email}><Mail />Email</a></Button>
        <Button variant="outline" onClick={() => copy(links.instagramBio, "Instagram bio link")}><Instagram />Instagram bio link</Button>
        {typeof navigator !== "undefined" && "share" in navigator ? <Button variant="outline" onClick={nativeShare}><Share2 />More…</Button> : <Button variant="outline" onClick={() => copy(shopUrl, "Shop link")}><Copy />Copy link</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
