import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { getAuth } from '@/core/auth';
import { db } from '@/core/db';
import { kdpChapter, kdpProject } from '@/config/db/schema';
import { sanitizeChapterHtml } from '@/lib/html-sanitizer';
import { respData, respErr } from '@/lib/resp';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; chapterId: string }> }
) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const { id: projectId, chapterId } = await context.params;

    const [proj] = await db()
      .select({ status: kdpProject.status })
      .from(kdpProject)
      .where(
        and(
          eq(kdpProject.id, projectId),
          eq(kdpProject.userId, session.user.id)
        )
      )
      .limit(1);
    if (!proj) return respErr('Project not found');
    if (proj.status === 'queued' || proj.status === 'generating') {
      return respErr(
        'Cannot edit chapters while project generation is in progress'
      );
    }

    const body = await req.json().catch(() => ({}));

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (typeof body.title === 'string') patch.title = body.title.trim();
    if (typeof body.summary === 'string') patch.summary = body.summary.trim();
    if (typeof body.content_html === 'string') {
      const safeHtml = sanitizeChapterHtml(body.content_html);
      patch.contentHtml = safeHtml;
      const plain = safeHtml.replace(/<[^>]+>/g, ' ').trim();
      patch.wordCount = plain ? plain.split(/\s+/).length : 0;
    }

    const [updated] = await db()
      .update(kdpChapter)
      .set(patch)
      .where(
        and(
          eq(kdpChapter.id, chapterId),
          eq(kdpChapter.projectId, projectId),
          eq(kdpChapter.userId, session.user.id)
        )
      )
      .returning();

    if (!updated) return respErr('Chapter not found');
    return respData({ chapter: updated });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to update chapter');
  }
}
