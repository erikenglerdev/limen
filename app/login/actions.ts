'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db, totpRecoveryCodes, users } from '@/db';
import {
  authenticate,
  clearTwoFactorFailures,
  consumeTotp,
  getClientIp,
  isTwoFactorThrottled,
  recordSuccessfulLogin,
  recordTwoFactorFailure,
} from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { resolvePostLoginDestination } from '@/lib/oidc/authorize';
import { getSession, startSession } from '@/lib/session';
import { decryptTotpSecret, normalizeRecoveryCode } from '@/lib/totp';
import {
  buildPasswordlessAuthenticationOptions,
  verifyPasswordlessAuthentication,
} from '@/lib/webauthn';

export type LoginState = { error?: string; needs2fa?: boolean };

const PENDING_TTL_MS = 5 * 60_000;
const MAX_2FA_TRIES = 5;

const schema = z.object({
  username: z.string().min(1).max(256),
  // Obergrenze deckt jedes legitime Passwort ab und begrenzt die argon2-Last pro Versuch.
  password: z.string().min(1).max(1024),
  returnTo: z.string().optional(),
});

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
    returnTo: formData.get('returnTo') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'Bitte Benutzername und Passwort eingeben.' };
  }

  const ip = getClientIp(await headers());
  const result = await authenticate(parsed.data.username, parsed.data.password, ip);
  if (!result.ok) {
    return {
      error:
        result.reason === 'locked'
          ? 'Zu viele Fehlversuche. Bitte versuchen Sie es später erneut.'
          : 'Benutzername oder Passwort ist falsch.',
    };
  }

  // Passwort-Pfad: zweiter Faktor nur, wenn TOTP eingerichtet ist.
  if (result.user.totpEnabled) {
    const session = await getSession();
    session.userId = undefined;
    session.loginAt = undefined;
    session.pending2fa = { userId: result.user.id, at: Date.now(), tries: 0 };
    await session.save();
    return { needs2fa: true };
  }

  await recordSuccessfulLogin(result.user.id, result.user.username.toLowerCase(), ip);
  await startSession(result.user.id);
  const authTime = Math.floor(Date.now() / 1000);
  redirect(
    await resolvePostLoginDestination(parsed.data.returnTo, result.user.id, authTime),
  );
}

export async function verify2faAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const session = await getSession();
  const pending = session.pending2fa;
  const returnTo = formData.get('returnTo')?.toString();

  if (!pending) {
    return { needs2fa: true, error: 'Sitzung abgelaufen. Bitte erneut anmelden.' };
  }
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    session.pending2fa = undefined;
    await session.save();
    return { needs2fa: true, error: 'Zeit abgelaufen. Bitte erneut anmelden.' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, pending.userId)).limit(1);
  if (!user || !user.isActive || !user.totpEnabled || !user.totpSecretEnc) {
    session.pending2fa = undefined;
    await session.save();
    return { needs2fa: true, error: 'Anmeldung nicht möglich. Bitte erneut anmelden.' };
  }

  // 2FA-Drossel pro (Konto + IP) – überlebt einen Re-Login, anders als der Session-Zähler.
  const ip = getClientIp(await headers());
  if (await isTwoFactorThrottled(user.id, ip)) {
    session.pending2fa = undefined;
    await session.save();
    return { needs2fa: true, error: 'Zu viele Fehlversuche. Bitte später erneut anmelden.' };
  }

  const code = formData.get('code')?.toString() ?? '';
  // Einmalverwendung erzwingen: ein bereits genutzter Code-Zeitschritt wird abgelehnt.
  let ok = await consumeTotp(user.id, decryptTotpSecret(user.totpSecretEnc), code);

  // Fallback: Recovery-Code (einmalig nutzbar). Atomar einlösen: das UPDATE selbst ist
  // der Guard (WHERE usedAt IS NULL) – verhindert Double-Spend bei parallelen Anfragen.
  if (!ok) {
    const codeHash = sha256(normalizeRecoveryCode(code));
    const claimed = await db
      .update(totpRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(totpRecoveryCodes.userId, user.id),
          eq(totpRecoveryCodes.codeHash, codeHash),
          isNull(totpRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: totpRecoveryCodes.id });
    if (claimed.length > 0) ok = true;
  }

  if (!ok) {
    await recordTwoFactorFailure(user.id, ip);
    pending.tries += 1;
    if (pending.tries >= MAX_2FA_TRIES) {
      session.pending2fa = undefined;
      await session.save();
      return { needs2fa: true, error: 'Zu viele Fehlversuche. Bitte erneut anmelden.' };
    }
    session.pending2fa = pending;
    await session.save();
    return { needs2fa: true, error: 'Code ungültig.' };
  }

  await clearTwoFactorFailures(user.id);
  await recordSuccessfulLogin(user.id, user.username.toLowerCase(), ip);
  session.userId = user.id;
  session.loginAt = Date.now();
  session.mfa = true; // Passwort + TOTP
  session.pending2fa = undefined;
  await session.save();
  const authTime = Math.floor(session.loginAt / 1000);
  redirect(await resolvePostLoginDestination(returnTo, user.id, authTime));
}

/** Optionen für den passwortlosen Passkey-Login (Schritt 1). */
export async function passwordlessOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await buildPasswordlessAuthenticationOptions();
  const session = await getSession();
  session.webauthnChallenge = options.challenge;
  await session.save();
  return options;
}

/**
 * Passwortloser Login per Passkey: verifiziert die Assertion und loggt direkt ein
 * (kein TOTP-Schritt – der Passkey ist bereits ein starker, nutzer-verifizierter Faktor).
 */
export async function verifyPasswordless(
  responseJson: string,
  returnTo?: string,
): Promise<{ error?: string } | void> {
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
  if (!userId) {
    await session.save();
    return { error: 'Passkey-Anmeldung fehlgeschlagen.' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) {
    await session.save();
    return { error: 'Anmeldung nicht möglich.' };
  }

  // Passwortlosen Login ebenfalls im Anmeldeverlauf + last_login_at verbuchen (B2).
  await recordSuccessfulLogin(
    user.id,
    user.username.toLowerCase(),
    getClientIp(await headers()),
  );
  session.userId = user.id;
  session.loginAt = Date.now();
  session.mfa = true; // Passkey ist user-verifiziert → MFA
  session.pending2fa = undefined;
  await session.save();
  const authTime = Math.floor(session.loginAt / 1000);
  redirect(await resolvePostLoginDestination(returnTo, user.id, authTime));
}
