// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { issuer } from '../env';

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const;

// Token-Lebensdauern (Sekunden)
export const AUTH_CODE_TTL = 60; // <= 60s
export const ID_TOKEN_TTL = 600; // 10 min
export const ACCESS_TOKEN_TTL = 600; // 10 min
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 Tage

/** Filtert angefragte Scopes auf die unterstützten. `openid` ist Pflicht. */
export function normalizeScope(requested: string): string | null {
  const parts = requested.split(/\s+/).filter(Boolean);
  if (!parts.includes('openid')) return null;
  const allowed = parts.filter((s) =>
    (SUPPORTED_SCOPES as readonly string[]).includes(s),
  );
  return Array.from(new Set(allowed)).join(' ');
}

/**
 * Schneidet einen Scope auf die pro Client erlaubten Scopes zu (leer = keine
 * Einschränkung). `openid` bleibt immer erhalten. Wird bei /authorize UND bei der
 * Refresh-Rotation angewandt, damit ein Scope-Entzug auch bestehende Tokens betrifft.
 */
export function narrowScope(scope: string, allowedScopes: string[]): string {
  if (allowedScopes.length === 0) return scope;
  return scope
    .split(' ')
    .filter((s) => s === 'openid' || allowedScopes.includes(s))
    .join(' ');
}

/** OIDC Discovery-Dokument. */
export function discoveryDocument() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/.well-known/jwks.json`,
    end_session_endpoint: `${iss}/logout`,
    revocation_endpoint: `${iss}/revoke`,
    introspection_endpoint: `${iss}/introspect`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: SUPPORTED_SCOPES,
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    code_challenge_methods_supported: ['S256'],
    claims_supported: [
      'sub',
      'preferred_username',
      'name',
      'picture',
      'email',
      'email_verified',
      'auth_time',
      'nonce',
    ],
  };
}
