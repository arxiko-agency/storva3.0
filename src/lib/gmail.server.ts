const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

export function gmailConfigured() {
  return Boolean(process.env['GOOGLE_MAIL_API_KEY'] && process.env['LOVABLE_API_KEY']);
}

const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join(""));
const header = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

/** Sends one email from the connected Gmail account. Throws with the provider's status/body on failure. */
export async function sendGmail({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const key = process.env['GOOGLE_MAIL_API_KEY'];
  const gatewayKey = process.env['LOVABLE_API_KEY'];
  if (!key || !gatewayKey) throw new Error("Gmail is not connected.");
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error("Invalid email header.");
  const boundary = `storva_${crypto.randomUUID()}`;
  const raw = [
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
  ].join("\r\n");
  const response = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${gatewayKey}`, "X-Connection-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Gmail send failed [${response.status}]: ${body}`);
    throw new Error(`Gmail send failed [${response.status}]: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as { id: string };
}
