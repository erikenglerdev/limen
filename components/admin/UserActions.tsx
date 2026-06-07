'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState, useState } from 'react';
import {
  deleteUser,
  disableUserTotp,
  type FormState,
  resetPassword,
  setUserActive,
  toggleAdmin,
  updateUserProfile,
} from '@/app/admin/actions';
import { ActionButton } from '@/components/ActionButton';
import { Alert } from '@/components/Alert';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Modal } from '@/components/Modal';
import { SubmitButton } from '@/components/SubmitButton';

export function UserActions({
  userId,
  username,
  name,
  email,
  isActive,
  isSsoAdmin,
  totpEnabled,
}: {
  userId: string;
  username: string;
  name: string;
  email: string | null;
  isActive: boolean;
  isSsoAdmin: boolean;
  totpEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [profileState, profileAction] = useActionState<FormState, FormData>(
    updateUserProfile,
    {},
  );
  const [resetState, resetAction] = useActionState<FormState, FormData>(
    resetPassword,
    {},
  );

  const close = () => {
    setOpen(false);
    setConfirmText('');
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isActive ? (
        <ConfirmButton
          action={setUserActive.bind(null, userId, false)}
          label="Deaktivieren"
          className="btn-secondary btn-sm"
          title={`Konto „${username}" deaktivieren?`}
          message="Das Konto wird überall ausgesperrt (kein Login mehr)."
          confirmLabel="Deaktivieren"
          confirmClassName="btn-danger"
        />
      ) : (
        <ActionButton
          action={setUserActive.bind(null, userId, true)}
          className="btn-primary btn-sm"
        >
          Aktivieren
        </ActionButton>
      )}

      <ConfirmButton
        action={toggleAdmin.bind(null, userId, !isSsoAdmin)}
        label={isSsoAdmin ? 'Admin entziehen' : 'Zu Admin'}
        className="btn-secondary btn-sm"
        title={isSsoAdmin ? 'Administratorrechte entziehen?' : 'Zum Administrator machen?'}
        message={
          isSsoAdmin
            ? `„${username}" verliert die Administratorrechte.`
            : `„${username}" erhält volle Administratorrechte über das SSO.`
        }
        confirmLabel={isSsoAdmin ? 'Entziehen' : 'Zu Admin'}
      />

      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => setOpen(true)}
      >
        Bearbeiten
      </button>

      <Modal open={open} onClose={close} title={`Konto: ${name}`}>
        <div className="space-y-6">
          {/* Stammdaten */}
          <form action={profileAction} noValidate className="space-y-3">
            {profileState.error && <Alert kind="error">{profileState.error}</Alert>}
            {profileState.success && (
              <Alert kind="success">{profileState.success}</Alert>
            )}
            <input type="hidden" name="userId" value={userId} />
            <div>
              <label className="label" htmlFor={`name-${userId}`}>
                Anzeigename
              </label>
              <input
                id={`name-${userId}`}
                name="name"
                className="input"
                defaultValue={name}
              />
            </div>
            <div>
              <label className="label" htmlFor={`email-${userId}`}>
                E-Mail (optional)
              </label>
              <input
                id={`email-${userId}`}
                name="email"
                type="email"
                className="input"
                defaultValue={email ?? ''}
                autoComplete="off"
              />
            </div>
            <SubmitButton className="btn-primary btn-sm">Profil speichern</SubmitButton>
          </form>

          {/* Passwort zurücksetzen */}
          <form
            action={resetAction}
            noValidate
            className="space-y-3 border-t border-slate-100 pt-4"
          >
            {resetState.error && <Alert kind="error">{resetState.error}</Alert>}
            {resetState.success && <Alert kind="success">{resetState.success}</Alert>}
            <input type="hidden" name="userId" value={userId} />
            <div>
              <label className="label" htmlFor={`pw-${userId}`}>
                Neues Passwort
              </label>
              <input
                id={`pw-${userId}`}
                name="password"
                type="text"
                className="input"
                autoComplete="off"
              />
            </div>
            <SubmitButton className="btn-secondary btn-sm">
              Passwort zurücksetzen
            </SubmitButton>
          </form>

          {/* 2FA/Passkeys zurücksetzen – wirkt eindeutig auf dieses Konto (gebundene userId) */}
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm text-slate-600">
              {totpEnabled
                ? 'Dieses Konto hat 2FA aktiv.'
                : 'Entfernt alle 2FA-Methoden (TOTP + Passkeys) des Kontos.'}
            </p>
            <ConfirmButton
              action={disableUserTotp.bind(null, userId)}
              label="2FA / Passkeys zurücksetzen"
              className="btn-secondary btn-sm"
              title={`2FA/Passkeys für „${username}" zurücksetzen?`}
              message={`Alle TOTP- und Passkey-Faktoren von „${username}" werden entfernt. Der Nutzer muss sie neu einrichten.`}
              confirmLabel="Zurücksetzen"
            />
          </div>

          {/* Löschen – nur wenn deaktiviert, In-App-Bestätigung per LÖSCHEN */}
          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-red-700">Gefahrenzone</h3>
            {isActive ? (
              <p className="text-xs text-slate-400">
                Zum Löschen muss das Konto zuerst deaktiviert werden.
              </p>
            ) : (
              <form action={deleteUser} className="space-y-2">
                <input type="hidden" name="userId" value={userId} />
                <p className="text-xs text-slate-500">
                  Konto „{username}“ wird unwiderruflich gelöscht. Zum Bestätigen das
                  Wort <span className="font-semibold">LÖSCHEN</span> eingeben.
                </p>
                <input
                  name="confirm"
                  className="input"
                  placeholder="LÖSCHEN"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
                <SubmitButton
                  className="btn-danger btn-sm"
                  disabled={confirmText !== 'LÖSCHEN'}
                >
                  Konto endgültig löschen
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
