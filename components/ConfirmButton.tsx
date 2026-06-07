'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { type ReactNode, useState, useTransition } from 'react';
import { Alert } from '@/components/Alert';
import { Modal } from '@/components/Modal';

type ActionResult = { error?: string } | void;

/**
 * Button, der eine (bereits gebundene) Server-Action erst nach Bestätigung in einem
 * In-App-Modal ausführt – kein Browser-Dialog. `onResult` erhält das Action-Ergebnis
 * (z.B. ein einmalig anzuzeigendes Secret), falls kein Fehler vorlag.
 */
export function ConfirmButton<R extends ActionResult>({
  action,
  onResult,
  label,
  className = 'btn-secondary btn-sm',
  title,
  message,
  confirmLabel = 'Bestätigen',
  confirmClassName = 'btn-primary',
}: {
  action: () => Promise<R>;
  onResult?: (result: R) => void;
  label: ReactNode;
  className?: string;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  confirmClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={title}
      >
        {message && <div className="text-sm text-slate-600">{message}</div>}
        {error && (
          <div className="mt-3">
            <Alert kind="error">{error}</Alert>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={pending}
            className={confirmClassName}
            onClick={() =>
              startTransition(async () => {
                const r = await action();
                if (r && typeof r === 'object' && 'error' in r && r.error) {
                  setError(r.error);
                } else {
                  onResult?.(r);
                  setOpen(false);
                }
              })
            }
          >
            {pending ? 'Bitte warten…' : confirmLabel}
          </button>
        </div>
      </Modal>
    </>
  );
}
