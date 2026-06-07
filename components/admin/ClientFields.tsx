// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/** Gemeinsame Formularfelder für Registrierung/Bearbeitung einer Client-App. */
export function ClientFields({
  idPrefix,
  defaults,
}: {
  idPrefix: string;
  defaults?: {
    name?: string;
    redirectUris?: string[];
    postLogoutRedirectUris?: string[];
    isFirstParty?: boolean;
    isConfidential?: boolean;
    allowedScopes?: string[];
  };
}) {
  const d = defaults ?? {};
  // Default für neue Clients: vertraulich = true, first-party = true.
  const confidential = d.isConfidential ?? true;
  const firstParty = d.isFirstParty ?? true;
  // Leere allowedScopes = keine Einschränkung → in der UI alles erlaubt anzeigen.
  const noScopeRestriction = !d.allowedScopes || d.allowedScopes.length === 0;
  const profileAllowed = noScopeRestriction || d.allowedScopes!.includes('profile');
  const emailAllowed = noScopeRestriction || d.allowedScopes!.includes('email');

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          className="input"
          defaultValue={d.name ?? ''}
          autoComplete="off"
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-redirect`}>
          Redirect-URIs (eine pro Zeile, exakter Match)
        </label>
        <textarea
          id={`${idPrefix}-redirect`}
          name="redirectUris"
          className="input min-h-20 font-mono text-xs"
          defaultValue={(d.redirectUris ?? []).join('\n')}
          placeholder="https://app.example.de/api/auth/callback/limen"
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-postlogout`}>
          Post-Logout-Redirect-URIs (eine pro Zeile, optional)
        </label>
        <textarea
          id={`${idPrefix}-postlogout`}
          name="postLogoutUris"
          className="input min-h-16 font-mono text-xs"
          defaultValue={(d.postLogoutRedirectUris ?? []).join('\n')}
          placeholder="https://app.example.de/"
        />
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isFirstParty"
            defaultChecked={firstParty}
            className="h-4 w-4 rounded border-slate-300"
          />
          First-Party (Consent-Screen wird übersprungen)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isConfidential"
            defaultChecked={confidential}
            className="h-4 w-4 rounded border-slate-300"
          />
          Vertraulich (client_secret erforderlich)
        </label>
      </div>

      <div>
        <span className="label">Erlaubte Scopes (openid immer)</span>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="scope_profile"
              defaultChecked={profileAllowed}
              className="h-4 w-4 rounded border-slate-300"
            />
            profile (Name, Benutzername, Avatar)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="scope_email"
              defaultChecked={emailAllowed}
              className="h-4 w-4 rounded border-slate-300"
            />
            email (E-Mail-Adresse)
          </label>
        </div>
      </div>
    </div>
  );
}
