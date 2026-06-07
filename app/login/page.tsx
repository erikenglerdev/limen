// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { getCurrentUser } from '@/lib/session';
import { safeReturnTo } from '@/lib/return-to';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const user = await getCurrentUser();
  if (user) {
    redirect(safeReturnTo(return_to));
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/limen-logo.png"
            alt="Limen"
            width={56}
            height={56}
            className="rounded-xl"
          />
          <h1 className="mt-3 text-2xl font-bold">Limen</h1>
          <p className="text-sm text-slate-500">Zentrale Anmeldung</p>
        </div>
        <LoginForm returnTo={return_to} />
      </div>
    </main>
  );
}
