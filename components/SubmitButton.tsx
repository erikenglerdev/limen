'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useFormStatus } from 'react-dom';

/**
 * Submit-Button mit pending-State (deaktiviert + Label-Wechsel während der Server Action).
 * Bestätigungen laufen über die ConfirmButton-Komponente (In-App-Modal), nicht über
 * Browser-Dialoge.
 */
export function SubmitButton({
  children,
  pendingText,
  className = 'btn-primary',
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={className}
      {...rest}
    >
      {pending ? (pendingText ?? 'Bitte warten…') : children}
    </button>
  );
}
