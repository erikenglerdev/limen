// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import Link from 'next/link';

export default function LoggedOutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <h1 className="mb-1 text-2xl font-bold">Abgemeldet</h1>
        <p className="mb-6 text-sm text-slate-500">
          Sie wurden erfolgreich von Ihrem Konto abgemeldet.
        </p>
        <Link href="/login" className="btn-primary w-full">
          Erneut anmelden
        </Link>
      </div>
    </main>
  );
}
