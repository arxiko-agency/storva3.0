import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listNotifications, markNotificationsRead } from "@/lib/notifications.functions";

export function NotificationBell() {
  const list = useServerFn(listNotifications), mark = useServerFn(markNotificationsRead);
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => list() });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null, cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      channel = supabase.channel(`notifications-${data.user.id}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `owner_id=eq.${data.user.id}` }, () => client.invalidateQueries({ queryKey: ["notifications"] }))
        .subscribe();
    });
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [client]);
  const unread = (q.data ?? []).filter(n => !n.read_at);
  async function markAll() { await mark({ data: {} }); await client.invalidateQueries({ queryKey: ["notifications"] }); }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" className="relative" aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}><Bell />{unread.length > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-5 text-destructive-foreground">{unread.length > 99 ? "99+" : unread.length}</span>}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="font-semibold">Notifications</p>{unread.length > 0 && <Button size="sm" variant="ghost" onClick={markAll}>Mark all read</Button>}</div>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">{(q.data ?? []).slice(0, 8).map(n => <li key={n.id} className={n.read_at ? "" : "bg-accent/50"}><Link to={(n.link as "/orders") ?? "/notifications"} onClick={() => { setOpen(false); if (!n.read_at) mark({ data: { ids: [n.id] } }).then(() => client.invalidateQueries({ queryKey: ["notifications"] })); }} className="block px-4 py-3 text-sm hover:bg-muted"><span className="font-medium">{n.title}</span><span className="block text-xs text-muted-foreground">{n.body} · {new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</span></Link></li>)}
        {!q.data?.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}</ul>
      <div className="border-t border-border p-2"><Button variant="ghost" size="sm" className="w-full" asChild><Link to="/notifications" onClick={() => setOpen(false)}>See all & delivery log</Link></Button></div>
    </PopoverContent>
  </Popover>;
}
