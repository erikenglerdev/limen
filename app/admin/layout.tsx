// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import Link from 'next/link';
import { AppHeader } from '@/components/AppHeader';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  return (
    <>
      <AppHeader user={admin} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-bold">Verwaltung</h1>
        <nav className="mb-6 flex flex-wrap gap-2">
          <Link href="/admin" className="btn-secondary btn-sm">
            Konten
          </Link>
          <Link href="/admin/clients" className="btn-secondary btn-sm">
            Anwendungen
          </Link>
          <Link href="/admin/keys" className="btn-secondary btn-sm">
            Schlüssel
          </Link>
          <Link href="/admin/audit" className="btn-secondary btn-sm">
            Protokoll
          </Link>
        </nav>
        {children}
      </div>
    </>
  );
}
