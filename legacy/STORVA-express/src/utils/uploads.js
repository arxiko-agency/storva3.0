'use strict';
// Shared image saving for uploads that are not product images (designer banners, WhatsApp photos). Same rules as Module 4:
// magic-byte check, server-chosen random file name, one folder per store, never the client's file name.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { env } = require('../config/env');
const { sniffImage } = require('./productInput');
const AppError = require('./AppError');

const MAX_BYTES = 5 * 1024 * 1024;

async function saveStoreImage(storeId, buffer, { prefix = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new AppError('Send the image as the raw request body (JPEG, PNG or WebP, max 5 MB).', 415, 'bad_image');
  if (buffer.length > MAX_BYTES) throw new AppError('Images can be up to 5 MB.', 413, 'too_large');
  const kind = sniffImage(buffer);
  if (!kind) throw new AppError('That file is not a valid JPEG, PNG or WebP image.', 415, 'bad_image');
  const dir = path.join(env.uploadDir, String(storeId));
  await fs.promises.mkdir(dir, { recursive: true });
  const safePrefix = String(prefix).replace(/[^a-z0-9]/g, '').slice(0, 12);
  const name = `${safePrefix ? safePrefix + '-' : ''}${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  await fs.promises.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
  return { url: `/uploads/${storeId}/${name}`, ext: kind.ext, mime: kind.mime || `image/${kind.ext === 'jpg' ? 'jpeg' : kind.ext}`, bytes: buffer.length };
}

// Reads a file that belongs to this store's upload folder (used to send a product photo to the AI). Returns null for anything else.
async function readStoreImage(storeId, url) {
  const prefix = `/uploads/${storeId}/`;
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const name = path.basename(url);
  if (!/^[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(name)) return null;
  try { return await fs.promises.readFile(path.join(env.uploadDir, String(storeId), name)); } catch { return null; }
}

async function removeStoreFile(storeId, url) {
  const prefix = `/uploads/${storeId}/`;
  if (typeof url !== 'string' || !url.startsWith(prefix)) return;
  const name = path.basename(url);
  await fs.promises.rm(path.join(env.uploadDir, String(storeId), name), { force: true }).catch(() => {});
}

module.exports = { saveStoreImage, readStoreImage, removeStoreFile, MAX_BYTES };
