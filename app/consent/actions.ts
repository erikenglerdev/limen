'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { redirect } from 'next/navigation';
import {
  buildErrorRedirect,
  completeAuthorizationRedirect,
  validateAuthorizeRequest,
} from '@/lib/oidc/authorize';
import { getCurrentUser, getSession } from '@/lib/session';

/** Nutzer stimmt zu → Auth-Code ausstellen und zurück zur App. */
export async function approveConsent(formData: FormData) {
  const params = String(formData.get('params') ?? '');
  const v = await validateAuthorizeRequest(new URLSearchParams(params));
  if (v.kind !== 'ok') redirect('/oauth-error?error=invalid_request');

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?return_to=${encodeURIComponent(`/authorize?${params}`)}`);
  }

  const session = await getSession();
  const authTime = session.loginAt ? Math.floor(session.loginAt / 1000) : undefined;
  const url = await completeAuthorizationRedirect(v.req, user.id, authTime);
  redirect(url);
}

/** Nutzer lehnt ab → zurück zur App mit error=access_denied. */
export async function denyConsent(formData: FormData) {
  const params = String(formData.get('params') ?? '');
  const v = await validateAuthorizeRequest(new URLSearchParams(params));
  if (v.kind !== 'ok') redirect('/oauth-error?error=invalid_request');

  redirect(
    buildErrorRedirect(
      v.req.redirectUri,
      v.req.state,
      'access_denied',
      'Der Nutzer hat die Anmeldung abgelehnt.',
    ),
  );
}
