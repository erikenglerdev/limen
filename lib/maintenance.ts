// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, eq, lt } from 'drizzle-orm';
import { authCodes, db, loginAttempts, refreshTokens, signingKeys } from '@/db';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Entfernt abgelaufene/obsolete Datensätze:
 * - abgelaufene Auth-Codes
 * - abgelaufene Refresh-Tokens (widerrufene, aber noch gültige bleiben für Reuse-Detection)
 * - Login-Versuche älter als 30 Tage (Anmeldeverlauf im Konto)
 * - inaktive Signaturschlüssel älter als 2 Tage (Grace weit über Token-Laufzeit)
 */
export async function pruneExpired(): Promise<void> {
  const now = new Date();
  await db.delete(authCodes).where(lt(authCodes.expiresAt, now));
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - 30 * DAY)));
  await db
    .delete(signingKeys)
    .where(
      and(
        eq(signingKeys.active, false),
        lt(signingKeys.createdAt, new Date(now.getTime() - 2 * DAY)),
      ),
    );
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Startet den täglichen Aufräum-Job (idempotent, einmal pro Prozess). */
export function startMaintenance(): void {
  if (timer) return;
  timer = setInterval(() => {
    void pruneExpired().catch(() => {});
  }, DAY);
  if (typeof timer.unref === 'function') timer.unref();
}
