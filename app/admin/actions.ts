'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, totpRecoveryCodes, users, webauthnCredentials } from '@/db';
import { logAdminAction } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { deleteAvatar } from '@/lib/avatar';
import { revokeAllUserRefreshTokens } from '@/lib/oidc/tokens';
import { hashPassword, validatePasswordStrength } from '@/lib/password';

export type FormState = { error?: string; success?: string };

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function activeAdminCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.isSsoAdmin, true), eq(users.isActive, true)));
  return row?.c ?? 0;
}

function flash(kind: 'error' | 'ok', message: string): never {
  redirect(`/admin?${kind}=${encodeURIComponent(message)}`);
}

export async function createUser(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const username = String(formData.get('username') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const isAdmin = formData.get('isSsoAdmin') === 'on';

  if (!USERNAME_RE.test(username)) {
    return { error: 'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern und . _ -' };
  }
  if (name.length < 1) return { error: 'Der Name darf nicht leer sein.' };
  if (email && !EMAIL_RE.test(email)) return { error: 'Ungültige E-Mail-Adresse.' };
  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
    .limit(1);
  if (existing) return { error: 'Dieser Benutzername ist bereits vergeben.' };

  const [created] = await db
    .insert(users)
    .values({
      username,
      name,
      email: email || null,
      passwordHash: await hashPassword(password),
      isSsoAdmin: isAdmin,
      isActive: true,
    })
    .returning({ id: users.id });
  await logAdminAction(admin, 'user.create', {
    targetUserId: created.id,
    targetLabel: username,
    detail: isAdmin ? 'als SSO-Admin' : null,
  });
  revalidatePath('/admin');
  return { success: `Konto „${username}" wurde angelegt.` };
}

export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<{ error?: string } | void> {
  const admin = await requireAdmin();

  if (userId === admin.id && !active) {
    return { error: 'Sie können sich nicht selbst deaktivieren.' };
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { error: 'Konto nicht gefunden.' };

  if (!active && target.isSsoAdmin && target.isActive && (await activeAdminCount()) <= 1) {
    return { error: 'Der letzte aktive Administrator kann nicht deaktiviert werden.' };
  }

  const now = new Date();
  // Beim Deaktivieren bestehende SSO-Sessions invalidieren (sessionsValidFrom), damit alte
  // Cookies nach einer späteren Reaktivierung nicht wieder gültig werden, und Refresh-Tokens
  // widerrufen → Deaktivierung wirkt als echter Kill-Switch.
  await db
    .update(users)
    .set({
      isActive: active,
      updatedAt: now,
      ...(active ? {} : { sessionsValidFrom: now }),
    })
    .where(eq(users.id, userId));
  if (!active) await revokeAllUserRefreshTokens(userId);
  await logAdminAction(admin, active ? 'user.activate' : 'user.deactivate', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  revalidatePath('/admin');
}

export async function toggleAdmin(
  userId: string,
  makeAdmin: boolean,
): Promise<{ error?: string } | void> {
  const admin = await requireAdmin();

  if (userId === admin.id && !makeAdmin) {
    return { error: 'Sie können sich nicht selbst die Administratorrechte entziehen.' };
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { error: 'Konto nicht gefunden.' };

  if (!makeAdmin && target.isSsoAdmin && (await activeAdminCount()) <= 1) {
    return { error: 'Der letzte Administrator kann nicht herabgestuft werden.' };
  }

  await db
    .update(users)
    .set({ isSsoAdmin: makeAdmin, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logAdminAction(admin, makeAdmin ? 'user.grant_admin' : 'user.revoke_admin', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  revalidatePath('/admin');
}

export async function resetPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const password = String(formData.get('password') ?? '');

  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };

  const [target] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { error: 'Konto nicht gefunden.' };

  const now = new Date();
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  // Sicherheitsaktion: bestehende App-Sitzungen des Kontos beenden; vorhandene
  // SSO-Sessions werden über passwordChangedAt ungültig.
  await revokeAllUserRefreshTokens(userId);
  await logAdminAction(admin, 'user.reset_password', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  return { success: 'Passwort zurückgesetzt. Bestehende Sitzungen wurden beendet.' };
}

/** Admin bearbeitet Stammdaten (Name, E-Mail) eines beliebigen Kontos. */
export async function updateUserProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const emailRaw = String(formData.get('email') ?? '').trim();

  if (name.length < 1) return { error: 'Der Name darf nicht leer sein.' };
  if (name.length > 200) return { error: 'Der Name ist zu lang.' };
  if (emailRaw && !EMAIL_RE.test(emailRaw)) {
    return { error: 'Ungültige E-Mail-Adresse.' };
  }

  const [target] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { error: 'Konto nicht gefunden.' };

  await db
    .update(users)
    .set({ name, email: emailRaw || null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logAdminAction(admin, 'user.update', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  revalidatePath('/admin');
  return { success: 'Konto aktualisiert.' };
}

/**
 * Löscht ein Konto endgültig. Nur möglich, wenn das Konto zuvor deaktiviert wurde
 * (und nicht das eigene). FK-Cascade entfernt zugehörige Auth-Codes/Refresh-Tokens.
 */
export async function deleteUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');

  if (userId === admin.id) {
    flash('error', 'Sie können Ihr eigenes Konto nicht löschen.');
  }

  // Bestätigung durch Eingabe des Wortes „LÖSCHEN" (auch serverseitig erzwungen).
  if (String(formData.get('confirm') ?? '') !== 'LÖSCHEN') {
    flash('error', 'Löschen nicht bestätigt – bitte das Wort LÖSCHEN eingeben.');
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) flash('error', 'Konto nicht gefunden.');
  if (target.isActive) {
    flash(
      'error',
      'Das Konto muss zuerst deaktiviert werden, bevor es gelöscht werden kann.',
    );
  }

  // Avatar-Datei aufräumen (Fehler hier dürfen das Löschen nicht verhindern).
  if (target.avatarPath) {
    try {
      await deleteAvatar(target.avatarPath);
    } catch {
      // ignorieren
    }
  }

  await db.delete(users).where(eq(users.id, userId));
  await logAdminAction(admin, 'user.delete', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  revalidatePath('/admin');
  flash('ok', 'Konto wurde gelöscht.');
}

/** Setzt 2FA (TOTP + Passkeys) eines Kontos zurück, z.B. bei Verlust aller Faktoren. */
export async function disableUserTotp(
  userId: string,
): Promise<{ error?: string } | void> {
  const admin = await requireAdmin();

  const [target] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { error: 'Konto nicht gefunden.' };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      // sessionsValidFrom invalidiert bestehende SSO-Sessions des Kontos: ein 2FA-Reset
      // ist oft eine Reaktion auf Kompromittierung → Angreifer-Sitzungen müssen enden.
      .set({
        totpEnabled: false,
        totpSecretEnc: null,
        sessionsValidFrom: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, userId));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
  });
  // App-Sitzungen (Refresh-Tokens) des Kontos ebenfalls beenden.
  await revokeAllUserRefreshTokens(userId);
  await logAdminAction(admin, 'twofactor.admin_reset', {
    targetUserId: userId,
    targetLabel: target.username,
  });
  revalidatePath('/admin');
}
