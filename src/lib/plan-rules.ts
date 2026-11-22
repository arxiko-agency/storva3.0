export type PlanId = "free" | "starter" | "pro";
export type BillingInterval = "monthly" | "yearly";
export type Feature = "basic_ai" | "image_ai" | "marketing_ai" | "recommendations";

export interface PlanRow {
  id: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  product_limit: number | null;
  order_limit: number | null;
  storage_mb: number;
  ai_limit: number;
  trial_days: number;
  features: unknown;
  sort: number;
}

export const FEATURE_LABELS: Record<Feature, string> = {
  basic_ai: "AI titles, descriptions, SEO, categories & price suggestions",
  image_ai: "Product details from photos",
  marketing_ai: "Marketing copy & social captions",
  recommendations: "AI product recommendations",
};

export const AI_KIND_FEATURE: Record<string, Feature> = {
  title: "basic_ai",
  description: "basic_ai",
  seo: "basic_ai",
  category: "basic_ai",
  image_extract: "image_ai",
  marketing: "marketing_ai",
  social: "marketing_ai",
  recommendations: "recommendations",
};

export function planFeatures(plan: Pick<PlanRow, "features">): Feature[] {
  return Array.isArray(plan.features) ? (plan.features as Feature[]) : [];
}

export function hasFeature(plan: Pick<PlanRow, "features">, feature: Feature) {
  return planFeatures(plan).includes(feature);
}

/** null limit = unlimited */
export function withinLimit(limit: number | null, used: number) {
  return limit === null || used < limit;
}

/** Monthly-equivalent price in paise, used to decide upgrade vs downgrade. */
export function monthlyEquivalent(plan: Pick<PlanRow, "price_monthly" | "price_yearly">, interval: BillingInterval) {
  return interval === "yearly" ? plan.price_yearly / 12 : plan.price_monthly;
}

/** Upgrades apply immediately; downgrades wait for the next renewal. */
export function isUpgrade(
  from: Pick<PlanRow, "price_monthly" | "price_yearly">,
  fromInterval: BillingInterval,
  to: Pick<PlanRow, "price_monthly" | "price_yearly">,
  toInterval: BillingInterval,
) {
  return monthlyEquivalent(to, toInterval) > monthlyEquivalent(from, fromInterval);
}

export function formatINR(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

export function formatLimit(n: number | null, unit = "") {
  return n === null ? "Unlimited" : `${n.toLocaleString("en-IN")}${unit}`;
}

export function formatStorage(mb: number) {
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`;
}

/** Days of grace after a failed renewal before falling back to Free. */
export const PAST_DUE_GRACE_DAYS = 7;
