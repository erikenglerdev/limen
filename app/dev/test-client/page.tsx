// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { notFound } from 'next/navigation';
import { TestClient } from '@/components/dev/TestClient';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function TestClientPage() {
  if (getEnv().NODE_ENV === 'production') notFound();
  return <TestClient />;
}
