'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { authCodes, db, oauthClients, refreshTokens } from '@/db';
import { logAdminAction } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { randomToken } from '@/lib/crypto';
import { SUPPORTED_SCOPES } from '@/lib/oidc/config';
import { revokeClientRefreshTokens } from '@/lib/oidc/tokens';
import { hashPassword } from '@/lib/password';

export type ClientFormState = {
  error?: string;
  success?: string;
  secret?: string; // einmalige Anzeige
  clientId?: string;
};

function parseLines(v: FormDataEntryValue | null): string[] {
  return String(v ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAllowedScopes(formData: FormData): string[] {
  const scopes = ['openid']; // immer erlaubt
  if (formData.get('scope_profile') === 'on') scopes.push('profile');
  if (formData.get('scope_email') === 'on') scopes.push('email');
  return scopes;
}

/**
 * True, wenn `next` mindestens einen Scope entzieht, der unter `prev` noch erlaubt war.
 * Leere Liste = keine Einschränkung (alle unterstützten Scopes erlaubt).
 */
function scopesReduced(prev: string[], next: string[]): boolean {
  const allowedIn = (list: string[], s: string) => list.length === 0 || list.includes(s);
  return SUPPORTED_SCOPES.some((s) => allowedIn(prev, s) && !allowedIn(next, s));
}

function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1'
  );
}

type UrlProblem = { url: string; reason: 'invalid' | 'insecure' };

/**
 * Prüft Client-URLs: müssen absolute http/https-URLs sein. In Produktion ist http nur
 * für Loopback (localhost/127.0.0.1) erlaubt – sonst könnten Authorization-Codes über
 * Klartext-Redirects abfließen.
 */
function firstUrlProblem(list: string[]): UrlProblem | null {
  const prod = process.env.NODE_ENV === 'production';
  for (const u of list) {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return { url: u, reason: 'invalid' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { url: u, reason: 'invalid' };
    }
    if (prod && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      return { url: u, reason: 'insecure' };
    }
  }
  return null;
}

export async function createClient(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const admin = await requireAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const redirectUris = parseLines(formData.get('redirectUris'));
  const postLogout = parseLines(formData.get('postLogoutUris'));
  const isFirstParty = formData.get('isFirstParty') === 'on';
  const isConfidential = formData.get('isConfidential') === 'on';

  if (!name) return { error: 'Der Name ist erforderlich.' };
  if (redirectUris.length === 0) {
    return { error: 'Mindestens eine Redirect-URI angeben.' };
  }
  const badR = firstUrlProblem(redirectUris);
  if (badR) {
    return {
      error:
        badR.reason === 'insecure'
          ? `Unsichere Redirect-URI (in Produktion nur https, außer localhost): ${badR.url}`
          : `Ungültige Redirect-URI: ${badR.url}`,
    };
  }
  const badL = firstUrlProblem(postLogout);
  if (badL) {
    return {
      error:
        badL.reason === 'insecure'
          ? `Unsichere Post-Logout-URI (in Produktion nur https, außer localhost): ${badL.url}`
          : `Ungültige Post-Logout-URI: ${badL.url}`,
    };
  }

  const clientId = `c_${nanoid(24)}`;
  let secret: string | undefined;
  let clientSecretHash: string | null = null;
  if (isConfidential) {
    secret = randomToken(32);
    clientSecretHash = await hashPassword(secret);
  }

  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash,
    name,
    redirectUris,
    postLogoutRedirectUris: postLogout,
    isConfidential,
    isFirstParty,
    allowedScopes: parseAllowedScopes(formData),
  });

  await logAdminAction(admin, 'client.create', {
    targetLabel: `${name} (${clientId})`,
  });
  revalidatePath('/admin/clients');
  return { success: `Anwendung „${name}" wurde registriert.`, clientId, secret };
}

