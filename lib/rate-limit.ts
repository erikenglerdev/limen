// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * Leichter In-Memory-Fixed-Window-Limiter (pro Prozess) als Basishärtung gegen
 * Lastspitzen/DoS auf (teils unauthentifizierte) Endpunkte – ergänzend zur nginx-
 * Ebene (`limit_req`). Bewusst ohne DB: gerade die geschützten Endpunkte sollen
 * KEINE zusätzliche DB-Last pro Anfrage erzeugen. Der Zustand ist absichtlich nur
 * prozesslokal und best-effort (Neustart/Mehr-Instanz = Reset) – für harte Garantien
 * bleibt nginx zuständig.
 */
declare global {
  var __ssoRateLimit: Map<string, { count: number; resetAt: number }> | undefined;
}

const store =
  global.__ssoRateLimit ?? new Map<string, { count: number; resetAt: number }>();
if (process.env.NODE_ENV !== 'production') global.__ssoRateLimit = store;

export interface RateLimitResult {
  ok: boolean;
  /** Sekunden bis zum Fensterende (für Retry-After). */
  retryAfter: number;
}

/**
 * Zählt eine Anfrage auf `key` und meldet, ob sie noch im erlaubten Fenster liegt.
 * Fixed-Window: pro `windowMs` sind `limit` Anfragen erlaubt.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Speicher beschränken: bei Überlauf abgelaufene Buckets aufräumen (begrenzt die
  // Map-Größe gegen viele unterschiedliche IPs/Keys).
  if (store.size > 5000) {
    for (const [k, v] of store) {
      if (v.resetAt <= now) store.delete(k);
    }
  }

  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}
