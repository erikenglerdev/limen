// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { decryptSecret, encryptSecret } from './crypto';

const ISSUER = 'Limen';
const PERIOD = 30;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32; // 160 Bit
}

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** otpauth://-URI für QR-Code / manuelle Eingabe. */
export function totpUri(secretBase32: string, username: string): string {
  return totpFor(secretBase32, username).toString();
}

/** Prüft einen 6-stelligen TOTP-Code (±1 Periode Toleranz). */
export function verifyTotp(secretBase32: string, token: string): boolean {
  return verifyTotpStep(secretBase32, token) !== null;
}

/**
 * Wie verifyTotp, liefert aber den ABSOLUTEN Zeitschritt (floor(unixtime/period) + delta)
 * des akzeptierten Codes – oder null. Der Schritt erlaubt es dem Aufrufer, einen Code
 * als verbraucht zu markieren und Replay innerhalb des ±1-Fensters zu unterbinden.
 */
export function verifyTotpStep(secretBase32: string, token: string): number | null {
  const t = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(t)) return null;
  const delta = totpFor(secretBase32, 'user').validate({ token: t, window: 1 });
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / PERIOD) + delta;
}

/**
 * Erzeugt Backup-Codes im Format xxxx-xxxx-xxxx-xxxx-xxxx (80 Bit Entropie je Code).
 * 80 Bit machen die als Lookup-Hash (SHA-256) gespeicherten Codes auch bei einem
 * Offline-DB-Kompromiss praktisch unauffindbar (Preimage-Suche über 2^80 infeasible).
 */
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const hex = randomBytes(10).toString('hex'); // 80 Bit
    return (hex.match(/.{4}/g) ?? []).join('-');
  });
}

/** Normalisiert einen Recovery-Code für Vergleich/Speicherung (Hash). */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export const encryptTotpSecret = encryptSecret;
export const decryptTotpSecret = decryptSecret;
