// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import type { User } from '@/db';
import { issuer } from '../env';
import { getActiveSigningKey, getJwks } from './keys';

/**
 * Ob ein (stateless) Access-Token für diesen Nutzer noch gilt: Konto aktiv UND vor der
 * letzten Passwort-Änderung bzw. einem „überall abmelden" ausgestellte Tokens werden
 * abgelehnt. Schließt das 10-Minuten-Restfenster bei userinfo/introspect.
 */
export function accessTokenStillValid(
  user: Pick<User, 'isActive' | 'sessionsValidFrom' | 'passwordChangedAt'>,
  iatSeconds: number,
): boolean {
  if (!user.isActive) return false;
  const iatMs = iatSeconds * 1000;
  if (user.passwordChangedAt && iatMs < user.passwordChangedAt.getTime()) return false;
  if (user.sessionsValidFrom && iatMs < user.sessionsValidFrom.getTime()) return false;
  return true;
}

interface SignOptions {
  subject: string;
  audience: string;
  expiresInSeconds: number;
}

/** Signiert ein JWT (RS256) mit dem aktiven Schlüssel; setzt `kid` im Header. */
export async function signJwt(
  payload: Record<string, unknown>,
  opts: SignOptions,
): Promise<string> {
  const key = await getActiveSigningKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .setIssuer(issuer())
    .setSubject(opts.subject)
    .setAudience(opts.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + opts.expiresInSeconds)
    .sign(key.privateKey);
}

export interface VerifiedAccessToken {
  sub: string;
  scope: string;
  clientId: string;
  iat: number; // Ausstellungszeit (Unix-Sekunden) – für Sicherheitsaktions-Fenster
}

/**
 * Verifiziert ein Access-Token (Signatur, iss, exp, Token-Typ). Audience ist der
 * issuer (dieser Dienst als Resource-Server). Gibt null zurück bei Ungültigkeit.
 */
export async function verifyAccessToken(
  token: string,
): Promise<VerifiedAccessToken | null> {
  try {
    const jwks = createLocalJWKSet(await getJwks());
    const { payload } = await jwtVerify(token, jwks, {
      issuer: issuer(),
      audience: issuer(),
      algorithms: ['RS256'], // alg pinnen (kein HS256/none-Confusion)
    });
    if (payload.token_use !== 'access' || typeof payload.sub !== 'string') {
      return null;
    }
    return {
      sub: payload.sub,
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
    };
  } catch {
    return null;
  }
}

/** Verifiziert einen id_token_hint (für RP-initiated logout) und liefert die aud. */
export async function audienceFromIdTokenHint(
  hint: string,
): Promise<string | null> {
  try {
    const jwks = createLocalJWKSet(await getJwks());
    // ID-Tokens leben nur ~10 min; beim Logout schickt der RP den Hint oft später.
    // Signatur + Issuer werden weiterhin geprüft (eigener Key); abgelaufenes exp wird
    // hier toleriert, da die aud nur zur Auswahl einer bereits allowlisteten
    // post_logout_redirect_uri dient (keine Authentisierungsentscheidung).
    const { payload } = await jwtVerify(hint, jwks, {
      issuer: issuer(),
      algorithms: ['RS256'],
      clockTolerance: 60 * 60 * 24 * 3650, // ~10 Jahre → exp effektiv ignoriert
    });
    const aud = payload.aud;
    if (typeof aud === 'string') return aud;
    if (Array.isArray(aud) && typeof aud[0] === 'string') return aud[0];
    return null;
  } catch {
    return null;
  }
}
