// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, refreshTokens, users } from '@/db';
import { getClientIp } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { issuer } from '@/lib/env';
import { authenticateClient } from '@/lib/oidc/clients';
import { accessTokenStillValid, verifyAccessToken } from '@/lib/oidc/jwt';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const inactive = () => NextResponse.json({ active: false }, { headers: NO_STORE });

/** Kill-Switch: deaktivierte Konten gelten als nicht aktiv (Tokens als inactive melden). */
async function isUserActive(userId: string): Promise<boolean> {
  const [u] = await db
    .select({ active: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!u?.active;
}

/** Access-Token: aktiv UND nicht vor einer Sicherheitsaktion (Passwortwechsel/Logout) ausgestellt. */
async function accessTokenSubjectValid(userId: string, iat: number): Promise<boolean> {
  const [u] = await db
    .select({
      isActive: users.isActive,
      sessionsValidFrom: users.sessionsValidFrom,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!u && accessTokenStillValid(u, iat);
}

/**
 * RFC 7662 Token Introspection. Erfordert Client-Authentifizierung. Erkennt Refresh-
 * Tokens (über Hash; nur eigene des Clients) und Access-Tokens (JWT-Verifikation).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit(`introspect:${ip ?? 'unknown'}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: FormData;
  try {
    body = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request' },
      { status: 400, headers: NO_STORE },
    );
  }

  const client = await authenticateClient(req.headers.get('authorization'), body);
  if (!client) {
    return NextResponse.json(
      { error: 'invalid_client' },
      { status: 401, headers: NO_STORE },
    );
  }

  const token = String(body.get('token') ?? '');
  if (!token) return inactive();

  // Refresh-Token?
  const [rt] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(token)))
    .limit(1);
  if (rt) {
    const active =
      !rt.revokedAt &&
      rt.expiresAt.getTime() > Date.now() &&
      rt.clientId === client.clientId &&
      (await isUserActive(rt.userId));
    if (!active) return inactive();
    return NextResponse.json(
      {
        active: true,
        token_type: 'refresh_token',
        sub: rt.userId,
        client_id: rt.clientId,
        scope: rt.scope,
        exp: Math.floor(rt.expiresAt.getTime() / 1000),
      },
      { headers: NO_STORE },
    );
  }

  // Access-Token (JWT)?
  const verified = await verifyAccessToken(token);
  // Nur Tokens des anfragenden Clients offenlegen (RFC 7662: kein Cross-Client-Leak
  // von sub/scope). Die Refresh-Branch oben prüft das bereits über clientId. Zusätzlich
  // deaktivierte Konten als inactive melden (Kill-Switch).
  if (
    verified &&
    verified.clientId === client.clientId &&
    (await accessTokenSubjectValid(verified.sub, verified.iat))
  ) {
    return NextResponse.json(
      {
        active: true,
        token_type: 'Bearer',
        sub: verified.sub,
        scope: verified.scope,
        client_id: verified.clientId,
        iss: issuer(),
        aud: issuer(),
      },
      { headers: NO_STORE },
    );
  }

  return inactive();
}
