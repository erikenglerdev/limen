// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { NextResponse } from 'next/server';
import { discoveryDocument } from '@/lib/oidc/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(discoveryDocument(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
