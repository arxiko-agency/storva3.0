'use strict';

const crypto = require('crypto');
const StoreDesign = require('../models/StoreDesign');
const {
  THEME_PRESETS,
  createDefaultDesign,
  getGoogleFontHref,
  designToCss,
  listPresetsPublic,
  listFontsPublic,
  listSectionTypesPublic,
  cloneJson,
  hasOwn,
} = require('../utils/themes');
const { validateDesignInput, cleanText } = require('../utils/designInput');

const MAX_HISTORY_VERSIONS = 15;

const AppError = require('../utils/AppError');
// Same error shape as the rest of the API ({ error: { code, message, fields } }), so the dashboard can show per-field messages.
function makeError(status, code, message, errors) {
  const err = new AppError(message, status, code, errors ? { fields: errors } : {});
  if (errors) err.errors = errors;
  return err;
}

function toPlainSnapshot(snap) {
  const def = createDefaultDesign();
  if (!snap) return def;
  const raw = typeof snap.toObject === 'function' ? snap.toObject() : snap;
  return {
    themePreset: raw.themePreset || def.themePreset,
    colors: { ...def.colors, ...(raw.colors || {}) },
    typography: { ...def.typography, ...(raw.typography || {}) },
    layout: { ...def.layout, ...(raw.layout || {}) },
    sections: Array.isArray(raw.sections) && raw.sections.length > 0 ? cloneJson(raw.sections) : def.sections,
  };
}

function serializeOwnerDesign(doc, store) {
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const history = Array.isArray(plain.history)
    ? plain.history.map((h) => ({
        versionId: h.versionId,
        versionNumber: h.versionNumber,
        label: h.label,
        publishedAt: h.publishedAt,
      }))
    : [];

  return {
    storeId: String(plain.store || store._id),
    draft: toPlainSnapshot(plain.draft),
    published: toPlainSnapshot(plain.published),
    publishedVersion: plain.publishedVersion || 1,
    publishedAt: plain.publishedAt || plain.updatedAt || null,
    draftUpdatedAt: plain.draftUpdatedAt || plain.updatedAt || null,
    hasUnpublishedChanges: Boolean(plain.hasUnpublishedChanges),
    history,
  };
}

