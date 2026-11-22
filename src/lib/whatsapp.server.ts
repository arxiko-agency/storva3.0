const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";

export function whatsappConfigured() {
  return Boolean(process.env['WHATSAPP_API_KEY'] && process.env['LOVABLE_API_KEY']);
}

export async function whatsappRequest<T>(path: string, body?: unknown): Promise<T> {
  const key = process.env['WHATSAPP_API_KEY'];
  const gatewayKey = process.env['LOVABLE_API_KEY'];
  if (!key || !gatewayKey) throw new Error("WhatsApp is not connected. Connect your Business number in Lovable.");
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": key, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`WhatsApp request failed [${response.status}]: ${errorBody}`);
    throw new Error(`WhatsApp request failed [${response.status}]: ${errorBody}`);
  }
  return response.json() as Promise<T>;
}