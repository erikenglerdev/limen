// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Benutzerkonten. id = OIDC `sub` (stabil, immutabel). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(), // Login-Kennung, immutabel
    name: text('name').notNull(), // echter/Anzeigename
    email: text('email'), // optional
    passwordHash: text('password_hash').notNull(),
    // Zeitpunkt der letzten Passwort-Änderung. SSO-Sessions, deren loginAt davor liegt,
    // gelten als ungültig (Invalidierung bei Passwortwechsel / Admin-Reset).
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // „Überall abmelden": SSO-Sessions mit loginAt davor gelten als ungültig.
    sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true }),
    avatarPath: text('avatar_path'), // null → Initialen-Fallback
    // 2FA/TOTP: Secret AES-256-GCM-verschlüsselt at rest; erst nach Bestätigung aktiv.
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    // Zuletzt verbrauchter TOTP-Zeitschritt (floor(unixtime/30)). Erzwingt Einmal-
    // verwendung eines Codes (RFC 6238 §5.2): ein bereits genutzter oder älterer
    // Schritt wird abgelehnt → kein Replay innerhalb des Gültigkeitsfensters (~90s).
    totpLastUsedStep: bigint('totp_last_used_step', { mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true), // zentraler Kill-Switch
    isSsoAdmin: boolean('is_sso_admin').notNull().default(false), // darf SSO verwalten
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    // Username case-insensitiv eindeutig.
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
  ],
);

/** Registrierte Client-Apps (Relying Parties). */
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id').notNull().unique(),
  clientSecretHash: text('client_secret_hash'), // nur confidential clients
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(), // exakter Allowlist-Match
  postLogoutRedirectUris: text('post_logout_redirect_uris')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Erlaubte Scopes pro Client. Leer = keine Einschränkung (alle unterstützten).
  allowedScopes: text('allowed_scopes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  isConfidential: boolean('is_confidential').notNull().default(true),
  isFirstParty: boolean('is_first_party').notNull().default(false), // first-party → Consent überspringbar
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Kurzlebige Authorization Codes (PKCE). Nur Hash gespeichert. */
export const authCodes = pgTable('auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  nonce: text('nonce'),
  // Echter Login-Zeitpunkt der SSO-Session (für den auth_time-Claim im id_token).
  authTime: timestamp('auth_time', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumed: boolean('consumed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Refresh-Tokens mit Rotation + Revocation. Nur Hash gespeichert. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    // Login-Zeitpunkt der ursprünglichen Session; bleibt über Rotationen erhalten.
    authTime: timestamp('auth_time', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedFrom: text('rotated_from'), // token_hash des Vorgängers
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

/** Signaturschlüssel (RS256). Privater Schlüssel AES-256-GCM-verschlüsselt. */
export const signingKeys = pgTable('signing_keys', {
  kid: text('kid').primaryKey(),
  alg: text('alg').notNull().default('RS256'),
  publicJwk: jsonb('public_jwk').notNull(),
  privatePemEnc: text('private_pem_enc').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Login-Versuche für Rate-Limit/Lockout. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(), // lower(username)
    ip: text('ip'),
    success: boolean('success').notNull().default(false),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_identifier_idx').on(t.identifier, t.attemptedAt)],
);

/** Einmal nutzbare Backup-Codes für 2FA (nur gehasht gespeichert). */
export const totpRecoveryCodes = pgTable(
  'totp_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('totp_recovery_codes_user_idx').on(t.userId)],
);

/** Registrierte WebAuthn-/Passkey-Credentials (zweiter Faktor). */
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(), // base64url
    publicKey: text('public_key').notNull(), // base64url (COSE)
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('webauthn_credentials_user_idx').on(t.userId)],
);

/**
 * Audit-Log für sicherheitsrelevante (Admin-)Aktionen. Bewusst ohne FK auf users,
 * damit Einträge auch nach dem Löschen eines Kontos erhalten bleiben.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id'),
    actorUsername: text('actor_username'),
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id'),
    targetLabel: text('target_label'),
    detail: text('detail'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type SigningKey = typeof signingKeys.$inferSelect;
