'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { db, totpRecoveryCodes, users } from '@/db';
import { logAudit } from '@/lib/audit';
import { factorChangeNeedsStepUp, STEP_UP_REQUIRED_MSG } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { getCurrentUser, getSession } from '@/lib/session';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from '@/lib/totp';

export type TotpState = {
  error?: string;
  success?: string;
  recoveryCodes?: string[];
};

/** Startet die Einrichtung: erzeugt ein (noch inaktives) Secret und liefert QR + Klartext. */
export async function startTotpSetup(): Promise<{
  ok: boolean;
  qr?: string;
  secret?: string;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Nicht angemeldet.' };
  if (user.totpEnabled) return { ok: false, error: '2FA ist bereits aktiv.' };
  // Wer bereits einen Passkey hat, muss zum Aktivieren von TOTP eine MFA-Sitzung haben.
  if (await factorChangeNeedsStepUp(user)) return { ok: false, error: STEP_UP_REQUIRED_MSG };

  const secret = generateTotpSecret();
  await db
    .update(users)
    // totpLastUsedStep zurücksetzen: das neue Secret beginnt mit unverbrauchtem Zähler,
    // sonst könnte ein stale Wert die erste Anmeldung mit dem neuen Code blockieren.
    .set({
      totpSecretEnc: encryptTotpSecret(secret),
      totpEnabled: false,
      totpLastUsedStep: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const qr = await QRCode.toDataURL(totpUri(secret, user.username));
  return { ok: true, qr, secret };
}

/** Bestätigt die Einrichtung mit einem Code, aktiviert 2FA und gibt Recovery-Codes zurück. */
export async function confirmTotpSetup(
  _prev: TotpState,
  formData: FormData,
): Promise<TotpState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  if (user.totpEnabled) return { error: '2FA ist bereits aktiv.' };
  if (!user.totpSecretEnc) return { error: 'Bitte zuerst die Einrichtung starten.' };
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };

  const code = String(formData.get('code') ?? '');
  if (!verifyTotp(decryptTotpSecret(user.totpSecretEnc), code)) {
    return { error: 'Code ungültig. Bitte erneut versuchen.' };
  }

  const codes = generateRecoveryCodes(8);
  // Idempotent aktivieren: nur der erste (gewinnende) Submit aktiviert + erzeugt Codes.
  // Ein konkurrierender Doppel-Submit findet totpEnabled bereits true → kein zweiter
  // Recovery-Satz, der den ersten überschreibt.
  const enabled = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(users)
      .set({ totpEnabled: true, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.totpEnabled, false)))
      .returning({ id: users.id });
    if (!claimed) return false;
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
    await tx.insert(totpRecoveryCodes).values(
      codes.map((c) => ({ userId: user.id, codeHash: sha256(normalizeRecoveryCode(c)) })),
    );
    return true;
  });
  if (!enabled) return { error: '2FA ist bereits aktiv.' };
  // Der bestätigte Code beweist Besitz des Faktors → diese Sitzung ist jetzt MFA-stark.
  // Dadurch entfällt das verwirrende, sofortige erneute Bestätigen direkt nach dem
  // Einrichten des ERSTEN Faktors (Bootstrap aus einer reinen Passwort-Sitzung). Kein
  // Eskalations-Risiko: hätte das Konto schon einen Faktor und die Sitzung wäre nur per
  // Passwort erstellt, hätte factorChangeNeedsStepUp() oben bereits abgebrochen – dieser
  // Pfad wird dann gar nicht erreicht. Der Schutz vor Passwort-Kenner-Eskalation (Entfernen/
  // Ändern eines BESTEHENDEN Faktors braucht eine MFA-Sitzung) bleibt damit voll erhalten.
  const session = await getSession();
  session.mfa = true;
  await session.save();
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'totp.enable',
  });
  revalidatePath('/konto');
  return { success: 'Zwei-Faktor-Authentisierung aktiviert.', recoveryCodes: codes };
}

/** Erzeugt neue Recovery-Codes (ersetzt alte). Nur bei aktiver 2FA, MFA-Sitzung nötig. */
export async function regenerateRecoveryCodes(): Promise<{
  codes?: string[];
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  if (!user.totpEnabled) return { error: 'Zwei-Faktor-Authentisierung ist nicht aktiv.' };
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };

  const codes = generateRecoveryCodes(8);
  await db.transaction(async (tx) => {
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
    await tx.insert(totpRecoveryCodes).values(
      codes.map((c) => ({ userId: user.id, codeHash: sha256(normalizeRecoveryCode(c)) })),
    );
  });
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'totp.recovery_regenerate',
  });
  revalidatePath('/konto');
  return { codes };
}

/** Deaktiviert 2FA (MFA-Sitzung erforderlich). */
export async function disableTotp(
  _prev: TotpState,
  _formData: FormData,
): Promise<TotpState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Nicht angemeldet.' };
  if (await factorChangeNeedsStepUp(user)) return { error: STEP_UP_REQUIRED_MSG };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ totpEnabled: false, totpSecretEnc: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
  });
  await logAudit({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'totp.disable',
  });
  revalidatePath('/konto');
  return { success: 'Zwei-Faktor-Authentisierung deaktiviert.' };
}
