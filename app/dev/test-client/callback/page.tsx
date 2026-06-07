// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { notFound } from 'next/navigation';
import { TestClientCallback } from '@/components/dev/TestClientCallback';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function TestClientCallbackPage() {
  if (getEnv().NODE_ENV === 'production') notFound();
  return <TestClientCallback />;
}
