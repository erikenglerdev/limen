// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, users } from '@/db';
import { getClient, verifyClientSecret } from '@/lib/oidc/clients';
import { consumeAuthCode } from '@/lib/oidc/codes';
import { verifyPkceS256 } from '@/lib/oidc/pkce';
import { issueTokenSet, rotateAndIssue } from '@/lib/oidc/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

// Maximale Header-Länge für Basic-Auth (begrenzt die argon2-Last auf dem Client-Secret).
const MAX_AUTH_HEADER = 2048;

// Feldlängen-Obergrenzen je Token-Parameter. Verhindert, dass überlange Eingaben
// (insb. client_secret → argon2, aber auch code/verifier/refresh_token) Ressourcen binden.
const tokenFieldsSchema = z.object({
  grant_type: z.string().max(64).optional(),
  client_id: z.string().max(256).optional(),
  client_secret: z.string().max(1024).optional(),
  code: z.string().max(1024).optional(),
  redirect_uri: z.string().max(2048).optional(),
  code_verifier: z.string().max(256).optional(),
  refresh_token: z.string().max(1024).optional(),
});

function formStr(body: FormData, key: string): string | undefined {
  const v = body.get(key);
  return typeof v === 'string' ? v : undefined;
}

function err(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: NO_STORE },
  );
}

interface ClientCreds {
  clientId: string;
  clientSecret?: string;
  fromBasic: boolean;
}

function readClientCreds(req: NextRequest, body: FormData): ClientCreds {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    // Überlange Header gar nicht erst dekodieren (begrenzt die argon2-Last).
    if (auth.length > MAX_AUTH_HEADER) return { clientId: '', fromBasic: true };
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      // Ohne ':' ist der Header malformed (RFC 6749 §2.3.1) → leere clientId, Lookup scheitert.
      if (i < 0) return { clientId: '', fromBasic: true };
      return {
        clientId: decodeURIComponent(decoded.slice(0, i)),
        clientSecret: decodeURIComponent(decoded.slice(i + 1)),
        fromBasic: true,
      };
    } catch {
      // Ungültige Prozentkodierung → malformed, sauber als invalid_client behandeln.
      return { clientId: '', fromBasic: true };
    }
  }
  return {
    clientId: String(body.get('client_id') ?? ''),
    clientSecret: body.get('client_secret')
      ? String(body.get('client_secret'))
      : undefined,
    fromBasic: false,
  };
}

export async function POST(req: NextRequest) {
  // OAuth verlangt application/x-www-form-urlencoded; anderes (z.B. multipart) ablehnen,
  // bevor der Body verarbeitet wird.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return err('invalid_request', 'Content-Type muss application/x-www-form-urlencoded sein.');
  }

  let body: FormData;
  try {
    body = await req.formData();
  } catch {
    return err('invalid_request', 'Body muss application/x-www-form-urlencoded sein.');
  }

  // Feldlängen begrenzen (DoS-Hygiene), bevor argon2/DB-Lookups laufen.
  const lengths = tokenFieldsSchema.safeParse({
    grant_type: formStr(body, 'grant_type'),
    client_id: formStr(body, 'client_id'),
    client_secret: formStr(body, 'client_secret'),
    code: formStr(body, 'code'),
    redirect_uri: formStr(body, 'redirect_uri'),
    code_verifier: formStr(body, 'code_verifier'),
    refresh_token: formStr(body, 'refresh_token'),
  });
  if (!lengths.success) {
    return err('invalid_request', 'Ein Parameter überschreitet die zulässige Länge.');
  }

  const creds = readClientCreds(req, body);
  const client = await getClient(creds.clientId);
  if (!client) {
    return err('invalid_client', 'Unbekannter Client.', creds.fromBasic ? 401 : 400);
  }

  // Vertrauliche Clients müssen sich authentifizieren.
  if (client.isConfidential) {
    if (!creds.clientSecret || !(await verifyClientSecret(client, creds.clientSecret))) {
      return err('invalid_client', 'Client-Authentifizierung fehlgeschlagen.', 401);
    }
  }

  const grantType = String(body.get('grant_type') ?? '');

  if (grantType === 'authorization_code') {
    const code = String(body.get('code') ?? '');
    const redirectUri = String(body.get('redirect_uri') ?? '');
    const codeVerifier = String(body.get('code_verifier') ?? '');

    if (!code || !redirectUri || !codeVerifier) {
      return err('invalid_request', 'code, redirect_uri und code_verifier sind erforderlich.');
    }

    const row = await consumeAuthCode(code);
    if (!row) return err('invalid_grant', 'Code ungültig, abgelaufen oder bereits verwendet.');
    if (row.clientId !== client.clientId) {
      return err('invalid_grant', 'Code gehört zu einem anderen Client.');
    }
    if (row.redirectUri !== redirectUri) {
      return err('invalid_grant', 'redirect_uri stimmt nicht überein.');
    }
    if (!verifyPkceS256(codeVerifier, row.codeChallenge)) {
      return err('invalid_grant', 'PKCE-Verifikation fehlgeschlagen.');
    }

    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) {
      return err('invalid_grant', 'Benutzerkonto nicht verfügbar.');
    }

    const tokens = await issueTokenSet({
      user,
      clientId: client.clientId,
      scope: row.scope,
      nonce: row.nonce,
      authTime: row.authTime ? Math.floor(row.authTime.getTime() / 1000) : undefined,
    });
    return NextResponse.json(tokens, { headers: NO_STORE });
  }

  if (grantType === 'refresh_token') {
    const presented = String(body.get('refresh_token') ?? '');
    if (!presented) return err('invalid_request', 'refresh_token ist erforderlich.');

    // Claim + Ausstellung atomar (schließt das Reuse-Detection-Race); Scope wird dabei
    // erneut auf die aktuellen allowedScopes des Clients geschnitten.
    const result = await rotateAndIssue(presented, client);
    if (!result.ok) return err('invalid_grant', 'Refresh-Token ungültig oder widerrufen.');
    return NextResponse.json(result.tokens, { headers: NO_STORE });
  }

  return err('unsupported_grant_type', `grant_type "${grantType}" wird nicht unterstützt.`);
}
