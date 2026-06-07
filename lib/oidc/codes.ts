// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, eq, gt } from 'drizzle-orm';
import { authCodes, db } from '@/db';
import { randomToken, sha256 } from '../crypto';
import { AUTH_CODE_TTL } from './config';

export interface IssueCodeParams {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  nonce?: string | null;
  authTime?: number | null; // Login-Zeitpunkt (Unix-Sekunden)
}

export async function issueAuthCode(params: IssueCodeParams): Promise<string> {
  const code = randomToken(32);
  await db.insert(authCodes).values({
    codeHash: sha256(code),
    clientId: params.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: params.scope,
    nonce: params.nonce ?? null,
    authTime: params.authTime ? new Date(params.authTime * 1000) : null,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL * 1000),
  });
  return code;
}

/**
 * Verbraucht einen Code atomar (single-use): markiert ihn nur dann als consumed,
 * wenn er noch nicht verbraucht und nicht abgelaufen ist. Verhindert Replay.
 */
export async function consumeAuthCode(code: string) {
  const codeHash = sha256(code);
  const [row] = await db
    .update(authCodes)
    .set({ consumed: true })
    .where(
      and(
        eq(authCodes.codeHash, codeHash),
        eq(authCodes.consumed, false),
        gt(authCodes.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}
