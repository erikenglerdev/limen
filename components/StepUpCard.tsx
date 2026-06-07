'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { startAuthentication } from '@simplewebauthn/browser';
import { useActionState, useState } from 'react';
import { stepUpPasskey, stepUpTotp, type StepUpState } from '@/app/konto/stepup-actions';
import { passwordlessOptions } from '@/app/login/actions';
import { Alert } from './Alert';
import { SubmitButton } from './SubmitButton';

export function StepUpCard({
  hasTotp,
  hasPasskey,
  next,
  title = 'Verwaltung: zweiten Faktor bestätigen',
  description = 'Für den Zugriff auf die Verwaltung muss diese Sitzung mit einem zweiten Faktor bestätigt werden.',
}: {
  hasTotp: boolean;
  hasPasskey: boolean;
  /** Ziel nach erfolgreichem Step-up (Default Admin-Bereich). */
  next?: string;
  title?: string;
  description?: string;
}) {
  const [totpState, totpAction] = useActionState<StepUpState, FormData>(stepUpTotp, {});
  const [pkBusy, setPkBusy] = useState(false);
  const [pkError, setPkError] = useState<string | null>(null);

  async function passkey() {
    setPkBusy(true);
    setPkError(null);
    try {
      const options = await passwordlessOptions();
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await stepUpPasskey(JSON.stringify(assertion), next);
      if (res?.error) setPkError(res.error);
      // Erfolg → Server leitet zum Ziel (next bzw. /admin).
    } catch {
      setPkError('Passkey-Bestätigung abgebrochen oder fehlgeschlagen.');
    } finally {
      setPkBusy(false);
    }
  }

  return (
    <section className="card border-brand-200 p-6">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-slate-500">{description}</p>
      {pkError && <Alert>{pkError}</Alert>}

      {hasPasskey && (
        <button
          type="button"
          className="btn-primary"
          onClick={passkey}
          disabled={pkBusy}
        >
          {pkBusy ? 'Warte auf Passkey…' : 'Mit Passkey bestätigen'}
        </button>
      )}

      {hasPasskey && hasTotp && (
        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> oder Code{' '}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      )}

      {hasTotp && (
        <form action={totpAction} noValidate className="max-w-sm space-y-3">
          {totpState.error && <Alert>{totpState.error}</Alert>}
          {next && <input type="hidden" name="next" value={next} />}
          <div>
            <label className="label" htmlFor="stepup-code">
              Code aus Authenticator-App
            </label>
            <input
              id="stepup-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="input"
              placeholder="123456"
            />
          </div>
          <SubmitButton className="btn-primary">Bestätigen</SubmitButton>
        </form>
      )}
    </section>
  );
}
