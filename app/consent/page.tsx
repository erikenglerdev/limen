// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { redirect } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { SubmitButton } from '@/components/SubmitButton';
import { buildErrorRedirect, validateAuthorizeRequest } from '@/lib/oidc/authorize';
import { getCurrentUser } from '@/lib/session';
import { approveConsent, denyConsent } from './actions';

export const dynamic = 'force-dynamic';

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Ihre eindeutige Benutzerkennung',
  profile: 'Ihren Namen, Benutzernamen und ggf. Ihr Profilbild',
  email: 'Ihre E-Mail-Adresse',
};

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val === 'string') sp.set(k, val);
  }
  const params = sp.toString();

  const v = await validateAuthorizeRequest(sp);
  if (v.kind === 'error_page') {
    redirect(
      `/oauth-error?error=${encodeURIComponent(v.error)}&error_description=${encodeURIComponent(v.description)}`,
    );
  }
  if (v.kind === 'redirect_error') {
    redirect(buildErrorRedirect(v.redirectUri, v.state, v.error, v.description));
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?return_to=${encodeURIComponent(`/authorize?${params}`)}`);
  }

  const ar = v.req;
  const scopes = ar.scope.split(' ');

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="mb-1 text-2xl font-bold">Zugriff erlauben</h1>
        <p className="mb-6 text-sm text-slate-500">
          <span className="font-medium text-slate-700">{ar.client.name}</span> möchte
          sich mit Ihrem Konto anmelden.
        </p>

        <div className="mb-6 flex items-center gap-3 rounded-md bg-slate-50 p-3">
          <Avatar
            name={user.name}
            src={user.avatarPath ? `/avatar/${user.id}` : null}
            size={40}
          />
          <div className="text-sm">
            <div className="font-medium">{user.name}</div>
            <div className="text-slate-500">@{user.username}</div>
          </div>
        </div>

        <p className="mb-2 text-sm font-medium text-slate-700">
          Die Anwendung erhält Zugriff auf:
        </p>
        <ul className="mb-6 space-y-1 text-sm text-slate-600">
          {scopes.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className="mt-0.5 text-brand-600">•</span>
              <span>{SCOPE_LABELS[s] ?? s}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <form action={denyConsent}>
            <input type="hidden" name="params" value={params} />
            <SubmitButton className="btn-secondary">Ablehnen</SubmitButton>
          </form>
          <form action={approveConsent}>
            <input type="hidden" name="params" value={params} />
            <SubmitButton className="btn-primary">Zustimmen</SubmitButton>
          </form>
        </div>
      </div>
    </main>
  );
}
