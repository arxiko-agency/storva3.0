'use strict';
// record(req, action, { store, targetType, targetId, meta }) writes one audit row. It NEVER throws and never blocks the caller:
// a failed audit write is logged (and counted by the error monitor) but must not break a refund or a login.

const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const SECRET_KEYS = /pass|token|secret|otp|code|signature|authorization|cookie/i;

// Keeps meta small and strips anything that looks like a credential.
function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta).slice(0, 12)) {
    if (SECRET_KEYS.test(k)) continue;
    out[clip(k, 30)] = typeof v === 'number' || typeof v === 'boolean' ? v : clip(v, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

async function record(req, action, { store = null, storeId = null, targetType = '', targetId = '', meta, actorType, actor } = {}) {
  try {
    const sid = store && store._id ? store._id : storeId || (req && req.store ? req.store._id : null);
    const user = actor || (req && req.user ? req.user._id : null);
    await require('../models/AuditLog').create({
      store: sid, actorType: actorType || (user ? 'user' : 'system'), actor: user || null, action: clip(action, 60),
      targetType: clip(targetType, 30), targetId: clip(targetId, 60), requestId: clip(req && req.id, 64), ip: clip(req && req.ip, 64), meta: cleanMeta(meta),
    });
    return true;
  } catch (e) {
    try { require('./monitor').captureError(e, { kind: 'audit', action }); } catch { /* monitoring must not throw either */ }
    return false;
  }
}

module.exports = { record, cleanMeta };
