import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { generateFirstChapterFreePreview } from '@/modules/kdp/service';
import { respData, respErr } from '@/lib/resp';

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const { id } = await context.params;
    const result = await generateFirstChapterFreePreview(session.user.id, id);
    return respData(result);
  } catch (err: any) {
    return respErr(err?.message || 'Failed to generate preview chapter');
  }
}
