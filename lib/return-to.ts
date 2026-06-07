// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Liefert ein sicheres lokales Rücksprungziel (kein Open-Redirect).
 *
 * Robuste Prüfung über echtes URL-Parsing gegen eine Dummy-Basis: nur wenn der Wert
 * den lokalen Origin NICHT verlässt, wird Pfad+Query zurückgegeben. Wehrt damit auch
 * Tricks wie absolute URLs, protokoll-relative `//host` und `/\host` (Backslash, den
 * Browser zu `/` normalisieren) ab.
 */
export function safeReturnTo(v: string | undefined | null): string {
  if (!v) return '/konto';
  try {
    const base = 'http://internal.invalid';
    const url = new URL(v, base);
    if (url.origin !== base) return '/konto'; // hat den lokalen Origin verlassen
    const path = url.pathname + url.search;
    return path.startsWith('/') ? path : '/konto';
  } catch {
    return '/konto';
  }
}
