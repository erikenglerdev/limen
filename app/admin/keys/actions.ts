'use server';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { rotateSigningKey } from '@/lib/oidc/keys';

export async function rotateKeysAction(): Promise<void> {
  const admin = await requireAdmin();
  const key = await rotateSigningKey();
  await logAudit({
    actorUserId: admin.id,
    actorUsername: admin.username,
    action: 'signing_key.rotate',
    detail: `neuer kid=${key.kid}`,
  });
  revalidatePath('/admin/keys');
}
