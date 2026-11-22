'use strict';

const mongoose = require('mongoose');
const tenantScopedMod = require('./tenantScoped');
const { createDefaultDesign } = require('../utils/themes');

const tenantScoped = tenantScopedMod;
const { registerCascade } = require('../middleware/tenant');

const SectionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 40 },
    type: {
      type: String,
      required: true,
      enum: [
        'hero',
        'promo_banner',
        'collections_bar',
        'featured_products',
        'catalog_grid',
        'about_story',
        'trust_badges',
        'contact_cta',
      ],
    },
    enabled: { type: Boolean, default: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const DesignSnapshotSchema = new mongoose.Schema(
  {
    themePreset: { type: String, default: 'storva_classic', maxlength: 40 },
    colors: {
      primary: { type: String, default: '#6c4cf5' },
      accent: { type: String, default: '#ffb22e' },
      background: { type: String, default: '#f7f8fc' },
      surface: { type: String, default: '#ffffff' },
      text: { type: String, default: '#14122b' },
      muted: { type: String, default: '#6b6a85' },
      heroBg: { type: String, default: '#14122b' },
      heroText: { type: String, default: '#ffffff' },
    },
    typography: {
      fontId: { type: String, default: 'bricolage' },
      headingWeight: { type: String, enum: ['700', '800'], default: '800' },
      baseSizePx: { type: Number, default: 16, min: 14, max: 18 },
    },
    layout: {
      headerStyle: { type: String, enum: ['sticky', 'minimal', 'centered'], default: 'sticky' },
      heroStyle: { type: String, enum: ['split', 'banner', 'compact'], default: 'split' },
      cardStyle: { type: String, enum: ['elevated', 'bordered', 'flat'], default: 'elevated' },
      radius: { type: String, enum: ['sharp', 'rounded', 'pill'], default: 'rounded' },
      gridColsDesktop: { type: Number, enum: [2, 3, 4], default: 4 },
      gridColsMobile: { type: Number, enum: [1, 2], default: 2 },
      showSearch: { type: Boolean, default: true },
      showWhatsapp: { type: Boolean, default: true },
    },
    sections: { type: [SectionSchema], default: () => createDefaultDesign().sections },
  },
  { _id: false }
);

const HistoryEntrySchema = new mongoose.Schema(
  {
    versionId: { type: String, required: true, maxlength: 48 },
    versionNumber: { type: Number, required: true, min: 1 },
    label: { type: String, default: 'Published design', maxlength: 80 },
    publishedAt: { type: Date, required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    snapshot: { type: DesignSnapshotSchema, required: true },
  },
  { _id: false }
);

const StoreDesignSchema = new mongoose.Schema(
  {
    draft: { type: DesignSnapshotSchema, default: () => createDefaultDesign() },
    published: { type: DesignSnapshotSchema, default: () => createDefaultDesign() },
    publishedVersion: { type: Number, default: 1, min: 1 },
    publishedAt: { type: Date, default: () => new Date() },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    draftUpdatedAt: { type: Date, default: () => new Date() },
    hasUnpublishedChanges: { type: Boolean, default: false },
    history: { type: [HistoryEntrySchema], default: [] },
  },
  { timestamps: true }
);

StoreDesignSchema.plugin(tenantScoped, { uniqueStore: true });


const StoreDesign = mongoose.models.StoreDesign || mongoose.model('StoreDesign', StoreDesignSchema);

// Deleting a store removes its design (the earlier fallback lookup never found registerCascade, so designs were orphaned).
registerCascade(async (storeId) => { await StoreDesign.deleteMany({ store: storeId }); });

module.exports = StoreDesign;
