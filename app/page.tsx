// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? '/konto' : '/login');
}
