// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
// @node-rs/argon2 ist CommonJS – Namespace-Import vermeidet Named-Export-Probleme
// in der webpack-Analyse.
import * as argon2 from '@node-rs/argon2';

// argon2id mit Reserve über dem OWASP-Minimum (19 MiB/t=2) – für einen zentralen IdP
// mit Admin-Konten angemessen. Bestehende Hashes bleiben gültig: argon2 speichert seine
// Parameter im Hash-String, sodass `verify` die jeweils gespeicherten Werte nutzt und
// nur neue Hashes mit diesen Parametern erzeugt werden.
const OPTS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTS);
}

/** Verifiziert ein Passwort gegen einen Hash. Konstante Zeit durch argon2. */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}

/** Passwort-Policy. Obergrenze begrenzt die argon2-Last pro Anfrage (DoS-Hygiene). */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 1024;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Das Passwort darf höchstens ${MAX_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  return null;
}
