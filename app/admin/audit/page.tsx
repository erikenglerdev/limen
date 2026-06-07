// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { desc } from 'drizzle-orm';
import { auditLog, db } from '@/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'user.create': 'Konto angelegt',
  'user.activate': 'Konto aktiviert',
  'user.deactivate': 'Konto deaktiviert',
  'user.grant_admin': 'Zu Admin gemacht',
  'user.revoke_admin': 'Adminrechte entzogen',
  'user.reset_password': 'Passwort zurückgesetzt',
  'user.update': 'Konto bearbeitet',
  'user.delete': 'Konto gelöscht',
  'client.create': 'Anwendung registriert',
  'client.update': 'Anwendung bearbeitet',
  'client.rotate_secret': 'Client-Secret rotiert',
  'client.delete': 'Anwendung gelöscht',
  'signing_key.rotate': 'Signaturschlüssel rotiert',
};

export default async function AdminAuditPage() {
  await requireAdmin();
  const entries = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-semibold">Audit-Protokoll</h2>
        <p className="text-sm text-slate-500">Die letzten {entries.length} Ereignisse.</p>
      </div>
      {entries.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">Noch keine Einträge.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 text-sm">
              <span className="w-40 shrink-0 text-xs text-slate-400">
                {e.createdAt.toLocaleString('de-DE')}
              </span>
              <span className="font-medium text-slate-800">
                {ACTION_LABELS[e.action] ?? e.action}
              </span>
              <span className="text-slate-500">
                von <span className="font-medium">{e.actorUsername ?? '—'}</span>
                {e.targetLabel ? (
                  <>
                    {' '}· Ziel: <span className="font-medium">{e.targetLabel}</span>
                  </>
                ) : null}
                {e.detail ? ` · ${e.detail}` : ''}
                {e.ip ? ` · ${e.ip}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
