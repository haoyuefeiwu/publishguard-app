import { revalidatePath } from 'next/cache';

import { envConfigs } from '@/config';
import {
  authorizeGrowth,
  growthJsonResponse,
  readGrowthBody,
  upsertGrowthArticleDraft,
  validateGrowthArticle,
} from '@/modules/growth-content/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 接收来自 Growth Platform 的已审核 SEO/GEO 文章并落库发布或存草稿。
 */
export function POST(request: Request) {
  return growthJsonResponse(async () => {
    authorizeGrowth(request);
    const input = validateGrowthArticle(await readGrowthBody(request, 32_000));
    const result = await upsertGrowthArticleDraft(
      input,
      envConfigs.growth_draft_author_email
    );

    // 公开上线后立即刷新博客列表、详情及收录入口缓存
    if (input.publish) {
      try {
        revalidatePath('/blog');
        revalidatePath('/en/blog');
        revalidatePath('/zh/blog');
        revalidatePath(`/blog/${input.slug}`);
        revalidatePath(`/en/blog/${input.slug}`);
        revalidatePath('/sitemap.xml');
        revalidatePath('/llms.txt');
        revalidatePath('/llms-full.txt');
      } catch {
        // 忽略非请求上下文调用 revalidatePath 时的异常
      }
    }

    return result;
  });
}
