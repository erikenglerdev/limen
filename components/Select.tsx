'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { useEffect, useRef, useState } from 'react';

export type SelectOption = { value: string; label: string };

/**
 * App-eigenes Dropdown (kein natives <select>). Schreibt den gewählten Wert in ein
 * verstecktes <input name=…>, damit es in Formularen/Server-Actions funktioniert.
 */
export function Select({
  name,
  options,
  defaultValue,
  value: controlledValue,
  onChange,
  placeholder = 'Bitte wählen…',
  id,
}: {
  name?: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? '');
  const value = controlledValue ?? internal;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  function choose(v: string) {
    if (controlledValue === undefined) setInternal(v);
    onChange?.(v);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        id={id}
        className="input flex items-center justify-between text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? '' : 'text-slate-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className="h-4 w-4 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`flex w-full items-center px-3 py-2 text-left hover:bg-slate-50 ${
                  o.value === value ? 'font-medium text-brand-700' : 'text-slate-700'
                }`}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
