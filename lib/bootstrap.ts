// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, oauthClients, pool, users } from '@/db';
import { getEnv } from './env';
import { pruneExpired, startMaintenance } from './maintenance';
import { ensureSigningKey } from './oidc/keys';
import { hashPassword } from './password';

// Beliebige Konstante – serialisiert den Bootstrap über mehrere Prozesse hinweg.
const LOCK_KEY = 470001;

let done = false;

/**
 * Einmaliger Startvorgang: Migrationen anwenden → ersten SSO-Admin seeden →
 * aktiven Signaturschlüssel sicherstellen. Idempotent und per Advisory-Lock
 * gegen parallele Ausführung geschützt.
 */
export async function bootstrap(): Promise<void> {
  if (done) return;
  getEnv(); // validiert Konfiguration früh und mit klarer Fehlermeldung

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
    await seedAdmin();
    await ensureSigningKey();
    await seedDevClient();
    await pruneExpired();
    startMaintenance();
    done = true;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    client.release();
  }
}

async function seedAdmin(): Promise<void> {
  const env = getEnv();
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) return;

  const identifier = env.ADMIN_USER.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, identifier))
    .limit(1);
  if (existing) return;

  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  await db.insert(users).values({
    username: env.ADMIN_USER.trim(),
    name: env.ADMIN_USER.trim(),
    passwordHash,
    isSsoAdmin: true,
    isActive: true,
  });
  // Niemals das Passwort loggen.
  console.log(`[bootstrap] SSO-Admin '${env.ADMIN_USER}' angelegt.`);
}

/** Legt außerhalb der Produktion einen first-party Public-Client für Tests an. */
async function seedDevClient(): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === 'production') return;

  const clientId = 'dev-client';
  const [existing] = await db
    .select({ id: oauthClients.id })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (existing) return;

  const base = env.APP_BASE_URL;
  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash: null,
    name: 'Dev Test-Client',
    redirectUris: [`${base}/dev/test-client/callback`],
    postLogoutRedirectUris: [`${base}/dev/test-client`],
    isConfidential: false,
    isFirstParty: true,
  });
  console.log(`[bootstrap] Dev-Client '${clientId}' angelegt.`);
}
