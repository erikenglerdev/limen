// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { db, users, type User } from '@/db';
import { type SessionData, sessionOptions } from './session-config';

export type { SessionData };

/** Liefert die (mutierbare) IdP-Session. Speichern via `session.save()`. */
export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}

/** Setzt eine frische Login-Session. `mfa` markiert eine mit zweitem Faktor erstellte Sitzung. */
export async function startSession(userId: string, mfa = false) {
  const session = await getSession();
  session.userId = userId;
  session.loginAt = Date.now();
  session.mfa = mfa;
  session.pending2fa = undefined;
  await session.save();
}

export async function destroySession() {
  const session = await getSession();
  session.destroy();
}

/**
 * Lädt den aktuell eingeloggten, aktiven Benutzer (oder null). Berücksichtigt den
 * zentralen Kill-Switch: deaktivierte Konten gelten als nicht eingeloggt.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user || !user.isActive) return null;
  // Ohne loginAt ist die Session nicht vertrauenswürdig (fail-closed): sonst könnte
  // eine Session ohne Zeitstempel die Invalidierung unten umgehen.
  if (!session.loginAt) return null;
  // Session-Invalidierung: vor der letzten Passwort-Änderung bzw. vor einem
  // „Überall abmelden" ausgestellte Sessions gelten als abgemeldet.
  if (user.passwordChangedAt && session.loginAt < user.passwordChangedAt.getTime()) {
    return null;
  }
  if (user.sessionsValidFrom && session.loginAt < user.sessionsValidFrom.getTime()) {
    return null;
  }
  return user;
}
