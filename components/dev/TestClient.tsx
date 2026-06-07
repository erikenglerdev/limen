'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return base64url(new Uint8Array(digest));
}

export function TestClient() {
  async function start() {
    const origin = window.location.origin;
    const verifier = randomString(48);
    const challenge = await sha256b64url(verifier);
    const state = randomString(16);
    const nonce = randomString(16);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oidc_state', state);

    const url = new URL('/authorize', origin);
    url.searchParams.set('client_id', 'dev-client');
    url.searchParams.set('redirect_uri', `${origin}/dev/test-client/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.href = url.toString();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="mb-1 text-2xl font-bold">OIDC Test-Client</h1>
        <p className="mb-6 text-sm text-slate-500">
          Nur für Entwicklung. Spielt den Authorization-Code-Flow mit PKCE (S256)
          gegen dieses SSO durch (Client&nbsp;<code>dev-client</code>).
        </p>
        <button type="button" className="btn-primary w-full" onClick={start}>
          Mit Limen anmelden
        </button>
      </div>
    </main>
  );
}
