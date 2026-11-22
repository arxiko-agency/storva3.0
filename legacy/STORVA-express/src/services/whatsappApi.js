'use strict';
// Module 10: the ONLY file that talks to the WhatsApp Cloud API (Meta Graph API, built-in fetch, no SDK).
// Errors are classified so the outbox knows whether a retry can help: definite = true means "do not retry" (bad number, template
// not approved, outside the 24-hour window, opted out); definite = false means a temporary problem (network, 5xx, rate limit).
const graphVersion = () => (process.env.WHATSAPP_GRAPH_VERSION || 'v21.0').replace(/[^a-z0-9.]/gi, '');
const GRAPH = () => `https://graph.facebook.com/${graphVersion()}`;

let transport = null; // tests: async ({ method, url, headers, body }) => ({ status, json, buffer? })
const setTransport = (fn) => { transport = fn; };

async function http(method, url, token, body, { binary = false, timeoutMs = 15000 } = {}) {
  const headers = { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) };
  if (transport) return transport({ method, url, headers, body });
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  if (binary) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
  return { status: res.status, json: await res.json().catch(() => null) };
}

class WaError extends Error { constructor(msg, definite, code) { super(msg); this.definite = definite; this.waCode = code; } }
const DEFINITE_CODES = new Set([131026, 131047, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 131008, 131009, 100, 190, 10, 200]);

// WhatsApp template parameters may not contain newlines, tabs or more than 4 spaces in a row; max ~1024 chars.
const tplParam = (v) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '-';

function buildBody(to, payload) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (payload.type === 'template') return { ...base, type: 'template', template: { name: payload.name, language: { code: payload.language || 'en' }, components: payload.params && payload.params.length ? [{ type: 'body', parameters: payload.params.map((t) => ({ type: 'text', text: tplParam(t) })) }] : [] } };
  if (payload.type === 'image') return { ...base, type: 'image', image: { link: payload.link, ...(payload.caption ? { caption: String(payload.caption).slice(0, 1000) } : {}) } };
  return { ...base, type: 'text', text: { body: String(payload.text || '').slice(0, 4096), preview_url: payload.previewUrl !== false } };
}

async function sendMessage({ phoneNumberId, token, to, payload }) {
  let r;
  try { r = await http('POST', `${GRAPH()}/${encodeURIComponent(phoneNumberId)}/messages`, token, buildBody(to, payload)); }
  catch { throw new WaError('Could not reach WhatsApp', false); }
  const id = r.json && Array.isArray(r.json.messages) && r.json.messages[0] && r.json.messages[0].id;
  if (r.status >= 200 && r.status < 300 && id) return { id };
  const err = (r.json && r.json.error) || {};
  const code = Number(err.code) || 0;
  const msg = String(err.error_user_msg || err.message || `HTTP ${r.status}`).slice(0, 200);
  const definite = r.status !== 429 && r.status < 500 && (DEFINITE_CODES.has(code) || (r.status >= 400 && r.status < 500 && code !== 4 && code !== 80007 && code !== 130429));
  throw new WaError(msg, definite, code);
}

async function getPhoneInfo(phoneNumberId, token) {
  const r = await http('GET', `${GRAPH()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, token);
  if (r.status !== 200 || !r.json || !r.json.display_phone_number) throw new WaError((r.json && r.json.error && r.json.error.message) || 'WhatsApp did not accept these details', true);
  return { displayPhone: r.json.display_phone_number, verifiedName: r.json.verified_name || '' };
}

// Media sent to us (product photos): first resolve the id to a short-lived URL, then download it with the same token.
async function downloadMedia(mediaId, token, { maxBytes = 5 * 1024 * 1024 } = {}) {
  const meta = await http('GET', `${GRAPH()}/${encodeURIComponent(mediaId)}`, token);
  if (meta.status !== 200 || !meta.json || !meta.json.url) throw new WaError('Could not find that media on WhatsApp', true);
  if (meta.json.file_size && meta.json.file_size > maxBytes) throw new WaError('That photo is larger than 5 MB', true);
  const url = String(meta.json.url);
  if (!/^https:\/\/([a-z0-9-]+\.)*(fbcdn\.net|whatsapp\.net|facebook\.com|fbsbx\.com)\//i.test(url)) throw new WaError('Unexpected media location', true); // never fetch arbitrary hosts with our token
  const bin = await http('GET', url, token, null, { binary: true, timeoutMs: 20000 });
  if (bin.status !== 200 || !bin.buffer) throw new WaError('Could not download that photo', false);
  if (bin.buffer.length > maxBytes) throw new WaError('That photo is larger than 5 MB', true);
  return { buffer: bin.buffer, mime: meta.json.mime_type || bin.contentType };
}

async function markRead(phoneNumberId, token, messageId) {
  try { await http('POST', `${GRAPH()}/${encodeURIComponent(phoneNumberId)}/messages`, token, { messaging_product: 'whatsapp', status: 'read', message_id: messageId }); } catch { /* best effort */ }
}

module.exports = { sendMessage, getPhoneInfo, downloadMedia, markRead, buildBody, tplParam, setTransport, WaError, GRAPH };
