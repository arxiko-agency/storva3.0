import { createFileRoute } from "@tanstack/react-router";

// Public readiness check. Reports only whether each dependency is reachable/configured — never values.
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        let database = false;
        try {
          const { publicDb } = await import("@/lib/public-db.server");
          const { error } = await publicDb().from("plans").select("id").limit(1);
          database = !error;
        } catch { database = false; }
        const env = (k: string) => Boolean(process.env[k]);
        const body = {
          status: database ? "ok" : "degraded",
          checks: {
            database,
            ai: env("LOVABLE_API_KEY"),
            email: env("GOOGLE_MAIL_API_KEY") && env("LOVABLE_API_KEY"),
            whatsapp: env("WHATSAPP_API_KEY") && env("LOVABLE_API_KEY"),
            payments: env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET"),
            paymentWebhook: env("RAZORPAY_WEBHOOK_SECRET"),
          },
          ms: Date.now() - started,
        };
        return Response.json(body, { status: database ? 200 : 503, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
