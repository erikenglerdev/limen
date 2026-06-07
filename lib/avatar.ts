// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getEnv } from './env';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const SIZE = 256;

function uploadDir(): string {
  return getEnv().UPLOAD_DIR;
}

/**
 * Erlaubt nur echte Rasterbilder anhand der Magic-Bytes (Content-Type ist spoofbar).
 * Wichtig: schließt SVG aus. SVG würde sonst von sharp/libvips gerendert, was je nach
 * SVG-Loader über externe Referenzen (z. B. <image href="file://…"/>) eine Local-File-
 * Read-/SSRF-Fläche eröffnen könnte. JPEG/PNG/GIF/WebP werden anschließend ohnehin neu
 * zu WebP kodiert.
 */
function isAllowedRaster(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return true;
  }
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/**
 * Verarbeitet ein hochgeladenes Bild: quadratischer Center-Crop, 256px, WebP.
 * Speichert als `<userId>.webp` im UPLOAD_DIR und liefert den Dateinamen.
 */
export async function saveAvatar(userId: string, buffer: Buffer): Promise<string> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error('Die Datei ist zu groß (max. 5 MB).');
  }
  // Magic-Bytes-Allowlist VOR sharp: nur echte Rasterbilder, kein SVG.
  if (!isAllowedRaster(buffer)) {
    throw new Error('Nicht unterstütztes Bildformat (nur PNG, JPEG, WebP, GIF).');
  }
  const dir = uploadDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${userId}.webp`;
  // limitInputPixels begrenzt die Bildfläche → Schutz vor „Decompression-Bomb"-DoS
  // (kleine Datei, riesige deklarierte Maße). 100 MP erlaubt auch hochauflösende Fotos.
  await sharp(buffer, { limitInputPixels: 100_000_000 })
    .rotate() // EXIF-Orientierung berücksichtigen
    .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toFile(path.join(dir, filename));
  return filename;
}

export async function deleteAvatar(filename: string): Promise<void> {
  const dir = uploadDir();
  await fs.rm(path.join(dir, path.basename(filename)), { force: true });
}

export async function readAvatar(filename: string): Promise<Buffer | null> {
  const dir = uploadDir();
  try {
    return await fs.readFile(path.join(dir, path.basename(filename)));
  } catch {
    return null;
  }
}
