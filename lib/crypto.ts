// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { getEnv } from './env';

/** SHA-256-Hash (hex) – für Lookup-Hashes von Auth-Codes/Refresh-Tokens. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Kryptografisch sicheres Zufallstoken (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Konstante-Zeit-Vergleich zweier Strings. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Vergleich trotzdem durchführen, um Längen-Timing zu vermeiden.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

const ALGO = 'aes-256-gcm';

function keyFromHex(hex: string): Buffer {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY muss 32 Byte (64 Hex) sein');
  return buf;
}

function key(): Buffer {
  return keyFromHex(getEnv().ENCRYPTION_KEY); // 32 Byte
}

/** Verschlüsselt mit einem explizit übergebenen Hex-Schlüssel (für Key-Rotation). */
export function encryptSecretWith(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFromHex(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecretWith(enc: string, keyHex: string): string {
  const [ivB64, tagB64, ctB64] = enc.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Ungültiges Chiffrat');
  const decipher = createDecipheriv(ALGO, keyFromHex(keyHex), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Verschlüsselt einen String mit AES-256-GCM (Schlüssel aus ENCRYPTION_KEY).
 * Ausgabe: base64(iv).base64(tag).base64(ct). Für Secrets at rest.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [ivB64, tagB64, ctB64] = enc.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Ungültiges Chiffrat');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
