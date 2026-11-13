import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { getBalance } from '@/modules/credits/service';
import {
  createProjectAndOutline,
  listUserProjects,
} from '@/modules/kdp/service';
import { respData, respErr } from '@/lib/resp';

export async function GET() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const [projects, credits] = await Promise.all([
      listUserProjects(session.user.id),
      getBalance(session.user.id),
    ]);

    return respData({ projects, credits });
  } catch (err: any) {
    return respErr(err?.message || 'Failed to load projects');
  }
}

export async function POST(req: Request) {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return respErr('Unauthorized');

    const body = await req.json().catch(() => ({}));
    const topicPrompt = String(body.topic_prompt || '').trim();
    if (!topicPrompt) {
      return respErr('Topic or book premise is required');
    }

    const result = await createProjectAndOutline({
      userId: session.user.id,
      penProfileId: body.pen_profile_id || undefined,
      title: body.title,
      subtitle: body.subtitle,
      genre: body.genre || 'Self-Help',
      topicPrompt,
      targetAudience: body.target_audience,
      companionProduct: body.companion_product,
      companionUrl: body.companion_url,
      trimSize: body.trim_size || '6x9',
      targetPageCount: Number(body.target_page_count) || 100,
      paperType: body.paper_type || 'cream',
      coverTheme: body.cover_theme || 'editorial_split',
      language: body.language || 'en',
    });

    return respData(result);
  } catch (err: any) {
    return respErr(err?.message || 'Failed to create project');
  }
}
