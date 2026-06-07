// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, loginAttempts, users, type User } from '@/db';
import { randomToken, timingSafeEqualStr } from './crypto';
import { getEnv } from './env';
import { hashPassword, verifyPassword } from './password';
import { getCurrentUser, getSession } from './session';
import { verifyTotpStep } from './totp';
import { countUserPasskeys } from './webauthn';

// Drosselung pro (IP + Konto): verhindert sowohl gezieltes Aussperren eines Kontos
// (kein globaler Konto-Lockout – andere IPs bleiben für dasselbe Konto frei) als auch
// Kollateralschäden hinter geteilter NAT (Tippfehler eines Nutzers sperren nicht alle
// anderen Nutzer derselben IP). Schwelle großzügig, da nur ein Konto je IP betroffen.
const MAX_FAILED_PER_IP_USER = 20;
const WINDOW_MIN = 15;

// Dummy-Hash, gegen den bei unbekanntem Nutzer verifiziert wird, um Timing-/
// Enumeration-Unterschiede zu vermeiden.
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomToken());
  return dummyHash;
}

/**
 * Ermittelt die vertrauenswürdige Client-IP. Hinter nginx ist X-Real-IP die direkte
 * Verbindungs-IP (vom Proxy gesetzt, nicht client-fälschbar). X-Forwarded-For wird nur
 * als Fallback und dann mit dem LETZTEN Eintrag (vom Proxy ergänzt) verwendet.
 *
 * Ist `TRUSTED_PROXY_SECRET` konfiguriert, werden die weitergeleiteten IP-Header NUR
 * akzeptiert, wenn die Anfrage `X-Proxy-Auth: <secret>` trägt (= lief nachweislich
 * durch den Reverse-Proxy). Bei direktem Zugriff liefert die Funktion dann `null`,
 * sodass weder die IP-Drossel umgangen noch eine IP in Audit/Anmeldeverlauf gefälscht
 * werden kann. Ohne gesetztes Secret bleibt das bisherige Verhalten erhalten.
 */
export function getClientIp(headers: Headers): string | null {
  const secret = getEnv().TRUSTED_PROXY_SECRET;
  if (secret) {
    const provided = headers.get('x-proxy-auth')?.trim();
    if (!provided || !timingSafeEqualStr(provided, secret)) return null;
  }
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return null;
}

/**
 * True, wenn von dieser IP für DIESES Konto zu viele Fehlversuche im Zeitfenster kamen.
 * Bewusst pro (IP, identifier): kein globaler Konto-Lockout und kein Aussperren anderer
 * Konten hinter derselben IP. Ohne ermittelbare IP greift keine Drossel.
 */
export async function isThrottled(
  ip: string | null,
  identifier: string,
): Promise<boolean> {
  if (!ip) return false; // ohne IP keine (IP-gebundene) Drossel möglich (z.B. lokal)
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_FAILED_PER_IP_USER;
}

async function recordAttempt(identifier: string, ip: string | null, success: boolean) {
  await db.insert(loginAttempts).values({ identifier, ip, success });
}

/**
 * Verbucht einen ABGESCHLOSSENEN Login (Anmeldeverlauf-„erfolgreich" + last_login_at).
 * Wird erst am Punkt der echten Sitzungserstellung aufgerufen – nach 2FA bzw. per Passkey –,
 * NICHT schon nach der Passwortprüfung. So bedeutet „erfolgreich" wirklich „eingeloggt", und
 * passwortlose Passkey-Logins erscheinen ebenfalls im Verlauf.
 */
export async function recordSuccessfulLogin(
  userId: string,
  identifier: string,
  ip: string | null,
) {
  await recordAttempt(identifier, ip, true);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

// 2FA-Drossel pro (Konto + IP) – wie die Passwort-Drossel. Bewusst NICHT rein
// kontoweit: sonst könnte ein Angreifer, der das Passwort kennt, durch wiederholte
// Fehlcodes die 2FA-Stufe kontoweit dauerhaft sperren und das Opfer (auch über
// Recovery-Codes und von anderen IPs) aussperren. Mit IP-Bindung bleibt das Opfer von
// einer sauberen IP anmeldefähig, während die Angreifer-IP gedrosselt wird. Online-
// Brute-Force gegen 6-stellige, alle 30s rotierende TOTP-Codes ist auch bei 10/15min
// je IP praktisch aussichtslos. Greift für Login-2FA UND Admin-Step-up.
const MAX_2FA_FAILS = 10;
const TWOFA_WINDOW_MIN = 15;
const twoFaKey = (userId: string) => `2fa:${userId}`;

/** True, wenn von dieser IP für dieses Konto zu viele 2FA-Fehlversuche im Fenster kamen. */
export async function isTwoFactorThrottled(
  userId: string,
  ip: string | null,
): Promise<boolean> {
  if (!ip) return false; // ohne IP keine (IP-gebundene) Drossel – konsistent zur Login-Drossel
  const since = new Date(Date.now() - TWOFA_WINDOW_MIN * 60_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, twoFaKey(userId)),
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_2FA_FAILS;
}

/** Fehlgeschlagenen 2FA-Versuch festhalten (`ip` nur zur Nachvollziehbarkeit gespeichert;
 *  gedrosselt wird kontogebunden über `2fa:<userId>`, nicht über die Login-IP-Drossel). */
export async function recordTwoFactorFailure(userId: string, ip: string | null) {
  await db
    .insert(loginAttempts)
    .values({ identifier: twoFaKey(userId), ip, success: false });
}

/** Bei Erfolg die 2FA-Fehlversuche des Kontos aufräumen (nett nach Tippfehlern). */
export async function clearTwoFactorFailures(userId: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.identifier, twoFaKey(userId)));
}

