import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { getAuth } from '@/core/auth';
import { db } from '@/core/db';
import { kdpPenProfile } from '@/config/db/schema';
import { createPenProfile, listPenProfiles } from '@/modules/kdp/service';
import { respData, respErr } from '@/lib/resp';

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const profiles = await listPenProfiles(session.user.id);
    return respData({ profiles });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to load pen profiles');
  }
}

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const body = await req.json().catch(() => ({}));
    const created = await createPenProfile({
      userId: session.user.id,
      penNameFirst: String(body.pen_name_first || ''),
      penNameLast: String(body.pen_name_last || ''),
      editionLabel: body.edition_label,
      companionDomain: body.companion_domain,
      notes: body.notes,
    });

    return respData({ profile: created });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to create pen profile');
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) return respErr('Profile id is required');

    const [updated] = await db()
      .update(kdpPenProfile)
      .set({
        lastPublishedAt: body.mark_published ? new Date() : undefined,
        companionDomain:
          typeof body.companion_domain === 'string'
            ? body.companion_domain.trim()
            : undefined,
        updatedAt: new Date(),
      })
      .where(
        and(eq(kdpPenProfile.id, id), eq(kdpPenProfile.userId, session.user.id))
      )
      .returning();

    if (!updated) return respErr('Profile not found');
    return respData({ profile: updated });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to update profile');
  }
}
