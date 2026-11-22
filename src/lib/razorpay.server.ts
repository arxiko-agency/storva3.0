// Server-only Razorpay helpers. Uses fetch + Web Crypto so it runs on Workers.
const BASE = "https://api.razorpay.com/v1";

export function razorpayKeys() {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export async function rz<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const keys = razorpayKeys();
  if (!keys) throw new Error("PAYMENTS_NOT_CONFIGURED");
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${btoa(`${keys.keyId}:${keys.keySecret}`)}`,
      "Content-Type": "application/json",
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    console.error("Razorpay error", path, res.status, json);
    throw new Error(json?.error?.description ?? `Razorpay request failed (${res.status})`);
  }
  return json as T;
}

export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const unixToIso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
