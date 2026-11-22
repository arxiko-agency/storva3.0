'use strict';
// Module 9: Gemini-powered product tools. The ONLY file that talks to Google's Generative Language API (REST, built-in fetch, no SDK).
// The API key stays on the server (GEMINI_API_KEY). Results are suggestions: nothing is saved to a product unless the owner applies it,
// except "create from photo", which creates a DRAFT (never visible to shoppers until the owner sets a price and activates it).
// Credits: each call reserves its cost atomically against the plan's monthly allowance and gives it back if the call fails.
const AiUsage = require('../models/AiUsage');
const AppError = require('../utils/AppError');
const { limitOf, planFor } = require('../config/plans');
const P = require('../utils/aiPrompts');

const cfg = () => ({ key: process.env.GEMINI_API_KEY || '', model: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/[^a-z0-9.\-]/gi, ''), timeoutMs: Math.min(60000, Number(process.env.GEMINI_TIMEOUT_MS) || 25000) });
const configured = () => Boolean(cfg().key);
// Asia/Kolkata calendar month, so credits reset at midnight IST on the 1st.
const monthKey = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 7);

let transport = null; // tests inject a fake: async ({ url, body }) => ({ status, json })
const setTransport = (fn) => { transport = fn; };

async function callGemini({ prompt, schema, image, temperature = 0.6 }) {
  const { key, model, timeoutMs } = cfg();
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.buffer.toString('base64') } });
  const body = { systemInstruction: { parts: [{ text: P.SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: schema } };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let status, json;
  try {
    if (transport) ({ status, json } = await transport({ url, body }));
    else {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      status = res.status; json = await res.json().catch(() => null);
    }
  } catch { throw new AppError('The AI service did not respond. Please try again.', 503, 'ai_unreachable'); }
  if (status === 429) throw new AppError('The AI service is busy right now. Please try again in a minute.', 503, 'ai_busy');
  if (status === 400 || status === 401 || status === 403) { console.error('[ai] Gemini rejected the request:', status, json && json.error && json.error.status); throw new AppError(status === 400 ? 'The AI could not process this request.' : 'The AI service is not set up correctly. Contact support.', status === 400 ? 422 : 503, 'ai_error'); }
  if (!status || status >= 500 || !json) throw new AppError('The AI service had a problem. Please try again.', 503, 'ai_error');
  const cand = json.candidates && json.candidates[0];
  if (!cand || (json.promptFeedback && json.promptFeedback.blockReason) || cand.finishReason === 'SAFETY') throw new AppError('The AI declined to write about this. Try different wording.', 422, 'ai_blocked');
  const text = cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
  try { return JSON.parse(text); } catch { throw new AppError('The AI returned an unreadable answer. Please try again.', 502, 'ai_bad_output'); }
}

async function creditsUsedThisMonth(storeId) {
  const row = await AiUsage.findOne({ store: storeId, month: monthKey() }).lean();
  return row ? row.credits : 0;
}

async function reserve(store, cost) {
  const limit = limitOf(store, 'aiCreditsPerMonth') || 0;
  const month = monthKey();
  await AiUsage.updateOne({ store: store._id, month }, { $setOnInsert: { store: store._id, month } }, { upsert: true }).catch((e) => { if (!(e && e.code === 11000)) throw e; });
  const r = await AiUsage.updateOne({ store: store._id, month, credits: { $lte: limit - cost } }, { $inc: { credits: cost, requests: 1 }, $set: { lastUsedAt: new Date() } });
  if (!r.matchedCount) {
    throw new AppError(`You have used all ${limit} AI credits for this month on the ${planFor(store).name} plan. Credits reset on the 1st${planFor(store).id !== 'advanced' ? ', or upgrade for more' : ''}.`, 402, 'ai_credits_exhausted', { details: { limit, currentPlan: planFor(store).id, requiredPlan: planFor(store).id === 'pro' ? 'advanced' : 'pro' } });
  }
  return { month, refund: () => AiUsage.updateOne({ store: store._id, month, credits: { $gte: cost } }, { $inc: { credits: -cost, failures: 1 } }) };
}

// tool: describe | improve | titles | tags | translate | caption | photo ; input: validated by readInput
async function run(store, tool, input, { image } = {}) {
  if (!configured()) throw new AppError('AI tools are not configured on this server yet (GEMINI_API_KEY is missing).', 503, 'ai_not_configured');
  const spec = P.build(tool, { ...input, storeName: store.name });
  if (!spec) throw new AppError('Unknown AI tool.', 404, 'not_found');
  if (tool === 'translate' && !spec.targets.length) throw new AppError('Choose at least one language.', 400, 'validation_error', { fields: { languages: 'Choose at least one language.' } });
  const cost = P.COSTS[tool];
  const r = await reserve(store, cost);
  try {
    const out = spec.parse(await callGemini({ prompt: spec.prompt, schema: spec.schema, image, temperature: tool === 'translate' ? 0.2 : 0.7 }));
    await AiUsage.updateOne({ store: store._id, month: r.month }, { $inc: { [`byTool.${tool}`]: 1 } });
    return { result: out, creditsUsed: cost, creditsLeft: Math.max(0, (limitOf(store, 'aiCreditsPerMonth') || 0) - (await creditsUsedThisMonth(store._id))) };
  } catch (e) { await r.refund().catch(() => {}); throw e; }
}

function readInput(b) {
  const o = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  const s = (v, max) => (typeof v === 'string' ? P.clean(v, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const input = { title: s(o.title, 120), category: s(o.category, 60), keywords: s(o.keywords, 500), description: s(o.description, 3000), price: s(o.price, 12).replace(/[^0-9.]/g, ''),
    language: P.LANGUAGES[o.language] ? o.language : 'en', tone: P.TONES[o.tone] ? o.tone : 'friendly', length: P.LENGTHS[o.length] ? o.length : 'medium',
    languages: Array.isArray(o.languages) ? o.languages.filter((l) => typeof l === 'string' && P.LANGUAGES[l]).slice(0, 4) : [] };
  return input;
}
function requireBasics(tool, input) {
  const fields = {};
  if (['describe', 'titles', 'tags', 'caption'].includes(tool) && !input.title && !input.keywords) fields.title = 'Enter a title or a few words about the product first.';
  if (['improve', 'translate'].includes(tool) && !input.description && !input.title) fields.description = 'Write or generate a description first.';
  if (Object.keys(fields).length) throw new AppError('A little more information is needed.', 400, 'validation_error', { fields });
}

module.exports = { run, readInput, requireBasics, configured, creditsUsedThisMonth, monthKey, setTransport, callGemini };
