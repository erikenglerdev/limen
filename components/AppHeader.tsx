// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import Link from 'next/link';
import type { User } from '@/db';
import { Avatar } from './Avatar';

export function AppHeader({ user }: { user: User }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
        <Link
          href="/konto"
          className="flex items-center gap-2 font-semibold text-slate-900"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/limen-logo.png" alt="" width={28} height={28} className="rounded-lg" />
          Limen
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/konto" className="text-slate-600 hover:text-slate-900">
            Konto
          </Link>
          {user.isSsoAdmin && (
            <Link href="/admin" className="text-slate-600 hover:text-slate-900">
              Verwaltung
            </Link>
          )}
          <a href="/logout" className="text-slate-600 hover:text-slate-900">
            Abmelden
          </a>
          <Avatar
            name={user.name}
            src={user.avatarPath ? `/avatar/${user.id}?v=${user.updatedAt.getTime()}` : null}
            size={32}
          />
        </nav>
      </div>
    </header>
  );
}
