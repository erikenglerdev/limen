// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Break-Glass-Admin-Recovery (NUR mit Server-/DB-Zugriff ausführbar).
 * Notfall-Pfad, falls niemand mehr in die Verwaltung kommt (z.B. letzter Admin hat
 * alle 2FA-Faktoren verloren).
 *
 * Aufruf:
 *   DATABASE_URL=... ENCRYPTION_KEY=... \
 *     npm run admin:recover -- --user <username> [--reset-2fa] [--make-admin] \
 *       [--activate] [--password <neues-passwort>]
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  auditLog,
  db,
  pool,
  refreshTokens,
  totpRecoveryCodes,
  users,
  webauthnCredentials,
} from '../db';
import { hashPassword, validatePasswordStrength } from '../lib/password';

function getArg(name: string): string | undefined {
  const argv = process.argv;
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const pref = `--${name}=`;
  const eq2 = argv.find((a) => a.startsWith(pref));
  return eq2 ? eq2.slice(pref.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.log(
    'Verwendung: npm run admin:recover -- --user <username> ' +
      '[--reset-2fa] [--make-admin] [--activate] [--password <pw>]',
  );
  process.exit(1);
}

async function main() {
  const username = getArg('user');
  if (!username) usage();

  const resetMfa = hasFlag('reset-2fa');
  const makeAdmin = hasFlag('make-admin');
  const activate = hasFlag('activate');
  const password = getArg('password');

  if (!resetMfa && !makeAdmin && !activate && !password) {
    console.error('Keine Aktion angegeben.');
    usage();
  }
  if (password) {
    const weak = validatePasswordStrength(password);
    if (weak) {
      console.error(`Passwort ungültig: ${weak}`);
      process.exit(1);
    }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
    .limit(1);
  if (!user) {
    console.error(`Konto '${username}' nicht gefunden.`);
    process.exit(1);
  }

  const now = new Date();
  // Ein 2FA-Reset oder Passwortwechsel ist meist eine Reaktion auf Kompromittierung →
  // bestehende SSO-Sessions + Refresh-Tokens des Kontos beenden.
  const invalidateSessions = resetMfa || !!password;
  const set: Partial<typeof users.$inferInsert> = { updatedAt: now };
  if (makeAdmin) set.isSsoAdmin = true;
  if (activate) set.isActive = true;
  if (resetMfa) {
    set.totpEnabled = false;
    set.totpSecretEnc = null;
  }
  if (password) {
    set.passwordHash = await hashPassword(password);
    set.passwordChangedAt = now;
  }
  if (invalidateSessions) set.sessionsValidFrom = now;

  const done = [
    resetMfa && '2FA/Passkeys zurückgesetzt',
    makeAdmin && 'zum Admin gemacht',
    activate && 'aktiviert',
    password && 'Passwort gesetzt',
    invalidateSessions && 'Sitzungen/Tokens beendet',
  ]
    .filter(Boolean)
    .join(', ');

  await db.transaction(async (tx) => {
    await tx.update(users).set(set).where(eq(users.id, user.id));
    if (resetMfa) {
      await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
      await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id));
    }
    if (invalidateSessions) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    }
    await tx.insert(auditLog).values({
      actorUsername: 'break-glass (CLI)',
      action: 'admin.break_glass',
      targetUserId: user.id,
      targetLabel: user.username,
      detail: done,
    });
  });

  console.log(`✅ '${user.username}': ${done}.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
