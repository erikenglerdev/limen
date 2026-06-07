// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/** Zeigt client_id und (einmalig) client_secret nach Registrierung/Rotation. */
export function CredentialsBox({
  clientId,
  secret,
}: {
  clientId?: string;
  secret?: string;
}) {
  if (!clientId && !secret) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="mb-2 font-medium text-amber-800">
        {secret
          ? 'Wichtig: Das client_secret wird nur jetzt angezeigt – sicher speichern!'
          : 'Zugangsdaten'}
      </p>
      <div className="space-y-1 break-all font-mono text-xs">
        {clientId && (
          <div>
            <span className="text-slate-500">client_id:</span> {clientId}
          </div>
        )}
        {secret && (
          <div>
            <span className="text-slate-500">client_secret:</span> {secret}
          </div>
        )}
      </div>
    </div>
  );
}
