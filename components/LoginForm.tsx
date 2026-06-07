'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from '@simplewebauthn/browser';
import { useActionState, useEffect, useRef, useState } from 'react';
import {
  loginAction,
  type LoginState,
  passwordlessOptions,
  verify2faAction,
  verifyPasswordless,
} from '@/app/login/actions';
import { Alert } from '@/components/Alert';
import { SubmitButton } from '@/components/SubmitButton';

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});
  const [verifyState, verifyAction] = useActionState<LoginState, FormData>(
    verify2faAction,
    {},
  );
  const [pkBusy, setPkBusy] = useState(false);
  const [pkError, setPkError] = useState<string | null>(null);
  const autofillStarted = useRef(false);

  // Conditional UI: bietet Passkeys direkt im Autofill des Benutzername-Felds an.
  useEffect(() => {
    if (state.needs2fa || autofillStarted.current) return;
    autofillStarted.current = true;
    (async () => {
      try {
        if (!(await browserSupportsWebAuthnAutofill())) return;
        const options = await passwordlessOptions();
        const assertion = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });
        const res = await verifyPasswordless(JSON.stringify(assertion), returnTo);
        if (res?.error) setPkError(res.error);
        // Erfolg → Server leitet weiter.
      } catch {
        // Autofill nicht genutzt/abgebrochen → still ignorieren.
      }
    })();
  }, [state.needs2fa, returnTo]);

  async function passkeyLogin() {
    setPkBusy(true);
    setPkError(null);
    try {
      const options = await passwordlessOptions();
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await verifyPasswordless(JSON.stringify(assertion), returnTo);
      if (res?.error) setPkError(res.error);
      // Erfolg → der Server leitet weiter.
    } catch {
      setPkError('Passkey-Anmeldung abgebrochen oder fehlgeschlagen.');
    } finally {
      setPkBusy(false);
    }
  }

  // Schritt 2: TOTP-Code (nur Passwort-Pfad mit eingerichtetem TOTP).
  if (state.needs2fa) {
    const loginHref = `/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`;
    return (
      <form action={verifyAction} noValidate className="space-y-4">
        <p className="text-sm text-slate-500">
          Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App (oder einen
          Recovery-Code) ein.
        </p>
        {verifyState.error && <Alert>{verifyState.error}</Alert>}
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        <div>
          <label className="label" htmlFor="code">
            Bestätigungscode
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="input"
            autoFocus
            placeholder="123456"
          />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Prüfe…">
          Bestätigen
        </SubmitButton>
        <a
          href={loginHref}
          className="block text-center text-xs text-slate-400 hover:text-slate-600"
        >
          Erneut anmelden
        </a>
      </form>
    );
  }

  // Schritt 1: Passwort ODER Passkey (passwortlos).
  return (
    <div className="space-y-4">
      <form action={formAction} noValidate className="space-y-4">
        {state.error && <Alert>{state.error}</Alert>}
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        <div>
          <label className="label" htmlFor="username">
            Benutzername
          </label>
          <input
            id="username"
            name="username"
            className="input"
            autoComplete="username webauthn"
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
          />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Anmelden…">
          Anmelden
        </SubmitButton>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> oder{' '}
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {pkError && <Alert>{pkError}</Alert>}
      <button
        type="button"
        className="btn-secondary w-full"
        onClick={passkeyLogin}
        disabled={pkBusy}
      >
        {pkBusy ? 'Warte auf Passkey…' : 'Mit Passkey anmelden'}
      </button>
    </div>
  );
}