async function getOrInitDesign(storeId, Model = StoreDesign) {
  if (!storeId) throw makeError(400, 'invalid_store', 'Store id is required');
  let doc = await Model.findOne({ store: storeId });
  if (doc) return doc;

  const initial = createDefaultDesign();
  const now = new Date();
  doc = await Model.findOneAndUpdate(
    { store: storeId },
    {
      $setOnInsert: {
        store: storeId,
        draft: initial,
        published: cloneJson(initial),
        publishedVersion: 1,
        publishedAt: now,
        draftUpdatedAt: now,
        hasUnpublishedChanges: false,
        history: [],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function getOwnerDesignPayload(store, Model = StoreDesign) {
  const doc = await getOrInitDesign(store._id, Model);
  return {
    design: serializeOwnerDesign(doc, store),
    presets: listPresetsPublic(),
    fonts: listFontsPublic(),
    sectionTypes: listSectionTypesPublic(),
    previewUrl: `/store/${encodeURIComponent(store.slug)}?preview=draft`,
    liveUrl: `/store/${encodeURIComponent(store.slug)}`,
  };
}

async function getPublicStoreDesign(storeId, { previewDraft = false } = {}, Model = StoreDesign) {
  let doc = null;
  if (storeId) {
    doc = await Model.findOne({ store: storeId }).lean();
  }
  const activeRaw = doc ? (previewDraft ? doc.draft : doc.published) : createDefaultDesign();
  const active = toPlainSnapshot(activeRaw);
  const versionTag = doc
    ? previewDraft
      ? `d-${new Date(doc.draftUpdatedAt || doc.updatedAt || Date.now()).getTime()}`
      : `p-${doc.publishedVersion || 1}`
    : 'p-1';

  return {
    design: active,
    css: designToCss(active),
    cssVersion: versionTag,
    fontHref: getGoogleFontHref(active.typography.fontId),
    isPreview: Boolean(previewDraft),
  };
}

async function updateDraft(store, input, Model = StoreDesign) {
  const doc = await getOrInitDesign(store._id, Model);
  const currentDraft = toPlainSnapshot(doc.draft);
  const check = validateDesignInput(input, currentDraft);
  if (!check.ok) {
    throw makeError(400, 'validation_error', 'Please check the design settings', check.errors);
  }

  const now = new Date();
  const updated = await Model.findOneAndUpdate(
    { store: store._id },
    {
      $set: {
        draft: check.value,
        draftUpdatedAt: now,
        hasUnpublishedChanges: true,
      },
    },
    { new: true }
  );

  return { design: serializeOwnerDesign(updated, store) };
}

async function applyPreset(store, { presetId, replaceSections = false } = {}, Model = StoreDesign) {
  const presetKey = String(presetId || '').trim();
  const preset = hasOwn(THEME_PRESETS, presetKey) ? THEME_PRESETS[presetKey] : null;
  if (!preset) {
    throw makeError(400, 'invalid_preset', 'Selected theme preset does not exist', {
      presetId: 'Choose a valid theme preset',
    });
  }

  const doc = await getOrInitDesign(store._id, Model);
  const currentDraft = toPlainSnapshot(doc.draft);
  const nextDraft = {
    themePreset: preset.id,
    colors: cloneJson(preset.colors),
    typography: cloneJson(preset.typography),
    layout: cloneJson(preset.layout),
    sections: replaceSections ? createDefaultDesign().sections : currentDraft.sections,
  };

  const now = new Date();
  const updated = await Model.findOneAndUpdate(
    { store: store._id },
    {
      $set: {
        draft: nextDraft,
        draftUpdatedAt: now,
        hasUnpublishedChanges: true,
      },
    },
    { new: true }
  );

  return { design: serializeOwnerDesign(updated, store) };
}

async function publishDraft(store, { userId = null, label = '', maxHistory = MAX_HISTORY_VERSIONS } = {}, Model = StoreDesign) {
  const doc = await getOrInitDesign(store._id, Model);
  const currentDraft = toPlainSnapshot(doc.draft);
  const check = validateDesignInput(currentDraft, currentDraft);
  if (!check.ok) {
    throw makeError(
      400,
      'invalid_draft',
      'Draft could not be published because it has validation errors. Your live storefront was kept unchanged.',
      check.errors
    );
  }

  const priorPublished = toPlainSnapshot(doc.published);
  const priorVersion = doc.publishedVersion || 1;
  const now = new Date();

  const historySnapshot = {
    versionId: `ver_${crypto.randomBytes(6).toString('hex')}`,
    versionNumber: priorVersion,
    label: cleanText(label, 80) || `Version ${priorVersion}`,
    publishedAt: doc.publishedAt || now,
    publishedBy: doc.publishedBy || null, // who published the version being archived
    snapshot: priorPublished,
  };

  const keep = Math.max(1, Math.min(MAX_HISTORY_VERSIONS, Number(maxHistory) || MAX_HISTORY_VERSIONS)); // plan-dependent (Module 8)
  const nextHistory = [historySnapshot, ...(Array.isArray(doc.history) ? doc.history : [])].slice(0, keep);

  const updated = await Model.findOneAndUpdate(
    { store: store._id, publishedVersion: priorVersion },
    {
      $set: {
        draft: check.value,
        published: cloneJson(check.value),
        publishedVersion: priorVersion + 1,
        publishedAt: now,
        publishedBy: userId || null,
        hasUnpublishedChanges: false,
        history: nextHistory,
      },
    },
    { new: true }
  );

  if (!updated) {
    throw makeError(409, 'publish_conflict', 'Another publish completed at the same time. Refresh and try again.');
  }

  return { design: serializeOwnerDesign(updated, store) };
}

async function discardDraft(store, Model = StoreDesign) {
  const doc = await getOrInitDesign(store._id, Model);
  const live = toPlainSnapshot(doc.published);
  const now = new Date();

  const updated = await Model.findOneAndUpdate(
    { store: store._id },
    {
      $set: {
        draft: live,
        draftUpdatedAt: now,
        hasUnpublishedChanges: false,
      },
    },
    { new: true }
  );

  return { design: serializeOwnerDesign(updated, store) };
}

async function resetDraftToDefault(store, Model = StoreDesign) {
  await getOrInitDesign(store._id, Model);
  const def = createDefaultDesign();
  const now = new Date();

  const updated = await Model.findOneAndUpdate(
    { store: store._id },
    {
      $set: {
        draft: def,
        draftUpdatedAt: now,
        hasUnpublishedChanges: true,
      },
    },
    { new: true }
  );

  return { design: serializeOwnerDesign(updated, store) };
}

async function restoreVersion(store, { versionId, publishNow = false, userId = null, maxHistory } = {}, Model = StoreDesign) {
  const vid = String(versionId || '').trim();
  if (!vid) {
    throw makeError(400, 'invalid_version', 'Version id is required');
  }

  const doc = await getOrInitDesign(store._id, Model);
  const entry = (doc.history || []).find((h) => h.versionId === vid);
  if (!entry) {
    throw makeError(404, 'version_not_found', 'Saved design version was not found');
  }

  const restoredRaw = toPlainSnapshot(entry.snapshot);
  const check = validateDesignInput(restoredRaw, restoredRaw);
  if (!check.ok) {
    throw makeError(400, 'invalid_snapshot', 'Saved version failed validation and could not be restored', check.errors);
  }

  const now = new Date();
  await Model.findOneAndUpdate(
    { store: store._id },
    {
      $set: {
        draft: check.value,
        draftUpdatedAt: now,
        hasUnpublishedChanges: true,
      },
    },
    { new: true }
  );

  if (publishNow) {
    return publishDraft(store, { userId, label: `Restored v${entry.versionNumber}`, maxHistory }, Model);
  }

  const fresh = await Model.findOne({ store: store._id });
  return { design: serializeOwnerDesign(fresh, store) };
}

module.exports = {
  MAX_HISTORY_VERSIONS,
  toPlainSnapshot,
  serializeOwnerDesign,
  getOrInitDesign,
  getOwnerDesignPayload,
  getPublicStoreDesign,
  updateDraft,
  applyPreset,
  publishDraft,
  discardDraft,
  resetDraftToDefault,
  restoreVersion,
};
