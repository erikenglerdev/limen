'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useEffect, useState } from 'react';

interface Result {
  tokens: Record<string, unknown>;
  idClaims: Record<string, unknown>;
  userinfo: Record<string, unknown>;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(part))));
}

export function TestClientCallback() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sp = new URLSearchParams(window.location.search);
      const err = sp.get('error');
      if (err) {
        setError(`${err}: ${sp.get('error_description') ?? ''}`);
        return;
      }
      const code = sp.get('code') ?? '';
      const state = sp.get('state');
      if (state !== sessionStorage.getItem('oidc_state')) {
        setError('state stimmt nicht überein (möglicher CSRF).');
        return;
      }
      const verifier = sessionStorage.getItem('pkce_verifier') ?? '';
      const origin = window.location.origin;

      const tokenRes = await fetch('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${origin}/dev/test-client/callback`,
          code_verifier: verifier,
          client_id: 'dev-client',
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok) {
        setError(`Token-Fehler: ${JSON.stringify(tokens)}`);
        return;
      }

      const userinfoRes = await fetch('/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userinfo = await userinfoRes.json();

      setResult({
        tokens,
        idClaims: decodeJwtPayload(tokens.id_token),
        userinfo,
      });
    })().catch((e) => setError(String(e)));
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const logoutUrl = `/logout?client_id=dev-client&post_logout_redirect_uri=${encodeURIComponent(`${origin}/dev/test-client`)}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">OIDC Test-Client – Ergebnis</h1>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {!result && !error && <p className="text-slate-500">Tausche Code gegen Tokens…</p>}
      {result && (
        <div className="space-y-4">
          <Section title="ID-Token Claims" data={result.idClaims} />
          <Section title="UserInfo" data={result.userinfo} />
          <Section title="Token-Antwort" data={result.tokens} />
          <a href={logoutUrl} className="btn-secondary">
            Abmelden (RP-initiated logout)
          </a>
        </div>
      )}
    </main>
  );
}

function Section({ title, data }: { title: string; data: unknown }) {
  return (
    <section className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}
