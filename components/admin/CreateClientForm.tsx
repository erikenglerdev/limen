'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState } from 'react';
import { type ClientFormState, createClient } from '@/app/admin/clients/actions';
import { Alert } from '@/components/Alert';
import { SubmitButton } from '@/components/SubmitButton';
import { ClientFields } from './ClientFields';
import { CredentialsBox } from './CredentialsBox';

export function CreateClientForm() {
  const [state, action] = useActionState<ClientFormState, FormData>(createClient, {});
  return (
    <form action={action} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <CredentialsBox clientId={state.clientId} secret={state.secret} />
      <ClientFields idPrefix="new" />
      <SubmitButton className="btn-primary">Anwendung registrieren</SubmitButton>
    </form>
  );
}
