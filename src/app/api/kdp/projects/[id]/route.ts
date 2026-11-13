import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { getAuth } from '@/core/auth';
import { db } from '@/core/db';
import { kdpProject } from '@/config/db/schema';
import { getBalance } from '@/modules/credits/service';
import { getProjectDetail, updateProjectSettings } from '@/modules/kdp/service';
import { respData, respErr } from '@/lib/resp';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const { id } = await context.params;
    const [detail, credits] = await Promise.all([
      getProjectDetail(session.user.id, id),
      getBalance(session.user.id),
    ]);
    if (!detail) return respErr('Project not found');

    return respData({ ...detail, credits });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to load project');
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const updated = await updateProjectSettings(session.user.id, id, {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      subtitle:
        typeof body.subtitle === 'string' ? body.subtitle.trim() : undefined,
      genre: typeof body.genre === 'string' ? body.genre.trim() : undefined,
      coverTheme:
        typeof body.cover_theme === 'string' ? body.cover_theme : undefined,
      trimSize: typeof body.trim_size === 'string' ? body.trim_size : undefined,
      targetPageCount: body.target_page_count
        ? Number(body.target_page_count)
        : undefined,
      paperType:
        typeof body.paper_type === 'string' ? body.paper_type : undefined,
      companionUrl:
        typeof body.companion_url === 'string'
          ? body.companion_url.trim()
          : undefined,
      penProfileId:
        body.pen_profile_id !== undefined ? body.pen_profile_id : undefined,
    });

    return respData({ project: updated });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to update project');
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const { id } = await context.params;
    await db()
      .delete(kdpProject)
      .where(
        and(eq(kdpProject.id, id), eq(kdpProject.userId, session.user.id))
      );

    return respData({ deleted: true });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to delete project');
  }
}
