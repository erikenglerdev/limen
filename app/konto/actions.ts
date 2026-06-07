'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db, users } from '@/db';
import { logAudit } from '@/lib/audit';
import { saveAvatar, deleteAvatar } from '@/lib/avatar';
import {
  revokeAllUserRefreshTokens,
  revokeAppRefreshTokens,
} from '@/lib/oidc/tokens';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from '@/lib/password';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, getSession } from '@/lib/session';

export type FormState = { error?: string; success?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function updateProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 1) return { error: 'Der Name darf nicht leer sein.' };
  if (name.length > 200) return { error: 'Der Name ist zu lang.' };

  // E-Mail ist optional; leeres Feld entfernt die hinterlegte Adresse.
  const emailRaw = String(formData.get('email') ?? '').trim();
  if (emailRaw && !EMAIL_RE.test(emailRaw)) {
    return { error: 'Ungültige E-Mail-Adresse.' };
  }
  const email = emailRaw || null;

  await db
    .update(users)
    .set({ name, email, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  revalidatePath('/konto');
  return { success: 'Profil aktualisiert.' };
}

export async function changePassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!(await verifyPassword(user.passwordHash, current))) {
    return { error: 'Das aktuelle Passwort ist falsch.' };
  }
  if (next !== confirm) {
    return { error: 'Die neuen Passwörter stimmen nicht überein.' };
  }
  const weak = validatePasswordStrength(next);
  if (weak) return { error: weak };

  const now = new Date();
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(next),
      passwordChangedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  // Alle App-Sitzungen (Refresh-Tokens) abmelden; andere SSO-Sessions werden über
  // passwordChangedAt ungültig. Die aktuelle Sitzung frisch ausstellen (loginAt bumpen),
  // damit der Nutzer hier eingeloggt bleibt – MFA-Status bleibt erhalten.
  await revokeAllUserRefreshTokens(user.id);
  const session = await getSession();
  session.userId = user.id;
  session.loginAt = Date.now();
  await session.save();

  return { success: 'Passwort geändert. Andere Sitzungen wurden abgemeldet.' };
}

export async function uploadAvatar(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };

  // Upload-Drossel pro Konto (sharp-Verarbeitung ist teuer; Uploads sind selten).
  const rl = rateLimit(`avatar:${user.id}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return { error: 'Zu viele Uploads in kurzer Zeit. Bitte später erneut versuchen.' };
  }

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Bitte eine Bilddatei auswählen.' };
  }
  // Content-Type ist spoofbar (autoritativ ist die Magic-Bytes-Prüfung in saveAvatar);
  // SVG hier dennoch früh und explizit ablehnen.
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return { error: 'Es sind nur Rasterbilder (PNG, JPEG, WebP, GIF) erlaubt.' };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = await saveAvatar(user.id, buffer);
    await db
      .update(users)
      .set({ avatarPath: filename, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch {
    // Keine rohe Exception-Message (z.B. von sharp) nach außen geben.
    return {
      error:
        'Bild konnte nicht verarbeitet werden. Bitte ein gültiges Rasterbild (PNG, JPEG, WebP, GIF, max. 5 MB) wählen.',
    };
  }
  revalidatePath('/konto');
  return { success: 'Profilbild aktualisiert.' };
}

/** Self-Service: Zugriff einer verbundenen App widerrufen (Remote-Logout). */
export async function revokeAppAccess(clientId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !clientId) return;
  await revokeAppRefreshTokens(user.id, clientId);
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'session.revoke_app',
    targetLabel: clientId,
  });
  revalidatePath('/konto');
}

/**
 * „Überall abmelden": widerruft alle Refresh-Tokens und macht alle SSO-Sessions
 * (andere Geräte) ungültig. Die aktuelle Sitzung wird frisch ausgestellt (loginAt
 * bumpen), damit der Nutzer hier eingeloggt bleibt; MFA-Status bleibt erhalten.
 */
export async function signOutEverywhere(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const now = new Date();
  await revokeAllUserRefreshTokens(user.id);
  await db
    .update(users)
    .set({ sessionsValidFrom: now, updatedAt: now })
    .where(eq(users.id, user.id));

  const session = await getSession();
  session.userId = user.id;
  session.loginAt = Date.now();
  await session.save();

  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'session.signout_all',
  });
  revalidatePath('/konto');
}

export async function removeAvatar(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  if (user.avatarPath) await deleteAvatar(user.avatarPath);
  await db
    .update(users)
    .set({ avatarPath: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  revalidatePath('/konto');
}
