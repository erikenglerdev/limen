'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState } from 'react';
import {
  changePassword,
  type FormState,
  removeAvatar,
  updateProfile,
  uploadAvatar,
} from '@/app/konto/actions';
import { Alert } from './Alert';
import { ConfirmButton } from './ConfirmButton';
import { FileInput } from './FileInput';
import { SubmitButton } from './SubmitButton';

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <Alert kind="error">{state.error}</Alert>;
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return null;
}

export function ProfileForm({
  username,
  name,
  email,
}: {
  username: string;
  name: string;
  email: string | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} noValidate className="space-y-4">
      <Feedback state={state} />
      <div>
        <label className="label" htmlFor="username">
          Benutzername
        </label>
        <input
          id="username"
          className="input bg-slate-100 text-slate-500"
          value={username}
          readOnly
          disabled
        />
        <p className="mt-1 text-xs text-slate-400">
          Der Benutzername kann nicht geändert werden.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="name">
          Anzeigename
        </label>
        <input id="name" name="name" className="input" defaultValue={name} />
      </div>
      <div>
        <label className="label" htmlFor="email">
          E-Mail (optional)
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          defaultValue={email ?? ''}
          autoComplete="email"
        />
        <p className="mt-1 text-xs text-slate-400">
          Leer lassen, um die hinterlegte Adresse zu entfernen.
        </p>
      </div>
      <SubmitButton className="btn-primary">Speichern</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} noValidate className="space-y-4">
      <Feedback state={state} />
      <div>
        <label className="label" htmlFor="current">
          Aktuelles Passwort
        </label>
        <input
          id="current"
          name="current"
          type="password"
          className="input"
          autoComplete="current-password"
        />
      </div>
      <div>
        <label className="label" htmlFor="next">
          Neues Passwort
        </label>
        <input
          id="next"
          name="next"
          type="password"
          className="input"
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Neues Passwort bestätigen
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          className="input"
          autoComplete="new-password"
        />
      </div>
      <SubmitButton className="btn-primary">Passwort ändern</SubmitButton>
    </form>
  );
}

export function AvatarSection({ hasAvatar }: { hasAvatar: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(uploadAvatar, {});
  return (
    <div className="space-y-4">
      <Feedback state={state} />
      <form action={action} className="space-y-4">
        <FileInput name="avatar" buttonLabel="Bild auswählen" />
        <SubmitButton className="btn-primary">Hochladen</SubmitButton>
      </form>
      {hasAvatar && (
        <ConfirmButton
          action={removeAvatar}
          label="Profilbild entfernen"
          className="btn-danger btn-sm"
          title="Profilbild entfernen?"
          confirmLabel="Entfernen"
          confirmClassName="btn-danger"
        />
      )}
    </div>
  );
}
