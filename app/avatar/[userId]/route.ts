// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, users } from '@/db';
import { readAvatar } from '@/lib/avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  // Nicht-UUID würde in Postgres (uuid-Spalte) einen 500 werfen → sauber als 404 abfangen.
  if (!UUID_RE.test(userId)) return new NextResponse(null, { status: 404 });

  const [user] = await db
    .select({ avatarPath: users.avatarPath, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.isActive || !user.avatarPath) {
    return new NextResponse(null, { status: 404 });
  }

  const data = await readAvatar(user.avatarPath);
  if (!data) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
