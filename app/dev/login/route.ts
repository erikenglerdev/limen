// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { type NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { startSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * NUR Entwicklung: programmatischer Login für das E2E-Verifikationsskript.
 * Setzt die sso_session-Cookie. In Produktion 404.
 */
export async function POST(req: NextRequest) {
  if (getEnv().NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const username = body?.username ? String(body.username) : '';
  const password = body?.password ? String(body.password) : '';
  if (!username || !password) {
    return NextResponse.json({ error: 'username/password fehlt' }, { status: 400 });
  }

  const result = await authenticate(username, password, null);
  if (!result.ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  await startSession(result.user.id, true); // Dev-Shortcut gilt als MFA
  return NextResponse.json({ ok: true, sub: result.user.id });
}
