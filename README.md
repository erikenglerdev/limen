# Limen – Zentraler Identitätsdienst (OpenID Connect)

Eigenständiger, selbst-hostbarer **OpenID-Connect-Identity-Provider (IdP)** für kleine bis
mittlere Organisationen. Mehrere Web-Apps melden sich zentral bei Limen an (Single Sign-On).
Limen ist die **zentrale Stelle für Identität** (Konten, Login, Profil); **Autorisierung**
(Rollen/Rechte) macht jede App selbst auf Basis der gelieferten Identität.

> Tiefergehende Architektur-/Sicherheitsdetails stehen in [`CLAUDE.md`](./CLAUDE.md).

## Was die App kann

- **OIDC / OAuth 2.0** – Authorization Code Flow mit **PKCE (S256)**, Discovery & JWKS,
  ID-/Access-Token als **JWT (RS256)**, opake **Refresh-Tokens mit Rotation** + Reuse-Detection.
  Endpunkte: `/authorize`, `/token`, `/userinfo`, `/revoke`, `/introspect`, `/logout`,
  `/.well-known/openid-configuration`, `/.well-known/jwks.json`.
- **Login** – Username + Passwort (+ TOTP-Schritt, falls eingerichtet) **oder** passwortloser
  **Passkey-Login** (WebAuthn, user-verifiziert → MFA-stark).
- **Zwei-Faktor** – TOTP (Authenticator-App + einmalige Recovery-Codes) und/oder **Passkeys**,
  optional pro Konto. Faktor-Verwaltung ist step-up-geschützt.
- **Self-Service** (`/konto`) – Passwort/Name/E-Mail ändern, Avatar, 2FA/Passkeys verwalten,
  verbundene Apps widerrufen, „überall abmelden", Anmeldeverlauf. Username ist immutabel.
- **Admin** (`/admin`) – Konten anlegen/suchen/bearbeiten/(de)aktivieren/löschen, Passwort-Reset,
  SSO-Admin & 2FA-Reset; Client-Apps registrieren (`/admin/clients`), Signaturschlüssel rotieren
  (`/admin/keys`), Audit-Log (`/admin/audit`). Der Admin-Bereich erzwingt eine MFA-Sitzung.
- **Sicherheit** – argon2id-Hashing, at-rest-Verschlüsselung (AES-256-GCM) für Signing-Keys &
  TOTP-Secrets, (IP+Konto)-Login-Drossel, kontogebundene 2FA-Drossel, TOTP-Einmalverwendung,
  nonce-basierte CSP, exakter `redirect_uri`-Allowlist-Match, Kill-Switch bei Deaktivierung.

## Tech-Stack

Next.js 15 (App Router) · React 19 · TypeScript · PostgreSQL 16 + Drizzle ORM · iron-session ·
jose (RS256/JWKS) · @node-rs/argon2 · @simplewebauthn · otpauth · sharp · Tailwind CSS 3.4.
Auslieferung als Docker-Standalone-Image hinter nginx.

## Deployment (Docker + nginx)

Voraussetzung: Docker & Docker Compose. nginx terminiert TLS; die App spricht intern nur HTTP.

```bash
# 1. Konfiguration anlegen
cp .env.example .env
#    → alle CHANGE_ME / leeren Werte befüllen (siehe unten)

# 2. Starten (DB-Migrationen + erster Admin + Signaturschlüssel laufen automatisch)
docker compose up -d --build

# 3. Health prüfen
curl -s http://127.0.0.1:3000/api/health   # {"status":"ok"}
```

Beim ersten Start werden die DB-Migrationen angewandt, der erste SSO-Admin aus
`ADMIN_USER`/`ADMIN_PASSWORD` angelegt und ein RS256-Signaturschlüssel erzeugt.

### Konfiguration (`.env`)

