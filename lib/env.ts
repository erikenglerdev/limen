// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { z } from 'zod';

/**
 * Zentrale, validierte Laufzeit-Konfiguration. Wird beim ersten Import geparst;
 * fehlerhafte/fehlende Werte führen zu einem klaren Startfehler statt undefiniertem
 * Verhalten tief im Code.
 */
const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET muss mindestens 32 Zeichen lang sein'),
  DATABASE_URL: z.string().min(1),
  ADMIN_USER: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).default('./uploads'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) sein'),
  AUTH_TRUST_HOST: z
    .enum(['true', 'false'])
    .optional()
    .default('false'),
  // Optionales Shared-Secret zwischen nginx und App. Ist es gesetzt, vertraut die App
  // den weitergeleiteten Client-IP-Headern (X-Real-IP / X-Forwarded-For) NUR, wenn die
  // Anfrage den Header `X-Proxy-Auth: <secret>` trägt (Beweis, dass sie durch den
  // Reverse-Proxy lief). Verhindert IP-Spoofing/Drossel-Umgehung bei Direktzugriff.
  TRUSTED_PROXY_SECRET: z
    .string()
    .min(16, 'TRUSTED_PROXY_SECRET sollte mindestens 16 Zeichen haben')
    .optional(),
  // Fail-safe: ungesetztes NODE_ENV gilt als 'production' (deaktiviert /dev/*).
  // `next dev` setzt NODE_ENV=development selbst, daher bleibt die Entwicklung intakt.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ungültige Umgebungskonfiguration:\n${issues}`);
  }
  // issuer ohne abschließenden Slash normalisieren
  cached = {
    ...parsed.data,
    APP_BASE_URL: parsed.data.APP_BASE_URL.replace(/\/+$/, ''),
  };
  return cached;
}

/** Öffentliche Basis-URL / OIDC issuer (ohne Trailing-Slash). */
export function issuer(): string {
  return getEnv().APP_BASE_URL;
}

export function isProd(): boolean {
  return getEnv().NODE_ENV === 'production';
}
