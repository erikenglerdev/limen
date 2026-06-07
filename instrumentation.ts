// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Next.js Instrumentation: läuft einmalig beim Serverstart (Node-Runtime).
 * Führt Migrationen, Admin-Seed und Signaturschlüssel-Bootstrap aus.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { bootstrap } = await import('./lib/bootstrap');
  await bootstrap();
}
