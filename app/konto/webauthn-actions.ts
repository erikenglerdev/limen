'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, webauthnCredentials } from '@/db';
import { logAudit } from '@/lib/audit';
import { factorChangeNeedsStepUp, STEP_UP_REQUIRED_MSG } from '@/lib/auth';
import { getCurrentUser, getSession } from '@/lib/session';
import { buildRegistrationOptions, verifyAndStoreRegistration } from '@/lib/webauthn';

type Result = { error?: string; success?: string };

export async function startPasskeyRegistration(): Promise<
  PublicKeyCredentialCreationOptionsJSON | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  // Hat das Konto schon einen Faktor, ist eine MFA-Sitzung nötig (Step-up). So kann sich
  // eine Passwort-only-Sitzung nicht über einen selbst angelegten Passkey hochstufen.
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };
  const options = await buildRegistrationOptions(user);
  const session = await getSession();
  session.webauthnChallenge = options.challenge;
  await session.save();
  return options;
}

export async function finishPasskeyRegistration(
  responseJson: string,
  name: string,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  // Maßgebliche Prüfung am Punkt der Credential-Erstellung (der Challenge wird sonst über
  // andere Pfade gesetzt). Verhindert Selbst-Hochstufung aus einer Passwort-only-Sitzung.
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };

  const session = await getSession();
  const challenge = session.webauthnChallenge;
  if (!challenge) return { error: 'Sitzung abgelaufen. Bitte erneut versuchen.' };

  let response: RegistrationResponseJSON;
  try {
    response = JSON.parse(responseJson) as RegistrationResponseJSON;
  } catch {
    return { error: 'Ungültige Antwort des Authenticators.' };
  }

  const label = (name.trim() || 'Passkey').slice(0, 50);
  const ok = await verifyAndStoreRegistration(user.id, response, challenge, label);
  session.webauthnChallenge = undefined;
  // Eine erfolgreiche Registrierung (userVerification erzwungen) beweist Besitz des Faktors
  // → Sitzung auf MFA-Niveau heben. So entfällt das sofortige erneute Bestätigen direkt nach
  // dem ERSTEN Faktor (Bootstrap). Kein Eskalations-Risiko: bei bereits vorhandenem Faktor +
  // reiner Passwort-Sitzung bricht factorChangeNeedsStepUp() oben schon vor diesem Punkt ab.
  if (ok) session.mfa = true;
  await session.save();

  if (!ok) return { error: 'Passkey konnte nicht verifiziert werden.' };
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'webauthn.register',
    detail: label,
  });
  revalidatePath('/konto');
  return { success: 'Passkey hinzugefügt.' };
}

export async function deletePasskey(id: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };
  await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, user.id)));
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'webauthn.delete',
  });
  revalidatePath('/konto');
  return { success: 'Passkey entfernt.' };
}
