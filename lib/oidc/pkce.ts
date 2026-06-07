// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { createHash } from 'node:crypto';
import { timingSafeEqualStr } from '../crypto';

/** Prüft PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return timingSafeEqualStr(computed, challenge);
}
