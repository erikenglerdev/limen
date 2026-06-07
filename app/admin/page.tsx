// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { desc, ilike, or } from 'drizzle-orm';
import { db, users } from '@/db';
import { Alert } from '@/components/Alert';
import { Avatar } from '@/components/Avatar';
import { CreateUserForm } from '@/components/admin/CreateUserForm';
import { UserActions } from '@/components/admin/UserActions';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Escapt LIKE-Sonderzeichen, damit %/_ im Suchbegriff wörtlich gematcht werden. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; q?: string }>;
}) {
  await requireAdmin();
  const { error, ok, q } = await searchParams;
  const query = (q ?? '').trim();
  const filter = query
    ? or(
        ilike(users.username, likePattern(query)),
        ilike(users.name, likePattern(query)),
      )
    : undefined;
  const list = await db
    .select()
    .from(users)
    .where(filter)
    .orderBy(desc(users.createdAt));

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold">Neues Konto anlegen</h2>
        <CreateUserForm />
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold">
            Konten ({list.length}
            {query ? ` von Suche „${query}"` : ''})
          </h2>
          <form method="get" className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Nach Nutzername oder Name suchen…"
              aria-label="Konten durchsuchen"
              className="input h-10 w-56"
            />
            <button type="submit" className="btn btn-secondary">
              Suchen
            </button>
            {query && (
              <a href="/admin" className="btn btn-secondary">
                Zurücksetzen
              </a>
            )}
          </form>
        </div>
        {list.length === 0 && (
          <p className="p-4 text-sm text-slate-500">
            Keine Konten gefunden.
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {list.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 p-4">
              <Avatar
                name={u.name}
                src={u.avatarPath ? `/avatar/${u.id}?v=${u.updatedAt.getTime()}` : null}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  {u.isSsoAdmin && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                      Admin
                    </span>
                  )}
                  {u.totpEnabled && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      2FA
                    </span>
                  )}
                  {!u.isActive && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      deaktiviert
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  @{u.username}
                  {u.email ? ` · ${u.email}` : ''}
                </div>
              </div>
              <UserActions
                userId={u.id}
                username={u.username}
                name={u.name}
                email={u.email}
                isActive={u.isActive}
                isSsoAdmin={u.isSsoAdmin}
                totpEnabled={u.totpEnabled}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