| Variable | Zweck |
|---|---|
| `APP_BASE_URL` | Öffentliche HTTPS-URL = OIDC-issuer, z.B. `https://id.example.de` (beim Build gesetzt) |
| `AUTH_SECRET` | iron-session-Secret (≥ 32 Zeichen) – `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 64 Hex (32 Byte) für AES-256-GCM – `openssl rand -hex 32` |
| `DATABASE_URL` / `POSTGRES_PASSWORD` | PostgreSQL-Verbindung bzw. DB-Passwort |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Bootstrap des ersten Admins (Passwort danach ändern) |
| `UPLOAD_DIR` | Avatar-Verzeichnis (Volume) |
| `AUTH_TRUST_HOST` | `true` hinter nginx |
| `TRUSTED_PROXY_SECRET` | Optional: Shared-Secret gegen IP-Spoofing (nginx sendet `X-Proxy-Auth`) |

`.env.example` = schlanke Vorlage · `.env.example.read` = ausführlich kommentiertes Nachschlagewerk.

### nginx

Beispiel in [`nginx.conf.example`](./nginx.conf.example): TLS-Terminierung, reicht
`Host` + `X-Real-IP` + `X-Forwarded-*` durch und drosselt `/login` und `/token`
(`limit_req`). Die App ist im Compose nur an `127.0.0.1:3000` gebunden – nginx erreicht sie
darüber (oder im selben Docker-Netz via `app:3000` mit `expose: ['3000']`).

## ⚠️ Worauf man achten muss

- **Starke Secrets** verwenden – **nie** die `CHANGE_ME`-Platzhalter. `AUTH_SECRET` und
  `ENCRYPTION_KEY` je mit `openssl rand -hex 32`; starke `POSTGRES_PASSWORD`/`ADMIN_PASSWORD`.
- **`ENCRYPTION_KEY` sicher aufbewahren/sichern.** Geht er verloren, sind die verschlüsselten
  Signaturschlüssel und TOTP-Secrets nicht mehr entschlüsselbar. Wechsel nur über das
  Rotations-Skript (siehe unten).
- **`APP_BASE_URL` = echte öffentliche HTTPS-URL**, schon beim `docker build` gesetzt – sie
  fließt in den issuer **und** in den CSRF-Origin-Check (`serverActions.allowedOrigins`). Falsch
  gesetzt ⇒ Tokens/Logins brechen.
- **App nicht direkt exponieren.** Sie muss hinter nginx liegen (Loopback-Bind bzw. `expose`).
  Direktzugriff an nginx vorbei würde `X-Real-IP`-Spoofing erlauben (IP-Drossel/Audit). Empfohlen:
  zusätzlich `TRUSTED_PROXY_SECRET` + `proxy_set_header X-Proxy-Auth …` in nginx.
- **`NODE_ENV=production`** im Betrieb (setzt Compose). Deaktiviert die `/dev/*`-Hilfsrouten und
  aktiviert die `__Host-`-Cookies + volle CSP.
- **DB-Backups** für das `pgdata`-Volume einplanen.
- **Ersten Admin** nach dem ersten Login absichern (Passwort ändern, 2FA/Passkey einrichten).

## Integration einer Client-App (Konsument)

Standard-OIDC gegen die Discovery-URL `${APP_BASE_URL}/.well-known/openid-configuration`.
Client unter `/admin/clients` registrieren (Redirect-URI exakt eintragen; `client_secret` wird
**einmalig** angezeigt). Gelieferte Claims: `sub` (stabiler Linkage-Key), `preferred_username`,
`name`, optional `picture`/`email`. Beispiel für Auth.js („generic OIDC provider") und Details
siehe [`CLAUDE.md`](./CLAUDE.md).

## Lokale Entwicklung

```bash
npm install
cp .env.example .env          # lokale Werte (APP_BASE_URL=http://localhost:3000)
npm run dev                    # Dev-Server (aktiviert /dev/test-client)
npm run verify                 # E2E-Verifikation des OIDC-Flows
npm run typecheck && npm run lint
```

## Betriebs-/Notfall-Skripte (Server-/DB-Zugriff nötig)

```bash
# AES-Umschlüssel rotieren (alle at-rest-Secrets neu verschlüsseln):
ENCRYPTION_KEY_OLD=<alt> ENCRYPTION_KEY=<neu> DATABASE_URL=... npm run rotate-encryption-key

# Break-Glass bei komplettem Admin-Lockout (2FA reset, zum Admin machen, aktivieren, PW setzen):
npm run admin:recover -- --user <name> --reset-2fa --make-admin --activate
```

Im Docker-Betrieb z.B. via `docker compose run --rm -e … app npm run rotate-encryption-key`.

## Lizenz

**GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** — siehe [`LICENSE`](./LICENSE).
© 2026 Erik Engler.

Kurz: nutzen, hosten und ändern erlaubt — **aber wer eine geänderte Version weitergibt oder als
Netzdienst betreibt, muss den Quellcode (inkl. Änderungen) unter AGPL offenlegen.** Es darf keine
geschlossene Variante entstehen.

