// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
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
