// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  var __ssoPool: Pool | undefined;
}

// Pool über Hot-Reloads hinweg wiederverwenden (Dev), in Prod einmalig.
const pool =
  global.__ssoPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    // Bei Pool-Erschöpfung begrenzt scheitern statt unbegrenzt blockieren (DoS-Hygiene).
    connectionTimeoutMillis: 5000,
    // Ungenutzte Verbindungen nach 30s schließen.
    idleTimeoutMillis: 30000,
  });

if (process.env.NODE_ENV !== 'production') {
  global.__ssoPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
export * from './schema';
