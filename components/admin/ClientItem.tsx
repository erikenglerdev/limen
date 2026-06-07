'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useActionState, useState } from 'react';
import {
  type ClientFormState,
  deleteClient,
  regenerateSecret,
  updateClient,
} from '@/app/admin/clients/actions';
import { Alert } from '@/components/Alert';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Modal } from '@/components/Modal';
import { SubmitButton } from '@/components/SubmitButton';
import { ClientFields } from './ClientFields';
import { CredentialsBox } from './CredentialsBox';

export interface ClientItemData {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  isConfidential: boolean;
  isFirstParty: boolean;
  allowedScopes: string[];
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

export function ClientItem({ client }: { client: ClientItemData }) {
  const [open, setOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | undefined>(undefined);
  const [editState, editAction] = useActionState<ClientFormState, FormData>(
    updateClient,
    {},
  );

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{client.name}</span>
            {client.isFirstParty && <Badge>first-party</Badge>}
            <Badge>{client.isConfidential ? 'vertraulich' : 'öffentlich'}</Badge>
          </div>
          <div className="break-all font-mono text-xs text-slate-500">
            {client.clientId}
          </div>
          <div className="mt-1 break-all text-xs text-slate-400">
            {client.redirectUris.join(', ')}
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setOpen(true)}
        >
          Bearbeiten
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Anwendung: ${client.name}`}>
        <div className="space-y-6">
          <form action={editAction} noValidate className="space-y-4">
            {editState.error && <Alert kind="error">{editState.error}</Alert>}
            {editState.success && <Alert kind="success">{editState.success}</Alert>}
            <input type="hidden" name="id" value={client.id} />
            <ClientFields idPrefix={`edit-${client.id}`} defaults={client} />
            <SubmitButton className="btn-primary">Speichern</SubmitButton>
          </form>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <CredentialsBox secret={newSecret} />
            <div className="flex items-center justify-between gap-2">
              <ConfirmButton
                action={regenerateSecret.bind(null, client.id)}
                onResult={(r) => {
                  const secret = (r as { secret?: string } | undefined)?.secret;
                  if (secret) setNewSecret(secret);
                }}
                label="Neues Secret"
                className="btn-secondary btn-sm"
                title="Neues Client-Secret erzeugen?"
                message="Das bisherige Secret wird sofort ungültig; betroffene Apps müssen das neue Secret hinterlegen."
                confirmLabel="Neu erzeugen"
              />
              <ConfirmButton
                action={deleteClient.bind(null, client.id)}
                label="Löschen"
                className="btn-danger btn-sm"
                title={`Anwendung „${client.name}" löschen?`}
                message="Die Registrierung wird unwiderruflich entfernt; Logins dieser App schlagen danach fehl."
                confirmLabel="Löschen"
                confirmClassName="btn-danger"
              />
            </div>
          </div>
        </div>
      </Modal>
    </li>
  );
}
