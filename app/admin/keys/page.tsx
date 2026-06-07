// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { desc } from 'drizzle-orm';
import { db, signingKeys } from '@/db';
import { ConfirmButton } from '@/components/ConfirmButton';
import { requireAdmin } from '@/lib/auth';
import { rotateKeysAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminKeysPage() {
  await requireAdmin();
  const keys = await db.select().from(signingKeys).orderBy(desc(signingKeys.createdAt));

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-2 text-lg font-semibold">Signaturschlüssel (RS256)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Beim Rotieren wird ein neuer aktiver Schlüssel erzeugt; der bisherige bleibt
          zur Validierung bereits ausgestellter Tokens noch im JWKS und wird nach einer
          Karenzzeit automatisch entfernt.
        </p>
        <ConfirmButton
          action={rotateKeysAction}
          label="Schlüssel rotieren"
          className="btn-primary"
          title="Neuen Signaturschlüssel erzeugen?"
          message="Neue Tokens werden mit dem neuen Schlüssel signiert; der alte bleibt kurz im JWKS gültig."
          confirmLabel="Rotieren"
        />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold">Im JWKS veröffentlicht ({keys.length})</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {keys.map((k) => (
            <li key={k.kid} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="break-all font-mono text-xs">{k.kid}</span>
                  {k.active ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      aktiv
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      auslaufend
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {k.alg} · erstellt {k.createdAt.toLocaleString('de-DE')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
