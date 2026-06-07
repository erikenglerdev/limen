// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness/Readiness inkl. DB-Ping. 200 = ok, 503 = DB nicht erreichbar. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json(
      { status: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'error' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
