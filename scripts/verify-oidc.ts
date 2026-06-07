// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/**
 * End-to-end Verifikation des OIDC Authorization-Code-Flows mit PKCE.
 *
 * Voraussetzung: ein laufender (Dev-)Server inkl. geseedetem Admin und Dev-Client.
 * Aufruf:  npm run verify
 * Env:     BASE_URL (default http://localhost:3000), ADMIN_USER, ADMIN_PASSWORD
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const USER = process.env.ADMIN_USER ?? 'admin';
const PASS = process.env.ADMIN_PASSWORD ?? 'bitte-aendern';
const CLIENT_ID = 'dev-client';
const REDIRECT_URI = `${BASE}/dev/test-client/callback`;

let passed = 0;
function ok(msg: string) {
  passed++;
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}
function assert(cond: unknown, msg: string) {
  if (!cond) fail(msg);
  ok(msg);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

async function main() {
  console.log(`OIDC-Verifikation gegen ${BASE}\n`);

  // 1) Discovery
  console.log('1) Discovery');
  const disco = await (await fetch(`${BASE}/.well-known/openid-configuration`)).json();
  assert(disco.issuer === BASE, `issuer = ${disco.issuer}`);
  assert(disco.authorization_endpoint?.endsWith('/authorize'), 'authorization_endpoint vorhanden');
  assert(disco.token_endpoint?.endsWith('/token'), 'token_endpoint vorhanden');
  assert(
    Array.isArray(disco.code_challenge_methods_supported) &&
      disco.code_challenge_methods_supported.includes('S256'),
    'S256 unterstützt',
  );

  // 2) JWKS
  console.log('2) JWKS');
  const jwks = await (await fetch(disco.jwks_uri)).json();
  assert(Array.isArray(jwks.keys) && jwks.keys.length > 0, `JWKS hat ${jwks.keys?.length} Schlüssel`);

  // 3) Login (dev-only Endpoint)
  console.log('3) Login');
  const loginRes = await fetch(`${BASE}/dev/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  assert(loginRes.ok, `Login als "${USER}" erfolgreich`);
  const setCookie = loginRes.headers.get('set-cookie');
  assert(!!setCookie, 'sso_session-Cookie gesetzt');
  const cookie = setCookie!.split(';')[0];

  // 4) Authorize (PKCE)
  console.log('4) Authorize');
  const verifier = b64url(randomBytes(32));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = b64url(randomBytes(12));
  const nonce = b64url(randomBytes(12));
  const authUrl = new URL(`${BASE}/authorize`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const authRes = await fetch(authUrl, { headers: { cookie }, redirect: 'manual' });
  const location = authRes.headers.get('location');
  assert(authRes.status >= 300 && authRes.status < 400 && !!location, 'authorize leitet weiter (302)');
  const cbUrl = new URL(location!);
  assert(cbUrl.searchParams.get('state') === state, 'state stimmt überein');
  const code = cbUrl.searchParams.get('code');
  assert(!!code, 'Authorization-Code erhalten');

  // 5) Token (authorization_code)
  console.log('5) Token-Austausch');
  const tokenRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      client_id: CLIENT_ID,
    }),
  });
  const tokens = await tokenRes.json();
  assert(tokenRes.ok, 'Token-Endpoint antwortet 200');
  assert(!!tokens.id_token && !!tokens.access_token && !!tokens.refresh_token, 'id/access/refresh erhalten');

  // 6) id_token gegen JWKS verifizieren
  console.log('6) id_token-Signatur');
  const remoteJwks = createRemoteJWKSet(new URL(disco.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, remoteJwks, {
    issuer: BASE,
    audience: CLIENT_ID,
  });
  assert(!!payload.sub, `sub = ${payload.sub}`);
  assert(payload.nonce === nonce, 'nonce im id_token stimmt');
  assert(payload.preferred_username === USER, `preferred_username = ${payload.preferred_username}`);

  // 7) UserInfo
  console.log('7) UserInfo');
  const uiRes = await fetch(`${BASE}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userinfo = await uiRes.json();
  assert(uiRes.ok, 'userinfo antwortet 200');
  assert(userinfo.sub === payload.sub, 'userinfo.sub stimmt mit id_token überein');

  // 8) Refresh-Rotation
  console.log('8) Refresh-Token-Rotation');
  const refreshRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  const refreshed = await refreshRes.json();
  assert(refreshRes.ok, 'Refresh erfolgreich');
  assert(refreshed.refresh_token && refreshed.refresh_token !== tokens.refresh_token, 'neuer Refresh-Token (rotiert)');

  // 9) Reuse-Detection: alter Refresh-Token muss abgelehnt werden
  console.log('9) Reuse-Detection');
  const reuseRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  assert(reuseRes.status === 400, 'wiederverwendeter Refresh-Token abgelehnt');

  // 10) Logout (RP-initiated)
  console.log('10) Logout');
  const logoutUrl = new URL(`${BASE}/logout`);
  logoutUrl.searchParams.set('client_id', CLIENT_ID);
  logoutUrl.searchParams.set('post_logout_redirect_uri', `${BASE}/dev/test-client`);
  const logoutRes = await fetch(logoutUrl, { headers: { cookie }, redirect: 'manual' });
  const logoutLoc = logoutRes.headers.get('location');
  assert(
    logoutRes.status >= 300 && logoutRes.status < 400 && logoutLoc === `${BASE}/dev/test-client`,
    'logout leitet zu erlaubter post_logout_redirect_uri',
  );

  console.log(`\n✅ Alle ${passed} Prüfungen bestanden.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
