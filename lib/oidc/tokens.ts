// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, type OAuthClient, oauthClients, refreshTokens, users, type User } from '@/db';
import { randomToken, sha256 } from '../crypto';
import { issuer } from '../env';
import { buildClaims } from './claims';
import {
  ACCESS_TOKEN_TTL,
  ID_TOKEN_TTL,
  narrowScope,
  REFRESH_TOKEN_TTL,
} from './config';
import { signJwt } from './jwt';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  id_token: string;
  refresh_token: string;
  scope: string;
}

async function issueRefreshToken(params: {
  clientId: string;
  userId: string;
  scope: string;
  authTime?: number | null;
  rotatedFrom?: string | null;
}): Promise<string> {
  const token = randomToken(48);
  await db.insert(refreshTokens).values({
    tokenHash: sha256(token),
    clientId: params.clientId,
    userId: params.userId,
    scope: params.scope,
    authTime: params.authTime ? new Date(params.authTime * 1000) : null,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
    rotatedFrom: params.rotatedFrom ?? null,
  });
  return token;
}

/** Signiert id_token + access_token (kein DB-Zugriff für den Refresh-Token). */
async function signIdAndAccess(params: {
  user: User;
  clientId: string;
  scope: string;
  nonce?: string | null;
  authTime: number;
}): Promise<{ id_token: string; access_token: string }> {
  const idPayload: Record<string, unknown> = {
    ...buildClaims(params.user, params.scope),
    token_use: 'id',
    auth_time: params.authTime,
  };
  if (params.nonce) idPayload.nonce = params.nonce;

  const id_token = await signJwt(idPayload, {
    subject: params.user.id,
    audience: params.clientId,
    expiresInSeconds: ID_TOKEN_TTL,
  });
  const access_token = await signJwt(
    { token_use: 'access', scope: params.scope, client_id: params.clientId },
    { subject: params.user.id, audience: issuer(), expiresInSeconds: ACCESS_TOKEN_TTL },
  );
  return { id_token, access_token };
}

/** Erzeugt id_token + access_token + refresh_token (für den authorization_code-Flow). */
export async function issueTokenSet(params: {
  user: User;
  clientId: string;
  scope: string;
  nonce?: string | null;
  authTime?: number;
}): Promise<TokenResponse> {
  const { user, clientId, scope, nonce } = params;
  // Echter Login-Zeitpunkt; nur als Fallback „jetzt", falls keiner durchgereicht wurde.
  const authTime = params.authTime ?? Math.floor(Date.now() / 1000);
  const { id_token, access_token } = await signIdAndAccess({
    user,
    clientId,
    scope,
    nonce,
    authTime,
  });
  const refresh_token = await issueRefreshToken({
    clientId,
    userId: user.id,
    scope,
    authTime,
  });
  return {
    access_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    id_token,
    refresh_token,
    scope,
  };
}

export type RotateResult = { ok: true; tokens: TokenResponse } | { ok: false };

/**
 * Validiert + rotiert ein Refresh-Token und stellt das neue Token-Set aus – Claim des
 * alten Tokens UND Insert des neuen passieren in EINER Transaktion. Dadurch serialisiert
 * der Row-Lock auf dem alten Token eine parallele Wiederverwendung: deren Reuse-Detection
 * läuft erst nach Commit und erfasst daher auch das hier frisch eingefügte Token (schließt
 * das frühere Race-Fenster). Scope wird erneut auf die aktuellen allowedScopes des Clients
 * geschnitten, sodass ein Scope-Entzug auch bestehende Refresh-Tokens betrifft.
 */
export async function rotateAndIssue(
  presented: string,
  client: OAuthClient,
): Promise<RotateResult> {
  const hash = sha256(presented);
  const now = new Date();

  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          eq(refreshTokens.clientId, client.clientId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
        ),
      )
      .returning();

    if (!row) {
      // Wiederverwendung eines bereits widerrufenen Tokens → ganze Familie revoken.
      const [existing] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .limit(1);
      if (existing && existing.clientId === client.clientId && existing.revokedAt) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(refreshTokens.userId, existing.userId),
              eq(refreshTokens.clientId, client.clientId),
              isNull(refreshTokens.revokedAt),
            ),
          );
      }
      return null;
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user || !user.isActive) return null;

    const scope = narrowScope(row.scope, client.allowedScopes);
    const authTimeSec = row.authTime
      ? Math.floor(row.authTime.getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const newToken = randomToken(48);
    await tx.insert(refreshTokens).values({
      tokenHash: sha256(newToken),
      clientId: client.clientId,
      userId: user.id,
      scope,
      authTime: row.authTime ?? null, // Original-Login-Zeit erhalten
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
      rotatedFrom: hash,
    });
    return { user, scope, authTime: authTimeSec, newToken };
  });

  if (!claimed) return { ok: false };

  const { id_token, access_token } = await signIdAndAccess({
    user: claimed.user,
    clientId: client.clientId,
    scope: claimed.scope,
    authTime: claimed.authTime,
  });
  return {
    ok: true,
    tokens: {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      id_token,
      refresh_token: claimed.newToken,
      scope: claimed.scope,
    },
  };
}

export interface ConnectedApp {
  clientId: string;
  name: string;
  lastAt: string;
}

/** Aktive App-Verbindungen eines Nutzers (gültige Refresh-Tokens je Client). */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const now = new Date();
  const rows = await db
    .select({
      clientId: refreshTokens.clientId,
      name: oauthClients.name,
      lastAt: sql<string>`max(${refreshTokens.createdAt})`,
    })
    .from(refreshTokens)
    .leftJoin(oauthClients, eq(oauthClients.clientId, refreshTokens.clientId))
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, now),
      ),
    )
    .groupBy(refreshTokens.clientId, oauthClients.name);
  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name ?? r.clientId,
    lastAt: r.lastAt,
  }));
}

/** Widerruft alle aktiven Refresh-Tokens eines Nutzers für genau einen Client. */
export async function revokeAppRefreshTokens(userId: string, clientId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.clientId, clientId),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/** Widerruft ALLE aktiven Refresh-Tokens eines Nutzers (alle Clients). */
export async function revokeAllUserRefreshTokens(userId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Widerruft ALLE aktiven Refresh-Tokens eines Clients. Wird bei einer Scope-Reduktion
 * des Clients genutzt: so kann eine bereits verbundene App entzogene Rechte nicht über
 * ihren noch gültigen Refresh-Token (bis zu 30 Tage) weiter auffrischen.
 */
export async function revokeClientRefreshTokens(clientId: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.clientId, clientId), isNull(refreshTokens.revokedAt)));
}
