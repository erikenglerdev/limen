// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { headers } from 'next/headers';
import { auditLog, db } from '@/db';
import { getClientIp } from './auth';

export interface AuditEntry {
  actorUserId?: string | null;
  actorUsername?: string | null;
  action: string;
  targetUserId?: string | null;
  targetLabel?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/** Schreibt einen Audit-Eintrag. Fehler hier dürfen die eigentliche Aktion nie scheitern lassen. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      actorUsername: entry.actorUsername ?? null,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      targetLabel: entry.targetLabel ?? null,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
    });
  } catch {
    // bewusst geschluckt
  }
}

/** Bequemer Audit-Eintrag für Admin-Aktionen: erfasst Akteur + Client-IP automatisch. */
export async function logAdminAction(
  admin: { id: string; username: string },
  action: string,
  opts?: { targetUserId?: string | null; targetLabel?: string | null; detail?: string | null },
): Promise<void> {
  let ip: string | null = null;
  try {
    ip = getClientIp(await headers());
  } catch {
    // headers() außerhalb des Request-Scopes – ignorieren
  }
  await logAudit({
    actorUserId: admin.id,
    actorUsername: admin.username,
    action,
    ip,
    ...opts,
  });
}
