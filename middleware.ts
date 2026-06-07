// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { getIronSession } from 'iron-session';
import { type NextRequest, NextResponse } from 'next/server';
import { type SessionData, sessionOptions } from '@/lib/session-config';

// Geschützte Bereiche, in denen die Session gleitend erneuert wird.
const PROTECTED = /^\/(konto|admin|authorize)(\/|$)/;

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function buildCsp(nonce: string, full: boolean): string {
  if (!full) {
    // Dev: nur Clickjacking-Schutz, um die HMR-Inline-Skripte nicht zu brechen.
    return "frame-ancestors 'none'";
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  const full = process.env.NODE_ENV === 'production';
  const nonce = generateNonce();
  const csp = buildCsp(nonce, full);

  // CSP auf den Request setzen, damit Next seine eigenen <script>-Tags mit dem Nonce
  // versieht; identische CSP auf die Response für die Durchsetzung im Browser.
  const requestHeaders = new Headers(req.headers);
  if (full) {
    requestHeaders.set('content-security-policy', csp);
    requestHeaders.set('x-nonce', nonce);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);

  // Gleitendes 7-Tage-Fenster nur bei GET-Navigationen in geschützten Bereichen.
  // Wichtig: NICHT bei POST – sonst würde diese Re-Save mit Session-schreibenden
  // Server-Actions (Step-up/MFA, „Überall abmelden", Passwortänderung) kollidieren
  // (doppeltes Set-Cookie → die Änderung der Action könnte verloren gehen).
  if (req.method === 'GET' && PROTECTED.test(req.nextUrl.pathname)) {
    const session = await getIronSession<SessionData>(req, res, sessionOptions());
    if (session.userId) await session.save();
  }

  return res;
}

export const config = {
  // Alle Seiten/Routen außer statischen Assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
