// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { desc } from 'drizzle-orm';
import { db, oauthClients } from '@/db';
import { Alert } from '@/components/Alert';
import { ClientItem } from '@/components/admin/ClientItem';
import { CreateClientForm } from '@/components/admin/CreateClientForm';

export const dynamic = 'force-dynamic';

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const list = await db
    .select()
    .from(oauthClients)
    .orderBy(desc(oauthClients.createdAt));

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold">Anwendung registrieren</h2>
        <CreateClientForm />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold">Anwendungen ({list.length})</h2>
        </div>
        {list.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            Noch keine Anwendungen registriert.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((c) => (
              <ClientItem
                key={c.id}
                client={{
                  id: c.id,
                  clientId: c.clientId,
                  name: c.name,
                  redirectUris: c.redirectUris,
                  postLogoutRedirectUris: c.postLogoutRedirectUris,
                  isConfidential: c.isConfidential,
                  isFirstParty: c.isFirstParty,
                  allowedScopes: c.allowedScopes,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
