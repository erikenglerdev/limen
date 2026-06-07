'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { startRegistration } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  deletePasskey,
  finishPasskeyRegistration,
  startPasskeyRegistration,
} from '@/app/konto/webauthn-actions';
import { Alert } from './Alert';
import { ConfirmButton } from './ConfirmButton';

export interface PasskeyItem {
  id: string;
  name: string;
  createdAt: string;
}

export function PasskeysSection({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ error?: string; success?: string }>({});

  async function register() {
    setBusy(true);
    setMsg({});
    try {
      const options = await startPasskeyRegistration();
      if ('error' in options) {
        setMsg({ error: options.error });
        return;
      }
      const response = await startRegistration({ optionsJSON: options });
      const res = await finishPasskeyRegistration(JSON.stringify(response), name);
      setMsg(res);
      if (res.success) {
        setName('');
        router.refresh();
      }
    } catch {
      setMsg({ error: 'Registrierung abgebrochen oder fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Passkeys (z. B. Touch ID, Windows Hello, YubiKey) als zusätzlichen oder
        alternativen zweiten Faktor.
      </p>
      {msg.error && <Alert kind="error">{msg.error}</Alert>}
      {msg.success && <Alert kind="success">{msg.success}</Alert>}

      {passkeys.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">
                  seit {new Date(p.createdAt).toLocaleString('de-DE')}
                </div>
              </div>
              <ConfirmButton
                action={() => deletePasskey(p.id)}
                onResult={() => router.refresh()}
                label="Entfernen"
                className="btn-secondary btn-sm"
                title={`Passkey „${p.name}“ entfernen?`}
                confirmLabel="Entfernen"
                confirmClassName="btn-danger"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Noch keine Passkeys registriert.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="passkey-name">
            Bezeichnung (optional)
          </label>
          <input
            id="passkey-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. YubiKey"
          />
        </div>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={register}
          disabled={busy}
        >
          {busy ? 'Einen Moment…' : 'Passkey hinzufügen'}
        </button>
      </div>
    </div>
  );
}
