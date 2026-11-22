import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, Package, ShoppingBag, Users, Palette, ChartNoAxesCombined, Sparkles, MessageCircle,
  CreditCard, Bell, Settings, LogOut, Loader2, Menu, X, ShoppingBasket, ArrowUpRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/notification-bell";
import { Brand } from "@/components/storva-brand";
import { Button } from "@/components/ui/button";

/**
 * Authenticated merchant frame (new STORVA dashboard design).
 * Every merchant page (orders, products, billing, …) renders inside it. There is exactly one
 * sign-in system: the /login page. Signed-out visitors are sent there and return afterwards.
 */
const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, group: "STORE" },
  { to: "/products", label: "Products", icon: Package, group: "STORE" },
  { to: "/orders", label: "Orders", icon: ShoppingBag, group: "STORE" },
  { to: "/customers", label: "Customers", icon: Users, group: "STORE" },
  { to: "/design", label: "Store designer", icon: Palette, group: "GROW" },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined, group: "GROW" },
  { to: "/ai-studio", label: "AI studio", icon: Sparkles, group: "GROW" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, group: "GROW" },
  { to: "/billing", label: "Subscription & billing", icon: CreditCard, group: "MANAGE" },
  { to: "/notifications", label: "Notifications", icon: Bell, group: "MANAGE" },
  { to: "/settings", label: "Store settings", icon: Settings, group: "MANAGE" },
] as const;

export function StoreShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("My Store");
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (!active) return; setEmail(data.session?.user.email ?? null); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
      setReady(true);
      if (!session) client.clear();
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [client]);

  // Signed out: go to the single login page and come back to this page afterwards.
  useEffect(() => {
    if (ready && !email) void navigate({ to: "/login", search: { redirect: location.href }, replace: true });
  }, [ready, email, navigate, location.href]);

  // Store name for the sidebar (own profile row; protected by row-level security).
  useEffect(() => {
    if (!email) return;
    let active = true;
    supabase.from("profiles").select("store_name").maybeSingle().then(({ data }) => { if (active && data?.store_name) setStoreName(data.store_name); });
    return () => { active = false; };
  }, [email]);

  async function signOut() {
    await client.cancelQueries();
    client.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/login", replace: true });
  }

  if (!ready || !email) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="animate-spin text-primary" /></div>;

  const initial = email.trim().charAt(0).toUpperCase() || "S";
  const current = NAV.find(n => location.pathname === n.to || location.pathname.startsWith(`${n.to}/`));

  return <div className="dashboard">
    <aside className={`print-hidden ${open ? "dashboard-sidebar sidebar-open" : "dashboard-sidebar"}`}>
      <div className="sidebar-brand">
        <Link to="/" aria-label="STORVA home"><Brand /></Link>
        <Button variant="ghost" size="icon" aria-label="Close navigation" className="mobile-menu" onClick={() => setOpen(false)}><X /></Button>
      </div>
      <div className="store-switch"><span className="store-icon"><ShoppingBasket /></span><div><strong>{storeName}</strong><span>{email}</span></div></div>
      <nav aria-label="Store navigation">
        {(["STORE", "GROW", "MANAGE"] as const).map(group => <div className="nav-group" key={group}>
          <span className="nav-group-label">{group}</span>
          {NAV.filter(n => n.group === group).map(n => <Button asChild variant="ghost" key={n.to} className={current?.to === n.to ? "sidebar-link selected" : "sidebar-link"}>
            <Link to={n.to} onClick={() => setOpen(false)}><n.icon />{n.label}</Link>
          </Button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="plan-note"><div><strong>Room to grow.</strong></div><p>Compare plans, usage and invoices.</p>
          <Button asChild variant="outline"><Link to="/billing" onClick={() => setOpen(false)}>Subscription <ArrowUpRight /></Link></Button></div>
        <Button variant="ghost" className="sidebar-link" onClick={() => void signOut()}><LogOut />Log out</Button>
      </div>
    </aside>
    {open && <div className="sidebar-scrim print-hidden" onClick={() => setOpen(false)} />}
    <div className="dashboard-main">
      <header className="dashboard-top print-hidden">
        <div>
          <Button variant="ghost" size="icon" className="mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></Button>
          <span className="breadcrumb">{storeName} <span>/</span> <strong>{current?.label ?? "Workspace"}</strong></span>
        </div>
        <div className="dashboard-top-actions"><NotificationBell /><span className="user-avatar" title={email}>{initial}</span></div>
      </header>
      <main className="dashboard-content"><div className="workspace-slot">{children}</div>
        <footer className="dashboard-footer print-hidden"><span>© 2026 STORVA</span><span>Small steps. Real possibilities.</span></footer>
      </main>
    </div>
  </div>;
}
