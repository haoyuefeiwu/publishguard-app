import { timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import { post, user } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

const EXPECTED_PROJECT = 'publishguard';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GrowthSyncError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * 校验 Growth Platform 内部同步 Bearer Token；
 * 未配置有效密钥（少于 32 位）时接口自动关闭。
 */
export function authorizeGrowth(request: Request) {
  const expected = envConfigs.growth_internal_token;
  const supplied =
    request.headers
      .get('authorization')
      ?.replace(/^Bearer /i, '')
      .trim() ?? '';
  if (!expected || expected.length < 32) {
    throw new GrowthSyncError('integration_disabled', 503);
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GrowthSyncError('unauthorized', 401);
  }
}

/**
 * 流式读取并校验 JSON 请求体大小，防止超大载荷耗尽内存。
 */
export async function readGrowthBody(req: Request, maxBytes = 32_000) {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new GrowthSyncError('invalid_input', 400);
  }
  const reader = req.body?.getReader();
  if (!reader) {
    throw new GrowthSyncError('invalid_input', 400);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new GrowthSyncError('invalid_input', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GrowthSyncError('invalid_input', 400);
  }
}

/**
 * 校验从 Growth Platform 推送过来的文章载荷字段格式与长度。
 */
export function validateGrowthArticle(input: unknown) {
  const raw = input as Record<string, unknown> | null;
  if (
    !raw ||
    raw.project !== EXPECTED_PROJECT ||
    typeof raw.draftId !== 'string' ||
    !UUID.test(raw.draftId)
  ) {
    throw new GrowthSyncError('invalid_input', 400);
  }
  for (const field of ['slug', 'title', 'description', 'content']) {
    if (typeof raw[field] !== 'string') {
      throw new GrowthSyncError('invalid_input', 400);
    }
  }
  const slug = (raw.slug as string).trim().toLowerCase();
  const title = (raw.title as string).trim();
  const description = (raw.description as string).trim();
  const content = (raw.content as string).trim();
  const publish = raw.publish === true;

  if (
    !SLUG.test(slug) ||
    slug.length > 120 ||
    !title ||
    title.length > 120 ||
    description.length < 40 ||
    description.length > 200 ||
    !content ||
    content.length > 24_000
  ) {
    throw new GrowthSyncError('invalid_input', 400);
  }

  return { draftId: raw.draftId, slug, title, description, content, publish };
}

/**
 * 按 draftId 幂等写入或更新文章记录，绝不覆盖非内容中台创建的手工文章。
 */
export async function upsertGrowthArticleDraft(
  input: ReturnType<typeof validateGrowthArticle>,
  authorEmail: string
) {
  if (!authorEmail) {
    throw new GrowthSyncError('integration_disabled', 503);
  }
  const normalizedEmail = authorEmail.trim().toLowerCase();
  const defaultAuthorName = `${envConfigs.app_name || 'PublishGuard'} Editorial Team`;

  let [author] = await db()
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1);

  if (!author) {
    await db()
      .insert(user)
      .values({
        id: getUuid(),
        name: defaultAuthorName,
        email: normalizedEmail,
        emailVerified: true,
      })
      .onConflictDoNothing();

    [author] = await db()
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1);
  }

  if (!author) {
    throw new GrowthSyncError('integration_disabled', 503);
  }

  const marker = `growth-platform:${input.draftId}`;
  const targetStatus = input.publish ? 'published' : 'draft';

  return db().transaction(async (tx: ReturnType<typeof db>) => {
    // 仅 PostgreSQL 支持事务级咨询锁，避免并发重复推送相同 draftId 产生竞态
    if (
      envConfigs.database_provider === 'postgresql' ||
      envConfigs.database_provider === 'postgres'
    ) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    }

    const [existing] = await tx
      .select()
      .from(post)
      .where(eq(post.tags, marker))
      .limit(1);

    if (existing) {
      if (existing.type !== 'article' || existing.userId !== author.id) {
        throw new GrowthSyncError('post_not_draft', 409);
      }
      if (!input.publish && existing.status !== 'draft') {
        throw new GrowthSyncError('post_not_draft', 409);
      }
      const [conflict] = await tx
        .select({ id: post.id })
        .from(post)
        .where(eq(post.slug, input.slug))
        .limit(1);
      if (conflict && conflict.id !== existing.id) {
        throw new GrowthSyncError('slug_conflict', 409);
      }

      const [updated] = await tx
        .update(post)
        .set({
          slug: input.slug,
          title: input.title,
          description: input.description,
          content: input.content,
          status: targetStatus,
        })
        .where(and(eq(post.id, existing.id), eq(post.tags, marker)))
        .returning({ id: post.id });

      if (!updated) {
        throw new GrowthSyncError('post_not_draft', 409);
      }
      return { id: updated.id, status: targetStatus, updated: true };
    }

    const [conflict] = await tx
      .select({ id: post.id })
      .from(post)
      .where(eq(post.slug, input.slug))
      .limit(1);
    if (conflict) {
      throw new GrowthSyncError('slug_conflict', 409);
    }

    const [created] = await tx
      .insert(post)
      .values({
        id: getUuid(),
        userId: author.id,
        slug: input.slug,
        type: 'article',
        title: input.title,
        description: input.description,
        content: input.content,
        authorName: author.name || defaultAuthorName,
        tags: marker,
        status: targetStatus,
      })
      .returning({ id: post.id });

    return { id: created.id, status: targetStatus, updated: false };
  });
}

/**
 * 统一封装 Growth Sync 接口的 JSON 响应并禁止缓存。
 */
export async function growthJsonResponse(fn: () => Promise<unknown>) {
  try {
    return Response.json(
      { code: 0, data: await fn() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const known = error instanceof GrowthSyncError;
    return Response.json(
      { code: -1, message: known ? error.code : 'unavailable' },
      {
        status: known ? error.status : 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
