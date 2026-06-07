// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { type NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/auth';
import { issuer } from '@/lib/env';
import {
  buildErrorRedirect,
  completeAuthorizationRedirect,
  validateAuthorizeRequest,
} from '@/lib/oidc/authorize';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function abs(path: string): string {
  return new URL(path, issuer()).toString();
}

export async function GET(req: NextRequest) {
  // App-seitige DoS-Härtung (ergänzend zu nginx): begrenzt Anfragen je IP.
  const ip = getClientIp(req.headers);
  const rl = rateLimit(`authorize:${ip ?? 'unknown'}`, 60, 60_000);
  if (!rl.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfter), 'Cache-Control': 'no-store' },
    });
  }

  const sp = req.nextUrl.searchParams;
  const v = await validateAuthorizeRequest(sp);

  if (v.kind === 'error_page') {
    // Nur der Fehlercode; die Fehlerseite zeigt feste Texte (keine Reflection).
    const url = new URL('/oauth-error', issuer());
    url.searchParams.set('error', v.error);
    return NextResponse.redirect(url.toString());
  }

  if (v.kind === 'redirect_error') {
    return NextResponse.redirect(
      buildErrorRedirect(v.redirectUri, v.state, v.error, v.description),
    );
  }

  const ar = v.req;
  const user = await getCurrentUser();

  if (!user) {
    // Nicht eingeloggt → Login, danach exakt hierher zurück.
    const returnTo = `/authorize?${sp.toString()}`;
    return NextResponse.redirect(abs(`/login?return_to=${encodeURIComponent(returnTo)}`));
  }

  // first-party → ohne Consent durchreichen.
  if (ar.client.isFirstParty) {
    const session = await getSession();
    const authTime = session.loginAt ? Math.floor(session.loginAt / 1000) : undefined;
    const redirectUrl = await completeAuthorizationRedirect(ar, user.id, authTime);
    return NextResponse.redirect(redirectUrl);
  }

  // sonst Consent-Screen.
  return NextResponse.redirect(abs(`/consent?${sp.toString()}`));
}