export async function updateClient(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const admin = await requireAdmin();

  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const redirectUris = parseLines(formData.get('redirectUris'));
  const postLogout = parseLines(formData.get('postLogoutUris'));
  const isFirstParty = formData.get('isFirstParty') === 'on';
  const isConfidential = formData.get('isConfidential') === 'on';

  if (!name) return { error: 'Der Name ist erforderlich.' };
  if (redirectUris.length === 0) {
    return { error: 'Mindestens eine Redirect-URI angeben.' };
  }
  const badR = firstUrlProblem(redirectUris);
  if (badR) {
    return {
      error:
        badR.reason === 'insecure'
          ? `Unsichere Redirect-URI (in Produktion nur https, außer localhost): ${badR.url}`
          : `Ungültige Redirect-URI: ${badR.url}`,
    };
  }
  const badL = firstUrlProblem(postLogout);
  if (badL) {
    return {
      error:
        badL.reason === 'insecure'
          ? `Unsichere Post-Logout-URI (in Produktion nur https, außer localhost): ${badL.url}`
          : `Ungültige Post-Logout-URI: ${badL.url}`,
    };
  }

  const [existing] = await db
    .select({
      clientId: oauthClients.clientId,
      secretHash: oauthClients.clientSecretHash,
      allowedScopes: oauthClients.allowedScopes,
    })
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
    .limit(1);
  if (!existing) return { error: 'Anwendung nicht gefunden.' };
  // Vertraulich ohne Secret wäre unbrauchbar (Auth schlägt immer fehl) → blockieren.
  if (isConfidential && !existing.secretHash) {
    return {
      error:
        'Vertrauliche Apps benötigen ein Secret – bitte zuerst über „Secret neu erzeugen" eines anlegen.',
    };
  }

  const newScopes = parseAllowedScopes(formData);
  const reduced = scopesReduced(existing.allowedScopes, newScopes);

  await db
    .update(oauthClients)
    .set({
      name,
      redirectUris,
      postLogoutRedirectUris: postLogout,
      isFirstParty,
      isConfidential,
      allowedScopes: newScopes,
      // Wechsel auf öffentlich: altes Secret entfernen, sonst würde es bei einem
      // späteren Rückwechsel auf vertraulich wieder gültig.
      ...(isConfidential ? {} : { clientSecretHash: null }),
    })
    .where(eq(oauthClients.id, id));

  // Scope entzogen → bestehende Refresh-Tokens des Clients widerrufen, damit verbundene
  // Apps das entzogene Recht nicht bis zu 30 Tage weiter auffrischen können. (Der Refresh
  // schneidet den Scope ohnehin neu zu; das hier macht den Entzug zusätzlich sofort hart.)
  if (reduced) await revokeClientRefreshTokens(existing.clientId);

  await logAdminAction(admin, 'client.update', {
    targetLabel: name,
    detail: reduced ? 'Scope reduziert – Refresh-Tokens widerrufen' : null,
  });
  revalidatePath('/admin/clients');
  return {
    success: reduced
      ? 'Anwendung aktualisiert. Entzogene Scopes wirken sofort – bestehende Sitzungen der App wurden beendet.'
      : 'Anwendung aktualisiert.',
  };
}

export async function regenerateSecret(
  id: string,
): Promise<{ secret?: string; error?: string }> {
  const admin = await requireAdmin();
  const secret = randomToken(32);
  const [updated] = await db
    .update(oauthClients)
    .set({ clientSecretHash: await hashPassword(secret), isConfidential: true })
    .where(eq(oauthClients.id, id))
    .returning({ clientId: oauthClients.clientId, name: oauthClients.name });
  if (!updated) return { error: 'Anwendung nicht gefunden.' };
  await logAdminAction(admin, 'client.rotate_secret', {
    targetLabel: `${updated.name} (${updated.clientId})`,
  });
  revalidatePath('/admin/clients');
  return { secret };
}

export async function deleteClient(id: string): Promise<{ error?: string } | void> {
  const admin = await requireAdmin();
  const [deleted] = await db
    .delete(oauthClients)
    .where(eq(oauthClients.id, id))
    .returning({ clientId: oauthClients.clientId, name: oauthClients.name });
  // Verwaiste Tokens/Codes des Clients aufräumen (kein FK von client_id → clients):
  // sonst tauchen sie weiter als „verbundene App" auf und blieben technisch nutzbar.
  if (deleted) {
    await db.delete(refreshTokens).where(eq(refreshTokens.clientId, deleted.clientId));
    await db.delete(authCodes).where(eq(authCodes.clientId, deleted.clientId));
  }
  await logAdminAction(admin, 'client.delete', {
    targetLabel: deleted ? `${deleted.name} (${deleted.clientId})` : id,
  });
  revalidatePath('/admin/clients');
}
