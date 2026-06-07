// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { NextResponse } from 'next/server';
import { getJwks } from '@/lib/oidc/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
