// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Limen',
  description: 'Limen – zentrale Anmeldung (Single Sign-On)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
