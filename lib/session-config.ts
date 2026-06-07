// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { type SessionOptions } from 'iron-session';
import { getEnv } from './env';

/** Lebensdauer der IdP-Session in Sekunden (7 Tage, gleitend per Middleware erneuert). */
export const SESSION_TTL = 60 * 60 * 24 * 7;

export interface SessionData {
  userId?: string;
  loginAt?: number;
  // Wurde diese Sitzung mit einem zweiten Faktor (Passkey oder Passwort+TOTP) erstellt?
  // Voraussetzung für den Admin-Bereich (Session-MFA-Enforcement).
  mfa?: boolean;
  // Zwischenzustand zwischen Passwort- und 2FA-Schritt (noch NICHT eingeloggt).
  pending2fa?: { userId: string; at: number; tries: number };
  // Transiente WebAuthn-Challenge (Registrierung im Konto / Login-Assertion).
  webauthnChallenge?: string;
}

/**
 * Cookie-/Seal-Konfiguration der IdP-Session. Bewusst ohne DB-Import, damit sowohl
 * Server-Code (lib/session.ts) als auch die Edge-Middleware sie nutzen können.
 */
function isHttps(): boolean {
  try {
    return new URL(getEnv().APP_BASE_URL).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sessionOptions(): SessionOptions {
  // __Host--Prefix nur über echtes HTTPS (sonst lehnt der Browser das Cookie ab).
  // Schützt vor Cookie-Injection über Schwester-Subdomains der Parent-Domain.
  const https = isHttps();
  return {
    password: getEnv().AUTH_SECRET,
    cookieName: https ? '__Host-sso_session' : 'sso_session',
    ttl: SESSION_TTL,
    cookieOptions: {
      httpOnly: true,
      secure: https || getEnv().NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/', // für __Host- erforderlich; kein Domain-Attribut
    },
  };
}
