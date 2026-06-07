// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, users } from '@/db';
import { getClientIp } from '@/lib/auth';
import { buildClaims } from '@/lib/oidc/claims';
import { accessTokenStillValid, verifyAccessToken } from '@/lib/oidc/jwt';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tooManyRequests(retryAfter: number) {
  return new NextResponse(null, {
    status: 429,
    headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  });
}

function unauthorized(description?: string) {
  const challenge = description
    ? `Bearer error="invalid_token", error_description="${description}"`
    : 'Bearer error="invalid_token"';
  return new NextResponse(null, {
    status: 401,
    headers: { 'WWW-Authenticate': challenge, 'Cache-Control': 'no-store' },
  });
}

async function handle(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit(`userinfo:${ip ?? 'unknown'}`, 120, 60_000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return unauthorized('Bearer-Token erforderlich');
  }

  const verified = await verifyAccessToken(auth.slice(7).trim());
  if (!verified) return unauthorized();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, verified.sub))
    .limit(1);
  // Kill-Switch + Sicherheitsaktions-Fenster: deaktivierte Konten und Tokens, die vor
  // Passwortwechsel/„überall abmelden" ausgestellt wurden, erhalten keine Claims mehr.
  if (!user || !accessTokenStillValid(user, verified.iat)) {
    return unauthorized('Konto nicht verfügbar');
  }

  return NextResponse.json(
    { sub: user.id, ...buildClaims(user, verified.scope) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
