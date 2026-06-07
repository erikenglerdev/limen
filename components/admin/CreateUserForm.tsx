'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState } from 'react';
import { createUser, type FormState } from '@/app/admin/actions';
import { Alert } from '@/components/Alert';
import { SubmitButton } from '@/components/SubmitButton';

export function CreateUserForm() {
  const [state, action] = useActionState<FormState, FormData>(createUser, {});
  return (
    <form action={action} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cu-username">
            Benutzername
          </label>
          <input id="cu-username" name="username" className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="cu-name">
            Anzeigename
          </label>
          <input id="cu-name" name="name" className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="cu-email">
            E-Mail (optional)
          </label>
          <input id="cu-email" name="email" type="email" className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="cu-password">
            Initial-Passwort
          </label>
          <input id="cu-password" name="password" type="text" className="input" autoComplete="off" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="isSsoAdmin" className="h-4 w-4 rounded border-slate-300" />
        Als SSO-Administrator anlegen
      </label>
      <SubmitButton className="btn-primary">Konto anlegen</SubmitButton>
    </form>
  );
}
