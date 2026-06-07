// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db, webauthnCredentials } from '@/db';
import { issuer } from './env';

const RP_NAME = 'Limen';

export function rpID(): string {
  return new URL(issuer()).hostname;
}
function expectedOrigin(): string {
  return issuer();
}

export async function userCredentials(userId: string) {
  return db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
}

export async function countUserPasskeys(userId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return row?.c ?? 0;
}

export async function buildRegistrationOptions(user: {
  id: string;
  username: string;
  name: string;
}) {
  const creds = await userCredentials(user.id);
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(),
    userID: new TextEncoder().encode(user.id),
    userName: user.username,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
    // Discoverable Credential + User-Verification → passwortloser, MFA-starker Login.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

export async function verifyAndStoreRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  name: string,
): Promise<boolean> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpID(),
    // Wir verlangen bereits in den Optionen userVerification: 'required'; hier konsequent
    // erzwingen, damit kein Credential ohne UV registriert wird (Passkey = starker Faktor).
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) return false;
  const { credential } = verification.registrationInfo;
  await db.insert(webauthnCredentials).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? null,
    name,
  });
  return true;
}

/** Optionen für passwortlosen Login: ohne allowCredentials → discoverable Credentials. */
export async function buildPasswordlessAuthenticationOptions() {
  return generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'required',
  });
}

/**
 * Verifiziert eine passwortlose Passkey-Assertion. Ermittelt den Nutzer global über die
 * (eindeutige) credential_id, prüft Signatur + User-Verification. Liefert die userId.
 */
export async function verifyPasswordlessAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<string | null> {
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, response.id))
    .limit(1);
  if (!cred) return null;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpID(),
    requireUserVerification: true,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
      counter: Number(cred.counter),
      transports: (cred.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    },
  });
  if (!verification.verified) return null;

  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > 0) {
    // Authenticator MIT Signature-Counter: atomar nur fortschreiben, wenn der gespeicherte
    // Counter echt kleiner ist. Schließt das TOCTOU-Fenster zwischen Lesen/Verify und
    // Schreiben – ein paralleler Replay (gleicher newCounter) oder ein Klon mit veraltetem
    // Counter findet den Wert dann nicht mehr < newCounter → 0 Zeilen → Anmeldung abgelehnt.
    const advanced = await db
      .update(webauthnCredentials)
      .set({ counter: newCounter, lastUsedAt: new Date() })
      .where(
        and(eq(webauthnCredentials.id, cred.id), lt(webauthnCredentials.counter, newCounter)),
      )
      .returning({ id: webauthnCredentials.id });
    if (advanced.length === 0) return null;
  } else {
    // Counter 0 = Authenticator ohne Signature-Counter (viele Passkeys): per Spec keine
    // Klon-Erkennung möglich. Nur lastUsedAt aktualisieren.
    await db
      .update(webauthnCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(webauthnCredentials.id, cred.id));
  }
  return cred.userId;
}
