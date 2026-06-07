'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState, useState } from 'react';
import {
  confirmTotpSetup,
  disableTotp,
  regenerateRecoveryCodes,
  startTotpSetup,
  type TotpState,
} from '@/app/konto/totp-actions';
import { Alert } from './Alert';
import { ConfirmButton } from './ConfirmButton';
import { SubmitButton } from './SubmitButton';

function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 font-mono text-sm">
      {codes.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}

export function TwoFactorSection({
  enabled,
  recoveryRemaining,
}: {
  enabled: boolean;
  recoveryRemaining: number;
}) {
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [confirmState, confirmAction] = useActionState<TotpState, FormData>(
    confirmTotpSetup,
    {},
  );
  const [disableState, disableAction] = useActionState<TotpState, FormData>(
    disableTotp,
    {},
  );

  async function begin() {
    setStarting(true);
    setStartErr(null);
    try {
      const res = await startTotpSetup();
      if (!res.ok || !res.qr || !res.secret) {
        setStartErr(res.error ?? 'Einrichtung fehlgeschlagen.');
      } else {
        setSetup({ qr: res.qr, secret: res.secret });
      }
    } catch {
      setStartErr('Einrichtung fehlgeschlagen.');
    } finally {
      setStarting(false);
    }
  }

  // Nach erfolgreicher Aktivierung: Recovery-Codes einmalig anzeigen.
  if (confirmState.recoveryCodes) {
    return (
      <div className="space-y-3">
        <Alert kind="success">{confirmState.success}</Alert>
        <p className="text-sm text-slate-600">
          Bewahren Sie diese Recovery-Codes sicher auf – sie werden{' '}
          <strong>nur jetzt</strong> angezeigt und ermöglichen den Login, falls Sie
          Ihren Authenticator verlieren. Jeder Code ist einmalig nutzbar.
        </p>
        <RecoveryCodeList codes={confirmState.recoveryCodes} />
      </div>
    );
  }

  // 2FA aktiv: Recovery-Codes neu / Deaktivierung (Step-up-gated über die Sitzung).
  if (enabled) {
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-green-700">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          Zwei-Faktor-Authentisierung ist aktiv.
        </p>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-600">
            Recovery-Codes: <strong>{recoveryRemaining}</strong> ungenutzt.
          </p>
          {newCodes ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                Neue Recovery-Codes – nur jetzt sichtbar, sicher aufbewahren. Die alten
                sind ab sofort ungültig.
              </p>
              <RecoveryCodeList codes={newCodes} />
            </div>
          ) : (
            <ConfirmButton
              action={() => regenerateRecoveryCodes()}
              onResult={(r) => {
                if (r && 'codes' in r && r.codes) setNewCodes(r.codes);
              }}
              label="Neue Recovery-Codes erzeugen"
              className="btn-secondary btn-sm"
              title="Neue Recovery-Codes erzeugen?"
              message="Die bisherigen Recovery-Codes werden dabei ungültig."
              confirmLabel="Neu erzeugen"
            />
          )}
        </div>

        <form
          action={disableAction}
          noValidate
          className="max-w-sm space-y-3 border-t border-slate-100 pt-3"
        >
          {disableState.error && <Alert kind="error">{disableState.error}</Alert>}
          {disableState.success && <Alert kind="success">{disableState.success}</Alert>}
          <SubmitButton className="btn-danger btn-sm">2FA deaktivieren</SubmitButton>
        </form>
      </div>
    );
  }

  // Einrichtung läuft: QR + Secret + Bestätigung.
  if (setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Scannen Sie den QR-Code mit einer Authenticator-App (z. B. Aegis, Google
          Authenticator) und geben Sie anschließend einen Code zur Bestätigung ein.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="TOTP-QR-Code" width={160} height={160} className="rounded border border-slate-200" />
          <div className="text-xs text-slate-500">
            <div className="mb-1">Manuell eingeben:</div>
            <code className="break-all rounded bg-slate-50 px-2 py-1">{setup.secret}</code>
          </div>
        </div>
        <form action={confirmAction} noValidate className="max-w-sm space-y-3">
          {confirmState.error && <Alert kind="error">{confirmState.error}</Alert>}
          <div>
            <label className="label" htmlFor="totp-code">
              Bestätigungscode
            </label>
            <input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="input"
              placeholder="123456"
            />
          </div>
          <SubmitButton className="btn-primary btn-sm">Aktivieren</SubmitButton>
        </form>
      </div>
    );
  }

  // Ausgangszustand: nicht aktiv.
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Schützen Sie Ihr Konto zusätzlich mit einem zeitbasierten Einmalcode (TOTP).
      </p>
      {startErr && <Alert kind="error">{startErr}</Alert>}
      <button
        type="button"
        className="btn-primary btn-sm"
        onClick={begin}
        disabled={starting}
      >
        {starting ? 'Einen Moment…' : '2FA einrichten'}
      </button>
    </div>
  );
}
