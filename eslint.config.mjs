// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/** Flat ESLint-Config (ESLint 9). Ersetzt das interaktive `next lint`. */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'next-env.d.ts',
      'eslint.config.mjs',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Mit _ präfixierte Argumente/Variablen sind bewusst ungenutzt (z.B. Server-Action-
      // Signatur (_prev, _formData) bei useActionState).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
