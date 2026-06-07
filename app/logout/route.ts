// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { type NextRequest, NextResponse } from 'next/server';
import { issuer } from '@/lib/env';
import { getClient, postLogoutUriAllowed } from '@/lib/oidc/clients';
import { audienceFromIdTokenHint } from '@/lib/oidc/jwt';
import { destroySession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const postLogout = sp.get('post_logout_redirect_uri');
  const state = sp.get('state');
  const idTokenHint = sp.get('id_token_hint');
  let clientId = sp.get('client_id') ?? undefined;

  // IdP-Session beenden.
  await destroySession();

  if (postLogout) {
    if (!clientId && idTokenHint) {
      clientId = (await audienceFromIdTokenHint(idTokenHint)) ?? undefined;
    }
    if (clientId) {
      const client = await getClient(clientId);
      // Exakter Allowlist-Match – sonst NICHT weiterleiten.
      if (client && postLogoutUriAllowed(client, postLogout)) {
        const url = new URL(postLogout);
        if (state) url.searchParams.set('state', state);
        return NextResponse.redirect(url.toString());
      }
    }
  }

  return NextResponse.redirect(new URL('/abgemeldet', issuer()).toString());
}
