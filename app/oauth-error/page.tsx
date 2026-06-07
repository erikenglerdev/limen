// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
export const dynamic = 'force-dynamic';

// Nur bekannte OAuth/OIDC-Fehlercodes mit serverseitig festen Texten anzeigen.
// Weder error_description noch ein roher error-Wert aus der URL werden gespiegelt
// (verhindert Content-Spoofing/Phishing auf der vertrauenswürdigen SSO-Domain).
const KNOWN_ERRORS: Record<string, string> = {
  invalid_client: 'Die anfragende Anwendung ist unbekannt oder nicht registriert.',
  invalid_request: 'Die Anfrage der Anwendung war ungültig.',
  invalid_scope: 'Der angeforderte Berechtigungsumfang ist ungültig.',
  unsupported_response_type: 'Der angeforderte Antworttyp wird nicht unterstützt.',
  access_denied: 'Der Zugriff wurde abgelehnt.',
  server_error: 'Beim Anmeldedienst ist ein interner Fehler aufgetreten.',
};

export default async function OAuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const code = typeof error === 'string' && error in KNOWN_ERRORS ? error : 'unbekannt';
  const message =
    KNOWN_ERRORS[code] ?? 'Es ist ein unbekannter Fehler aufgetreten.';

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8">
        <h1 className="mb-1 text-2xl font-bold text-red-700">Anmeldung fehlgeschlagen</h1>
        <p className="mb-4 text-sm text-slate-500">
          Die anfragende Anwendung hat eine ungültige Anfrage gestellt.
        </p>
        <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
          <div>
            <span className="font-medium text-slate-700">Fehler:</span>{' '}
            <code className="text-red-700">{code}</code>
          </div>
          <div className="text-slate-600">{message}</div>
        </div>
        <p className="mt-6 text-xs text-slate-400">
          Wenden Sie sich bei wiederholten Problemen an die SSO-Administration.
        </p>
      </div>
    </main>
  );
}
