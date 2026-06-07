// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Rotiert den AES-Umschlüssel (ENCRYPTION_KEY): entschlüsselt alle at-rest Secrets
 * (Signaturschlüssel-PEMs + TOTP-Secrets) mit dem ALTEN Schlüssel und verschlüsselt
 * sie mit dem NEUEN neu. Alles in einer Transaktion → bei Fehler kein Teilzustand.
 *
 * Aufruf (App möglichst kurz stoppen / Wartungsfenster):
 *   ENCRYPTION_KEY_OLD=<alt-64hex> ENCRYPTION_KEY=<neu-64hex> DATABASE_URL=... \
 *     npm run rotate-encryption-key
 * Danach ENCRYPTION_KEY dauerhaft auf den neuen Wert setzen und neu starten.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { db, pool, signingKeys, users } from '../db';
import { decryptSecretWith, encryptSecretWith } from '../lib/crypto';

const HEX64 = /^[0-9a-fA-F]{64}$/;

async function main() {
  const oldKey = process.env.ENCRYPTION_KEY_OLD ?? '';
  const newKey = process.env.ENCRYPTION_KEY ?? '';

  if (!HEX64.test(oldKey)) {
    console.error('Fehler: ENCRYPTION_KEY_OLD fehlt oder ist nicht 64 Hex-Zeichen.');
    process.exit(1);
  }
  if (!HEX64.test(newKey)) {
    console.error('Fehler: ENCRYPTION_KEY (neu) fehlt oder ist nicht 64 Hex-Zeichen.');
    process.exit(1);
  }
  if (oldKey.toLowerCase() === newKey.toLowerCase()) {
    console.error('Fehler: alter und neuer Schlüssel sind identisch.');
    process.exit(1);
  }

  let keyCount = 0;
  let totpCount = 0;

  await db.transaction(async (tx) => {
    for (const row of await tx.select().from(signingKeys)) {
      const pem = decryptSecretWith(row.privatePemEnc, oldKey); // wirft bei falschem Alt-Key
      await tx
        .update(signingKeys)
        .set({ privatePemEnc: encryptSecretWith(pem, newKey) })
        .where(eq(signingKeys.kid, row.kid));
      keyCount++;
    }

    const withTotp = await tx
      .select({ id: users.id, totp: users.totpSecretEnc })
      .from(users)
      .where(isNotNull(users.totpSecretEnc));
    for (const u of withTotp) {
      if (!u.totp) continue;
      const secret = decryptSecretWith(u.totp, oldKey);
      await tx
        .update(users)
        .set({ totpSecretEnc: encryptSecretWith(secret, newKey) })
        .where(eq(users.id, u.id));
      totpCount++;
    }
  });

  console.log(`✅ Neu verschlüsselt: ${keyCount} Signaturschlüssel, ${totpCount} TOTP-Secrets.`);
  console.log('→ Jetzt ENCRYPTION_KEY dauerhaft auf den neuen Wert setzen und neu starten.');
  await pool.end();
}

main().catch((e) => {
  console.error('Rotation fehlgeschlagen (kein Schaden, Transaktion zurückgerollt):', e);
  process.exit(1);
});
