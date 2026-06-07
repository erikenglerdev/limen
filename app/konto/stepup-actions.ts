'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import {
  clearTwoFactorFailures,
  consumeTotp,
  getClientIp,
  isTwoFactorThrottled,
  recordTwoFactorFailure,
} from '@/lib/auth';
import { safeReturnTo } from '@/lib/return-to';
import { getCurrentUser, getSession } from '@/lib/session';
import { decryptTotpSecret } from '@/lib/totp';
import { verifyPasswordlessAuthentication } from '@/lib/webauthn';

export type StepUpState = { error?: string };

// Ziel nach erfolgreichem Step-up: Default Admin-Bereich, für Faktor-Verwaltung /konto.
// next wird über safeReturnTo gegen Open-Redirect abgesichert.
function stepUpTarget(next: string | undefined | null): string {
  return next ? safeReturnTo(next) : '/admin';
}

/** Hebt die aktuelle Sitzung per TOTP auf MFA-Niveau (für Admin-Zugriff). */
export async function stepUpTotp(
  _prev: StepUpState,
  formData: FormData,
): Promise<StepUpState> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.totpEnabled || !user.totpSecretEnc) {
    return { error: 'Kein TOTP eingerichtet.' };
  }
  const ip = getClientIp(await headers());
  if (await isTwoFactorThrottled(user.id, ip)) {
    return { error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' };
  }
  const code = formData.get('code')?.toString() ?? '';
  // Einmalverwendung erzwingen (gleicher kontoweiter Zähler wie der Login-2FA-Schritt).
  if (!(await consumeTotp(user.id, decryptTotpSecret(user.totpSecretEnc), code))) {
    await recordTwoFactorFailure(user.id, ip);
    return { error: 'Code ungültig.' };
  }
  await clearTwoFactorFailures(user.id);
  const session = await getSession();
  session.mfa = true;
  await session.save();
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'session.stepup_totp',
  });
  redirect(stepUpTarget(formData.get('next')?.toString()));
}

/** Hebt die aktuelle Sitzung per Passkey auf MFA-Niveau (für Admin-Zugriff). */
export async function stepUpPasskey(
  responseJson: string,
  next?: string,
): Promise<StepUpState | void> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const session = await getSession();
  const challenge = session.webauthnChallenge;
  if (!challenge) return { error: 'Sitzung abgelaufen. Bitte erneut versuchen.' };

  let response: AuthenticationResponseJSON;
  try {
    response = JSON.parse(responseJson) as AuthenticationResponseJSON;
  } catch {
    return { error: 'Ungültige Antwort des Authenticators.' };
  }

  const userId = await verifyPasswordlessAuthentication(response, challenge);
  session.webauthnChallenge = undefined;
  if (userId !== user.id) {
    await session.save();
    return { error: 'Passkey passt nicht zum angemeldeten Konto.' };
  }
  await clearTwoFactorFailures(user.id);
  session.mfa = true;
  await session.save();
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'session.stepup_passkey',
  });
  redirect(stepUpTarget(next));
}
