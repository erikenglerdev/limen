'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { type ReactNode, useState, useTransition } from 'react';

type ActionResult = { error?: string } | void;

/** Button, der eine gebundene Server-Action ohne Bestätigung ausführt (mit Pending-State). */
export function ActionButton<R extends ActionResult>({
  action,
  onResult,
  children,
  className = 'btn-secondary btn-sm',
}: {
  action: () => Promise<R>;
  onResult?: (result: R) => void;
  children: ReactNode;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() =>
          startTransition(async () => {
            const r = await action();
            if (r && typeof r === 'object' && 'error' in r && r.error) setError(r.error);
            else {
              setError(null);
              onResult?.(r);
            }
          })
        }
      >
        {children}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
