// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Inline-Meldung für Fehler/Erfolg in Formularen. Ersetzt native Validierungs-Bubbles.
 */
export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  if (!children) return null;
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-brand-100 bg-brand-50 text-brand-700',
  }[kind];
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`} role="alert">
      {children}
    </div>
  );
}
