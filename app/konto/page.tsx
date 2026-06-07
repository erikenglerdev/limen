// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, loginAttempts, totpRecoveryCodes } from '@/db';
import { AppHeader } from '@/components/AppHeader';
import { Alert } from '@/components/Alert';
import { Avatar } from '@/components/Avatar';
import { ConfirmButton } from '@/components/ConfirmButton';
import { AvatarSection, PasswordForm, ProfileForm } from '@/components/KontoForms';
import { PasskeysSection } from '@/components/PasskeysSection';
import { StepUpCard } from '@/components/StepUpCard';
import { TwoFactorSection } from '@/components/TwoFactorSection';
import { requireUser } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { listConnectedApps } from '@/lib/oidc/tokens';
import { userCredentials } from '@/lib/webauthn';
import { revokeAppAccess, signOutEverywhere } from './actions';

export const dynamic = 'force-dynamic';

export default async function KontoPage({
  searchParams,
}: {
  searchParams: Promise<{ '2fa_required'?: string; mfa_required?: string }>;
}) {
  const user = await requireUser('/konto');
  const { '2fa_required': twoFaRequired, mfa_required: mfaRequired } =
    await searchParams;
  const connectedApps = await listConnectedApps(user.id);
  const passkeys = (await userCredentials(user.id)).map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
  }));
  const [recoveryRow] = user.totpEnabled
    ? await db
        .select({ c: sql<number>`count(*)::int` })
        .from(totpRecoveryCodes)
        .where(
          and(
            eq(totpRecoveryCodes.userId, user.id),
            isNull(totpRecoveryCodes.usedAt),
          ),
        )
    : [{ c: 0 }];
  const recoveryRemaining = recoveryRow?.c ?? 0;
  const recentLogins = await db
    .select({
      ip: loginAttempts.ip,
      success: loginAttempts.success,
      attemptedAt: loginAttempts.attemptedAt,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.identifier, user.username.toLowerCase()))
    .orderBy(desc(loginAttempts.attemptedAt))
    .limit(10);
  const avatarSrc = user.avatarPath
    ? `/avatar/${user.id}?v=${user.updatedAt.getTime()}`
    : null;
  // Faktor-Verwaltung sperren, wenn das Konto schon einen Faktor hat, die Sitzung aber
  // nur per Passwort erstellt wurde (mfa=false). Erst Step-up mit vorhandenem Faktor.
  const session = await getSession();
  const hasFactor = user.totpEnabled || passkeys.length > 0;
  const factorMgmtLocked = hasFactor && session.mfa !== true;

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <h1 className="text-2xl font-bold">Mein Konto</h1>
        {mfaRequired && (
          <StepUpCard
            hasTotp={user.totpEnabled}
            hasPasskey={passkeys.length > 0}
          />
        )}
        {twoFaRequired && (
          <Alert kind="info">
            Für den Zugriff auf die Verwaltung ist Zwei-Faktor-Authentisierung
            erforderlich. Bitte richten Sie 2FA unten ein.
          </Alert>
        )}
        <div className="grid gap-6 md:grid-cols-2">
          <section className="card p-6">
            <h2 className="mb-4 text-lg font-semibold">Profil</h2>
            <ProfileForm
              username={user.username}
              name={user.name}
              email={user.email}
            />
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-semibold">Profilbild</h2>
            <div className="mb-4 flex items-center gap-4">
              <Avatar name={user.name} src={avatarSrc} size={64} />
              <p className="text-sm text-slate-500">
                Wird quadratisch zugeschnitten und auf 256&nbsp;px verkleinert.
              </p>
            </div>
            <AvatarSection hasAvatar={!!user.avatarPath} />
          </section>

          <section className="card p-6 md:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Passwort ändern</h2>
            <div className="max-w-md">
              <PasswordForm />
            </div>
          </section>

          <section className="card p-6 md:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Zwei-Faktor-Authentisierung</h2>
            {factorMgmtLocked ? (
              <StepUpCard
                hasTotp={user.totpEnabled}
                hasPasskey={passkeys.length > 0}
                next="/konto"
                title="Faktoren verwalten: bitte bestätigen"
                description="Zum Hinzufügen/Entfernen von Passkeys oder TOTP und zum Erzeugen neuer Recovery-Codes muss diese Sitzung mit einem vorhandenen Faktor bestätigt werden."
              />
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Authenticator-App (TOTP)
                  </h3>
                  <TwoFactorSection
                    enabled={user.totpEnabled}
                    recoveryRemaining={recoveryRemaining}
                  />
                </div>
                <div className="border-t border-slate-100 pt-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">
                    Passkeys / Sicherheitsschlüssel
                  </h3>
                  <PasskeysSection passkeys={passkeys} />
                </div>
              </div>
            )}
          </section>

          <section className="card p-6 md:col-span-2">
            <h2 className="mb-1 text-lg font-semibold">Verbundene Anwendungen</h2>
            <p className="mb-4 text-sm text-slate-500">
              Apps, die aktuell über ein gültiges Refresh-Token auf Ihr Konto zugreifen
              können. „Zugriff widerrufen“ meldet Sie aus der jeweiligen App ab.
            </p>
            {connectedApps.length === 0 ? (
              <p className="text-sm text-slate-400">Derzeit keine aktiven Verbindungen.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {connectedApps.map((app) => (
                  <li
                    key={app.clientId}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{app.name}</div>
                      <div className="text-xs text-slate-400">
                        zuletzt verbunden {new Date(app.lastAt).toLocaleString('de-DE')}
                      </div>
                    </div>
                    <ConfirmButton
                      action={revokeAppAccess.bind(null, app.clientId)}
                      label="Zugriff widerrufen"
                      className="btn-secondary btn-sm"
                      title={`Zugriff von „${app.name}" widerrufen?`}
                      message="Sie werden aus dieser App abgemeldet."
                      confirmLabel="Widerrufen"
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 border-t border-slate-100 pt-4">
              <p className="mb-2 text-sm text-slate-600">
                Bei Verdacht auf unbefugten Zugriff oder Geräteverlust: meldet Sie auf
                allen anderen Geräten und in allen verbundenen Apps ab. Diese Sitzung
                bleibt aktiv.
              </p>
              <ConfirmButton
                action={signOutEverywhere}
                label="Überall abmelden"
                className="btn-danger btn-sm"
                title="Überall abmelden?"
                message="Sie werden auf allen anderen Geräten und in allen verbundenen Apps abgemeldet. Diese Sitzung bleibt aktiv."
                confirmLabel="Überall abmelden"
                confirmClassName="btn-danger"
              />
            </div>
          </section>

          <section className="card p-6 md:col-span-2">
            <h2 className="mb-1 text-lg font-semibold">Anmeldeaktivität</h2>
            <p className="mb-4 text-sm text-slate-500">
              Die letzten Anmeldeversuche für Ihr Konto (zur Erkennung unbefugter
              Zugriffe).
            </p>
            {recentLogins.length === 0 ? (
              <p className="text-sm text-slate-400">Keine jüngsten Anmeldeversuche.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {recentLogins.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 py-2">
                    <span className="w-44 shrink-0 text-xs text-slate-400">
                      {l.attemptedAt.toLocaleString('de-DE')}
                    </span>
                    {l.success ? (
                      <span className="font-medium text-green-700">erfolgreich</span>
                    ) : (
                      <span className="font-medium text-red-700">fehlgeschlagen</span>
                    )}
                    <span className="text-slate-500">{l.ip ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