/**
 * Prüft einen TOTP-Code UND erzwingt Einmalverwendung (RFC 6238 §5.2): der akzeptierte
 * Zeitschritt wird atomar als verbraucht markiert. Ein bereits genutzter oder älterer
 * Schritt (Replay innerhalb des ±1-Fensters, auch bei parallelen Anfragen) wird abgelehnt.
 * Das `UPDATE ... WHERE step > last` ist selbst der Guard – keine separate Lese-Race.
 * Gilt für Login-2FA und Admin-Step-up; verbraucht ist der Code damit kontoweit.
 */
export async function consumeTotp(
  userId: string,
  secretBase32: string,
  token: string,
): Promise<boolean> {
  const step = verifyTotpStep(secretBase32, token);
  if (step === null) return false;
  const [claimed] = await db
    .update(users)
    .set({ totpLastUsedStep: step })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.totpLastUsedStep), lt(users.totpLastUsedStep, step)),
      ),
    )
    .returning({ id: users.id });
  return !!claimed;
}

/**
 * Faktor-Verwaltung (Passkey/TOTP hinzufügen/entfernen, Recovery-Codes neu) erfordert eine
 * MFA-Sitzung (`session.mfa`), SOBALD das Konto bereits einen Faktor hat. Verhindert, dass
 * eine reine Passwort-Sitzung sich über einen selbst angelegten Faktor zu MFA hochstuft
 * (Passwort-Kenner-Eskalation). Der ERSTE Faktor (Konto noch ohne Faktor) bleibt aus einer
 * Passwort-Sitzung möglich (Bootstrap). Liefert true, wenn erst ein Step-up nötig ist.
 */
export async function factorChangeNeedsStepUp(user: User): Promise<boolean> {
  const hasFactor = user.totpEnabled || (await countUserPasskeys(user.id)) > 0;
  if (!hasFactor) return false; // Bootstrap: ersten Faktor anlegen
  const session = await getSession();
  return session.mfa !== true;
}

export const STEP_UP_REQUIRED_MSG =
  'Bitte zuerst mit einem vorhandenen Faktor bestätigen (Verwaltung freischalten).';

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid' | 'locked' };

/**
 * Authentifiziert einen Nutzer. Gibt absichtlich generische Gründe zurück
 * (kein Hinweis, ob Username existiert / Konto deaktiviert ist).
 */
export async function authenticate(
  rawUsername: string,
  password: string,
  ip: string | null,
): Promise<AuthResult> {
  const identifier = rawUsername.trim().toLowerCase();

  if (await isThrottled(ip, identifier)) {
    return { ok: false, reason: 'locked' };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.username})`, identifier))
    .limit(1);

  const hash = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(hash, password);

  if (!user || !passwordOk || !user.isActive) {
    await recordAttempt(identifier, ip, false);
    return { ok: false, reason: 'invalid' };
  }

  // Erfolg wird NICHT hier verbucht: ein TOTP-Konto ist nach korrektem Passwort noch nicht
  // eingeloggt. Anmeldeverlauf + last_login_at setzt der Aufrufer via recordSuccessfulLogin(),
  // sobald die Sitzung tatsächlich entsteht (nach 2FA bzw. per Passkey).
  return { ok: true, user };
}

/** Seite-Guard: erzwingt eingeloggten Nutzer, sonst Redirect zum Login. */
export async function requireUser(returnTo?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`);
  }
  return user;
}

/**
 * Seite-Guard: erzwingt SSO-Admin mit Session-MFA-Enforcement.
 * - Kein zweiter Faktor eingerichtet → Einrichtung (`2fa_required`).
 * - Faktor vorhanden, aber Sitzung ohne MFA (reines Passwort) → Step-up (`mfa_required`).
 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser('/admin');
  if (!user.isSsoAdmin) redirect('/konto');

  const hasFactor = user.totpEnabled || (await countUserPasskeys(user.id)) > 0;
  if (!hasFactor) redirect('/konto?2fa_required=1');

  const session = await getSession();
  if (!session.mfa) redirect('/konto?mfa_required=1');

  return user;
}
