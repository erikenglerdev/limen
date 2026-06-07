// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, refreshTokens } from '@/db';
import { sha256 } from '@/lib/crypto';
import { authenticateClient } from '@/lib/oidc/clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * RFC 7009 Token Revocation. Widerruft ein Refresh-Token des authentifizierten
 * Clients. Access-Tokens sind stateless (kurzlebig) – dafür antworten wir gemäß
 * Spec ebenfalls mit 200, ohne serverseitige Aktion.
 */
export async function POST(req: NextRequest) {
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
  if (token) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, sha256(token)),
          eq(refreshTokens.clientId, client.clientId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  // RFC 7009: immer 200, auch bei unbekanntem/ungültigem Token.
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
