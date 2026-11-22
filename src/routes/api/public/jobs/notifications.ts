import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Hourly job: re-queues stuck sends, queues daily summaries (after 9 am IST) and delivers everything due.
export const Route = createFileRoute("/api/public/jobs/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const prepared = await supabaseAdmin.rpc("prepare_outbox");
        if (prepared.error) return Response.json({ ok: false, error: "queue unavailable" }, { status: 503 });
        const { processOutbox } = await import("@/lib/notifications.server");
        const origin = new URL(request.url).origin;
        let total = { sent: 0, skipped: 0, retry: 0 };
        for (let i = 0; i < 5; i++) {
          const r = await processOutbox(20, origin);
          total = { sent: total.sent + r.sent, skipped: total.skipped + r.skipped, retry: total.retry + r.retry };
          if (r.sent + r.skipped + r.retry < 20) break;
        }
        return Response.json({ ok: true, due: prepared.data, ...total });
      },
    },
  },
});
