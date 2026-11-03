// PhotoStore (bound to a local directory). Photos arrive as data URLs that the browser has
// already resized; they are written once and never rewritten.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { invalid } from './errors.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_PHOTOS_PER_NOTE = 4;

export function savePhoto(uploadsDir, dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!match) throw invalid('Photos need to be JPEG, PNG or WebP images.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw invalid('That photo looks empty.');
  if (bytes.length > MAX_PHOTO_BYTES) throw invalid('That photo is too large (4 MB at most).');
  mkdirSync(uploadsDir, { recursive: true });
  const name = `${randomUUID()}.${TYPES[match[1]]}`;
  writeFileSync(join(uploadsDir, name), bytes);
  return name;
}

export function savePhotos(uploadsDir, list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw invalid('Photos should be a list.');
  if (list.length > MAX_PHOTOS_PER_NOTE) throw invalid(`Add at most ${MAX_PHOTOS_PER_NOTE} photos.`);
  return list.map((p) => savePhoto(uploadsDir, p));
}

export const photoUrl = (name) => (name ? `/uploads/${name}` : null);
