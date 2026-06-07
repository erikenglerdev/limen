'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useRef, useState } from 'react';

/**
 * App-gestylter „Datei auswählen"-Button mit deutlichem Datei-Feedback (grünes Pill).
 * Versteckt das native <input type="file"> und behält dessen name, damit Uploads in
 * Server-Actions ankommen.
 */
export function FileInput({
  name,
  accept = 'image/*',
  buttonLabel = 'Datei auswählen',
}: {
  name: string;
  accept?: string;
  buttonLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        className="hidden"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <button
        type="button"
        className="btn-secondary"
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </button>
      {fileName ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
          {fileName}
        </span>
      ) : (
        <span className="text-xs text-slate-400">Keine Datei ausgewählt</span>
      )}
    </div>
  );
}
