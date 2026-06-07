// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
/** @type {import('next').NextConfig} */

// CSRF-Schutz der Server Actions: Next.js gleicht den Origin-Header gegen den (ggf. vom
// Reverse-Proxy via Host/X-Forwarded-Host weitergereichten) Host ab. Diese App ruft Server
// Actions ausschließlich Same-Origin auf – der eingebaute Origin↔Host-Abgleich genügt und
// blockt fremde Origins (z.B. evil.com) zuverlässig. `allowedOrigins` würde nur ZUSÄTZLICHE
// Origins erlauben und ist hier nicht nötig. Daher wird die öffentliche URL NICHT mehr aus
// APP_BASE_URL zur Build-Zeit eingebacken (das war der einzige Build-Zeit-Bezug) – APP_BASE_URL
// ist damit reine Laufzeit-Config (compose/.env), das Image ist deployment-URL-unabhängig.
// Voraussetzung in Produktion: nginx reicht den korrekten Host durch (siehe nginx.conf.example).
// In der Entwicklung (`next dev`, ggf. abweichende Ports/HMR) erlauben wir localhost explizit.
const allowedOrigins = [];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('localhost:3000');
}

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Native / Node-only Module nicht ins Bundle ziehen, sondern zur Laufzeit laden.
  serverExternalPackages: ['@node-rs/argon2', 'sharp', 'pg', 'drizzle-orm'],
  experimental: {
    serverActions: {
      allowedOrigins,
      bodySizeLimit: '6mb', // Avatar-Uploads
    },
  },
  // ESLint-Setup ist nicht Teil dieses Dienstes; Typecheck bleibt aktiv und ist das
  // eigentliche Qualitätsgate. Build soll nicht an fehlender ESLint-Config scheitern.
  eslint: { ignoreDuringBuilds: true },
  // Statische Sicherheits-Header für alle Antworten. Die Content-Security-Policy wird
  // dagegen pro Request in middleware.ts gesetzt (nonce-basiert).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // HSTS wird über plain HTTP von Browsern ignoriert (greift erst über HTTPS
          // hinter nginx). Kein includeSubDomains, um Nachbar-Subdomains nicht zu binden.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
        ],
      },
    ];
  },
  // instrumentation.ts läuft nur in der Node-Runtime (Guard in register()). Damit die
  // Edge-/Client-Kompilierung der Instrumentation nicht über node-only Module von `pg`
  // (fs/net/tls/pg-native) stolpert, lösen wir diese dort als leer auf. Im Node-Server
  // bleiben sie real.
  webpack: (config, { nextRuntime, webpack }) => {
    // Im Edge/Client-Build wird der Node-only Subtree (instrumentation → bootstrap →
    // db/pg, @node-rs/argon2, node:* Builtins) nie ausgeführt – die register()-Logik
    // läuft ausschließlich in der Node-Runtime. Damit dieser Build nicht über node-only
    // Importe stolpert, neutralisieren wir sie hier.
    if (nextRuntime !== 'nodejs') {
      // node:crypto → crypto usw., damit die fallbacks unten greifen.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        '@node-rs/argon2': false,
        '@node-rs/argon2-wasm32-wasi': false,
      };
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        dns: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        util: false,
        events: false,
        assert: false,
        buffer: false,
        querystring: false,
        string_decoder: false,
        zlib: false,
        'pg-native': false,
      };
    }
    return config;
  },
};

export default nextConfig;
