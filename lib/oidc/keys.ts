// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { desc, eq } from 'drizzle-orm';
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  type JWK,
} from 'jose';
import { nanoid } from 'nanoid';
import { db, signingKeys, type SigningKey } from '@/db';
import { decryptSecret, encryptSecret } from '../crypto';

type PrivateKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface ActiveKey {
  kid: string;
  privateKey: PrivateKey;
  publicJwk: JWK;
}

/** Erzeugt reines Schlüsselmaterial (ohne DB-Zugriff) für Insert/Rotation. */
async function buildKeyMaterial(): Promise<{
  kid: string;
  publicJwk: JWK;
  privatePemEnc: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const kid = nanoid();
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const pem = await exportPKCS8(privateKey);
  return { kid, publicJwk, privatePemEnc: encryptSecret(pem) };
}

/** Erzeugt ein neues RS256-Schlüsselpaar und speichert es (privater PEM verschlüsselt). */
export async function generateSigningKey(active = true): Promise<SigningKey> {
  const m = await buildKeyMaterial();
  const [row] = await db
    .insert(signingKeys)
    .values({ kid: m.kid, alg: 'RS256', publicJwk: m.publicJwk, privatePemEnc: m.privatePemEnc, active })
    .returning();
  return row;
}

/** Stellt sicher, dass mindestens ein aktiver Schlüssel existiert. */
export async function ensureSigningKey(): Promise<void> {
  const [existing] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.active, true))
    .limit(1);
  if (!existing) await generateSigningKey(true);
}

/** Aktiver Schlüssel zum Signieren (privater Key importiert). */
export async function getActiveSigningKey(): Promise<ActiveKey> {
  const [row] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.active, true))
    .orderBy(desc(signingKeys.createdAt))
    .limit(1);
  if (!row) throw new Error('Kein aktiver Signaturschlüssel vorhanden');
  const privateKey = await importPKCS8(decryptSecret(row.privatePemEnc), 'RS256');
  return { kid: row.kid, privateKey, publicJwk: row.publicJwk as JWK };
}

/** Alle öffentlichen Schlüssel (aktiv + rotiert) für den JWKS-Endpunkt. */
export async function getJwks(): Promise<{ keys: JWK[] }> {
  const rows = await db.select().from(signingKeys);
  return { keys: rows.map((r) => r.publicJwk as JWK) };
}

/**
 * Rotation: alle aktiven Schlüssel deaktivieren (bleiben im JWKS) und neuen aktiven
 * erzeugen — atomar in einer Transaktion, damit nie ein committeter Zustand ohne
 * aktiven Key entsteht (auch nicht bei Fehler). Schlüsselmaterial wird vor der
 * Transaktion erzeugt, um die TX kurz zu halten.
 */
export async function rotateSigningKey(): Promise<SigningKey> {
  const m = await buildKeyMaterial();
  return db.transaction(async (tx) => {
    await tx.update(signingKeys).set({ active: false }).where(eq(signingKeys.active, true));
    const [row] = await tx
      .insert(signingKeys)
      .values({
        kid: m.kid,
        alg: 'RS256',
        publicJwk: m.publicJwk,
        privatePemEnc: m.privatePemEnc,
        active: true,
      })
      .returning();
    return row;
  });
}
