/**
 * Public pricing data helpers (pure: safe to import from both the browser and the server).
 * Plans always come from the `plans` table; nothing here supplies a price of its own.
 */
export interface PublicPlan {
  id: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  product_limit: number | null;
  order_limit: number | null;
  storage_mb: number;
  ai_limit: number;
  trial_days: number;
  features: string[];
  sort: number;
}

export const PLAN_COLUMNS = 'id,name,price_monthly,price_yearly,product_limit,order_limit,storage_mb,ai_limit,trial_days,features,sort';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Turns raw rows into plans, and throws if any row is unusable so a half-broken price is never shown. */
export function normalizePlans(rows: unknown): PublicPlan[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No plans returned.');
  return rows.map((r: Record<string, unknown>) => {
    const plan: PublicPlan = {
      id: String(r.id),
      name: String(r.name),
      price_monthly: Number(r.price_monthly),
      price_yearly: Number(r.price_yearly),
      product_limit: num(r.product_limit),
      order_limit: num(r.order_limit),
      storage_mb: Number(r.storage_mb),
      ai_limit: Number(r.ai_limit),
      trial_days: Number(r.trial_days ?? 0),
      features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === 'string') : [],
      sort: Number(r.sort ?? 0),
    };
    if (!plan.id || !plan.name || !Number.isFinite(plan.price_monthly) || !Number.isFinite(plan.price_yearly) || !Number.isFinite(plan.storage_mb) || !Number.isFinite(plan.ai_limit)) {
      throw new Error('A plan row is incomplete.');
    }
    return plan;
  }).sort((a, b) => a.sort - b.sort);
}

/** Rejects if `work` takes longer than `ms`, so the page never sits on "loading" forever. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out.')), ms);
    work.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Yearly saving as a whole percent, only when the yearly price really is lower than 12 x monthly. */
export function yearlySavingPercent(p: Pick<PublicPlan, 'price_monthly' | 'price_yearly'>): number {
  const full = p.price_monthly * 12;
  if (full <= 0 || p.price_yearly >= full) return 0;
  return Math.round(((full - p.price_yearly) / full) * 100);
}
