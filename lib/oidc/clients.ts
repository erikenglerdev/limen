// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { db, oauthClients, type OAuthClient } from '@/db';
import { verifyPassword } from '../password';

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return client ?? null;
}

/** Exakter Allowlist-Match (kein Wildcard, kein Substring). */
export function redirectUriAllowed(client: OAuthClient, uri: string): boolean {
  return client.redirectUris.includes(uri);
}

export function postLogoutUriAllowed(client: OAuthClient, uri: string): boolean {
  return client.postLogoutRedirectUris.includes(uri);
}

export async function verifyClientSecret(
  client: OAuthClient,
  secret: string,
): Promise<boolean> {
  if (!client.clientSecretHash) return false;
  return verifyPassword(client.clientSecretHash, secret);
}

interface ClientCreds {
  clientId: string;
  clientSecret?: string;
}

function readClientCreds(authHeader: string | null, body: FormData): ClientCreds {
  if (authHeader?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      // Ohne ':' ist der Header malformed (RFC 6749 §2.3.1) → leere clientId, Lookup scheitert.
      if (i < 0) return { clientId: '' };
      return {
        clientId: decodeURIComponent(decoded.slice(0, i)),
        clientSecret: decodeURIComponent(decoded.slice(i + 1)),
      };
    } catch {
      // Ungültige Prozentkodierung → malformed, nicht als 500 durchschlagen lassen.
      return { clientId: '' };
    }
  }
  return {
    clientId: String(body.get('client_id') ?? ''),
    clientSecret: body.get('client_secret') ? String(body.get('client_secret')) : undefined,
  };
}

/**
 * Authentifiziert einen Client aus Basic-Header oder Body (für /revoke, /introspect).
 * Diese Endpunkte erfordern gemäß RFC 7009/7662 ECHTE Client-Authentifizierung:
 * Nur vertrauliche Clients mit gültigem Secret werden akzeptiert. Öffentliche Clients
 * (ohne Secret) werden abgelehnt – sonst könnte jeder, der eine öffentliche client_id
 * kennt, fremde Tokens introspizieren/widerrufen. Gibt null bei Fehlschlag.
 */
export async function authenticateClient(
  authHeader: string | null,
  body: FormData,
): Promise<OAuthClient | null> {
  const creds = readClientCreds(authHeader, body);
  const client = await getClient(creds.clientId);
  if (!client) return null;
  // Öffentliche Clients haben kein Secret → keine echte Authentifizierung möglich.
  if (!client.isConfidential || !client.clientSecretHash) return null;
  if (!creds.clientSecret || !(await verifyClientSecret(client, creds.clientSecret))) {
    return null;
  }
  return client;
}
