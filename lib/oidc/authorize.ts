// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import type { OAuthClient } from '@/db';
import { getClient, redirectUriAllowed } from './clients';
import { issueAuthCode } from './codes';
import { normalizeScope } from './config';

export interface AuthRequest {
  client: OAuthClient;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export type AuthValidation =
  | { kind: 'ok'; req: AuthRequest }
  // Client / redirect_uri ungültig → NICHT zurückleiten, Fehlerseite zeigen.
  | { kind: 'error_page'; error: string; description: string }
  // Sonstiger Fehler → zurück zur redirect_uri mit error-Parametern.
  | {
      kind: 'redirect_error';
      redirectUri: string;
      state: string | null;
      error: string;
      description: string;
    };

/**
 * Validiert eine /authorize-Anfrage gemäß OAuth/OIDC + den Sicherheitsvorgaben:
 * PKCE S256, state und nonce werden durchgesetzt; redirect_uri exakter Allowlist-Match.
 */
export async function validateAuthorizeRequest(
  sp: URLSearchParams,
): Promise<AuthValidation> {
  const clientId = sp.get('client_id') ?? '';
  const redirectUri = sp.get('redirect_uri') ?? '';

  const client = await getClient(clientId);
  if (!client) {
    return {
      kind: 'error_page',
      error: 'invalid_client',
      description: 'Unbekannte client_id.',
    };
  }
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return {
      kind: 'error_page',
      error: 'invalid_request',
      description: 'Ungültige redirect_uri.',
    };
  }

  const state = sp.get('state');
  const responseType = sp.get('response_type');
  const codeChallenge = sp.get('code_challenge') ?? '';
  const method = sp.get('code_challenge_method') ?? '';
  const nonce = sp.get('nonce');
  const scope = normalizeScope(sp.get('scope') ?? '');

  const fail = (error: string, description: string): AuthValidation => ({
    kind: 'redirect_error',
    redirectUri,
    state,
    error,
    description,
  });

  if (responseType !== 'code') {
    return fail('unsupported_response_type', 'Nur response_type=code wird unterstützt.');
  }
  if (!scope) return fail('invalid_scope', 'Scope muss "openid" enthalten.');
  if (!codeChallenge) {
    return fail('invalid_request', 'code_challenge fehlt (PKCE ist erforderlich).');
  }
  if (method !== 'S256') {
    return fail('invalid_request', 'code_challenge_method muss S256 sein.');
  }
  if (!state) return fail('invalid_request', 'state ist erforderlich.');
  if (!nonce) return fail('invalid_request', 'nonce ist erforderlich.');

  // Pro-Client-Scope-Begrenzung: leer = keine Einschränkung. `openid` immer erlaubt.
  const effectiveScope =
    client.allowedScopes.length > 0
      ? scope
          .split(' ')
          .filter((s) => s === 'openid' || client.allowedScopes.includes(s))
          .join(' ')
      : scope;

  return {
    kind: 'ok',
    req: { client, redirectUri, scope: effectiveScope, state, nonce, codeChallenge },
  };
}

/** Stellt einen Auth-Code aus und baut die Redirect-URL zurück zur App. */
export async function completeAuthorizationRedirect(
  ar: AuthRequest,
  userId: string,
  authTime?: number | null,
): Promise<string> {
  const code = await issueAuthCode({
    clientId: ar.client.clientId,
    userId,
    redirectUri: ar.redirectUri,
    codeChallenge: ar.codeChallenge,
    scope: ar.scope,
    nonce: ar.nonce,
    authTime,
  });
  const url = new URL(ar.redirectUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', ar.state);
  return url.toString();
}

export function buildErrorRedirect(
  redirectUri: string,
  state: string | null,
  error: string,
  description: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}
