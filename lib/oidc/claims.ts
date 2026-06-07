// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import type { User } from '@/db';
import { issuer } from '../env';

/**
 * Baut die Profil-Claims aus Benutzer + Scope. `sub` wird separat als JWT-Subject
 * gesetzt. `picture` nur, wenn ein Avatar existiert (sonst nutzt die App ihren
 * eigenen Initialen-Fallback).
 */
export function buildClaims(user: User, scope: string): Record<string, unknown> {
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  const claims: Record<string, unknown> = {};

  if (scopes.has('profile')) {
    claims.preferred_username = user.username;
    claims.name = user.name;
    if (user.avatarPath) {
      const v = user.updatedAt ? user.updatedAt.getTime() : '';
      claims.picture = `${issuer()}/avatar/${user.id}${v ? `?v=${v}` : ''}`;
    }
  }

  if (scopes.has('email') && user.email) {
    claims.email = user.email;
    claims.email_verified = false;
  }

  return claims;
}
