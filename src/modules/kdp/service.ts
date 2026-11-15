/**
 * PublishGuard KDP 核心业务服务层。
 * 遵循 ShipAny 模块规范：不直接处理 HTTP 请求，仅封装数据库事务、积分扣除与 Python 出版引擎编排。
 */

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import {
  kdpChapter,
  kdpGuardReport,
  kdpJob,
  kdpPenProfile,
  kdpProject,
} from '@/config/db/schema';
import { consume, revoke } from '@/modules/credits/service';
import { getCurrentSubscription } from '@/modules/subscriptions/service';
import { getUuid, md5 } from '@/lib/hash';
import { sanitizeChapterHtml } from '@/lib/html-sanitizer';

import {
  KDP_COVER_THEMES,
  KDP_CREDIT_COSTS,
  KDP_SAFE_CADENCE_DAYS,
} from './constants';
import {
  autoSanitizeViaPython,
  executeKdpGuardAudit,
  generateBookOutlineViaPython,
  generateChapterPreviewViaPython,
  type GuardAuditResponse,
} from './python-bridge';

// ─── 1. 笔名档案与跨账号关联防封矩阵 ─────────────────────────────────────────

export async function listPenProfiles(userId: string) {
  const profiles = await db()
    .select()
    .from(kdpPenProfile)
    .where(eq(kdpPenProfile.userId, userId))
    .orderBy(desc(kdpPenProfile.createdAt));

  const now = Date.now();
  const domainCounts = new Map<string, number>();
  for (const p of profiles) {
    const d = normalizeHost(p.companionDomain);
    if (d) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }

  return profiles.map((p: any) => {
    const host = normalizeHost(p.companionDomain);
    const lastPubMs = p.lastPublishedAt
      ? new Date(p.lastPublishedAt).getTime()
      : 0;
    const daysSinceLast = lastPubMs
      ? Math.floor((now - lastPubMs) / 86_400_000)
      : null;
    return {
      ...p,
      domainConflict: Boolean(host && (domainCounts.get(host) || 0) > 1),
      cooldownActive:
        daysSinceLast !== null && daysSinceLast < KDP_SAFE_CADENCE_DAYS,
      daysRemaining:
        daysSinceLast !== null && daysSinceLast < KDP_SAFE_CADENCE_DAYS
          ? KDP_SAFE_CADENCE_DAYS - daysSinceLast
          : 0,
    };
  });
}

export async function createPenProfile(params: {
  userId: string;
  penNameFirst: string;
  penNameLast: string;
  editionLabel?: string;
  companionDomain?: string;
  notes?: string;
}) {
  const first = params.penNameFirst.trim();
  const last = params.penNameLast.trim();
  if (!first || !last) {
    throw new Error('Pen name requires both first name and last name');
  }

  // 防关联检验：禁止多笔名共用同一伴读域名
  const host = normalizeHost(params.companionDomain || '');
  const existing = await listPenProfiles(params.userId);
  if (
    host &&
    existing.some((p: any) => normalizeHost(p.companionDomain) === host)
  ) {
    throw new Error(
      `Cross-account linkage risk: domain "${host}" is already bound to another pen profile.`
    );
  }

  const [created] = await db()
    .insert(kdpPenProfile)
    .values({
      id: getUuid(),
      userId: params.userId,
      penNameFirst: first,
      penNameLast: last,
      fullName: `${first} ${last}`,
      editionLabel: (params.editionLabel || 'INDEPENDENT EDITION').trim(),
      companionDomain: (params.companionDomain || '').trim(),
      notes: (params.notes || '').trim(),
    })
    .returning();

  return created;
}

function normalizeHost(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return '';
  try {
    const url = new URL(
      cleaned.includes('://') ? cleaned : `https://${cleaned}`
    );
    return url.hostname.replace(/^www\./, '');
  } catch {
    return cleaned.split('/')[0].replace(/^www\./, '');
  }
}

// ─── 2. 公域免费体检仪与合规洗稿 ─────────────────────────────────────────────

export async function runAndRecordGuardScan(params: {
  userId?: string | null;
  projectId?: string | null;
  clientIp: string;
  title?: string;
  subtitle?: string;
  description?: string;
  authorName?: string;
  primaryCategory?: string;
  manuscriptText?: string;
  epubBase64?: string;
  companionDomain?: string;
  mode?: 'ebook' | 'paperback' | 'dual';
  lang?: 'en' | 'zh';
  checkLiveCollisions?: boolean;
}) {
  const ipHash = md5(params.clientIp || 'unknown');

  // 未登录游客：每日严格限流 3 次免费扫描（保护上游苹果/OpenLibrary 检索配额并引导注册）
  if (!params.userId) {
    const since = new Date(Date.now() - 86_400_000);
    const recent = await db()
      .select({ id: kdpGuardReport.id })
      .from(kdpGuardReport)
      .where(
        and(
          eq(kdpGuardReport.clientIpHash, ipHash),
          gte(kdpGuardReport.createdAt, since)
        )
      );
    if (recent.length >= KDP_CREDIT_COSTS.GUARD_FREE_DAILY_ANON_LIMIT) {
      throw new Error(
        'Daily free anonymous limit (3 scans/day) reached. Sign up free to unlock 30 credits and unlimited scans.'
      );
    }
  }

  let otherDomains: string[] = [];
  let existingTitles: string[] = [];
  if (params.userId) {
    const profiles = await db()
      .select({ companionDomain: kdpPenProfile.companionDomain })
      .from(kdpPenProfile)
      .where(eq(kdpPenProfile.userId, params.userId));
    otherDomains = profiles
      .map((p: any) => p.companionDomain)
      .filter(
        (d: string) =>
          Boolean(d) &&
          normalizeHost(d) !== normalizeHost(params.companionDomain || '')
      );

    const projects = await db()
      .select({ id: kdpProject.id, title: kdpProject.title })
      .from(kdpProject)
      .where(eq(kdpProject.userId, params.userId));
    existingTitles = projects
      .filter((p: any) => p.id !== params.projectId)
      .map((p: any) => p.title);
  }

  const boundedManuscript = params.manuscriptText
    ? params.manuscriptText.slice(0, 1_500_000)
    : undefined;

  const audit: GuardAuditResponse = await executeKdpGuardAudit({
    title: params.title,
    subtitle: params.subtitle,
    description: params.description,
    author_name: params.authorName,
    primary_category: params.primaryCategory,
    manuscript_text: boundedManuscript,
    epub_base64: params.epubBase64,
    companion_domain: params.companionDomain,
    other_pen_domains: otherDomains,
    existing_pen_titles: existingTitles,
    mode: params.mode || 'dual',
    lang: params.lang || 'en',
    check_live_collisions: params.checkLiveCollisions ?? true,
    enforce_min_words: Boolean(params.projectId),
  });

  const [report] = await db()
    .insert(kdpGuardReport)
    .values({
      id: getUuid(),
      projectId: params.projectId || null,
      userId: params.userId || null,
      clientIpHash: ipHash,
      mode: audit.mode,
      sourceType: params.epubBase64
        ? 'epub'
        : params.projectId
          ? 'project'
          : 'text',
      inputTitle: params.title || '',
      inputSubtitle: params.subtitle || '',
      passed: audit.passed,
      score: audit.score,
      errorsJson: JSON.stringify(audit.errors),
      warningsJson: JSON.stringify(audit.warnings),
      collisionJson: JSON.stringify(audit.collisions),
    })
    .returning();

  return { report, audit };
}

export async function sanitizeTextWithCredits(params: {
  userId: string;
  rawText: string;
  mode?: 'ebook' | 'paperback' | 'dual';
}) {
  const boundedText = params.rawText.trim().slice(0, 120_000);
  if (!boundedText) {
    throw new Error('raw_text is required');
  }

  const preAudit = await executeKdpGuardAudit({
    manuscript_text: boundedText,
    mode: params.mode || 'dual',
    check_live_collisions: false,
    enforce_min_words: false,
  });

  let consumedCreditId = '';
  if (KDP_CREDIT_COSTS.AUTO_SANITIZE > 0) {
    const res = await consume({
      userId: params.userId,
      credits: KDP_CREDIT_COSTS.AUTO_SANITIZE,
      scene: 'kdp_auto_sanitize',
      description: 'PublishGuard AI Compliance Sanitize',
    });
    if (!res.success) {
      throw new Error(
        'Insufficient credits for AI Auto-Sanitize (requires 15 credits)'
      );
    }
    consumedCreditId = res.consumedCredit?.id || '';
  }

  try {
    const out = await autoSanitizeViaPython({
      raw_text: boundedText,
      findings: preAudit.errors,
    });
    const postAudit = await executeKdpGuardAudit({
      manuscript_text: out.sanitized_text,
      mode: params.mode || 'dual',
      check_live_collisions: false,
      enforce_min_words: false,
    });
    return {
      sanitizedText: out.sanitized_text,
      beforeScore: preAudit.score,
      afterScore: postAudit.score,
      remainingErrors: postAudit.errors,
    };
  } catch (err) {
    if (consumedCreditId) {
      await revoke(consumedCreditId);
    }
    throw err;
  }
}

// ─── 3. 三步造书工作台项目与任务编排 ─────────────────────────────────────────

export async function listUserProjects(userId: string) {
  return db()
    .select()
    .from(kdpProject)
    .where(eq(kdpProject.userId, userId))
    .orderBy(desc(kdpProject.createdAt));
}

async function findOwnedPenProfile(userId: string, penProfileId: string) {
  const [profile] = await db()
    .select()
    .from(kdpPenProfile)
    .where(
      and(eq(kdpPenProfile.id, penProfileId), eq(kdpPenProfile.userId, userId))
    )
    .limit(1);
  return profile || null;
}

export async function getProjectDetail(userId: string, projectId: string) {
  const [project] = await db()
    .select()
    .from(kdpProject)
    .where(and(eq(kdpProject.id, projectId), eq(kdpProject.userId, userId)))
    .limit(1);

  if (!project) return null;

  const chapters = await db()
    .select()
    .from(kdpChapter)
    .where(eq(kdpChapter.projectId, projectId))
    .orderBy(kdpChapter.chapterIndex);

  const jobs = await db()
    .select()
    .from(kdpJob)
    .where(eq(kdpJob.projectId, projectId))
    .orderBy(desc(kdpJob.createdAt))
    .limit(10);

  let penProfile = null;
  if (project.penProfileId) {
    penProfile = await findOwnedPenProfile(userId, project.penProfileId);
  }

  let compiledSnapshot: Record<string, any> | null = null;
  if (project.compiledSnapshotJson && project.compiledSnapshotJson !== '{}') {
    try {
      const parsed = JSON.parse(project.compiledSnapshotJson);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Object.keys(parsed).length > 0
      ) {
        compiledSnapshot = parsed;
      }
    } catch {
      compiledSnapshot = null;
    }
  }

  return {
    project,
    chapters,
    latestJob: jobs[0] || null,
    latestSucceededJob: jobs.find((j: any) => j.status === 'succeeded') || null,
    compiledSnapshot,
    penProfile,
  };
}

/**
 * 安全删除 KDP 项目：
 * 1. 若存在未过期的活跃 processing 任务，禁止删除（防止 Worker 与删除并发冲突）；
 * 2. 若存在 queued 或租约已过期的 processing 任务，在同一事务内取消任务并退还已扣积分；
 * 3. 删除项目记录，并在事务提交后清理磁盘交付产物目录。
 */
export async function deleteProjectSafely(userId: string, projectId: string) {
  const result = await db().transaction(async (tx: any) => {
    const [project] = await tx
      .select()
      .from(kdpProject)
      .where(and(eq(kdpProject.id, projectId), eq(kdpProject.userId, userId)))
      .limit(1);

    if (!project) {
      throw new Error('Project not found');
    }

    const jobs = await tx
      .select()
      .from(kdpJob)
      .where(eq(kdpJob.projectId, projectId));

    const nowMs = Date.now();
    for (const job of jobs) {
      if (job.status === 'processing') {
        const leaseMs = job.leaseUntil ? new Date(job.leaseUntil).getTime() : 0;
        if (!leaseMs || leaseMs > nowMs) {
          throw new Error(
            'PROJECT_GENERATING_CANNOT_DELETE: Cannot delete project while Worker is actively generating it.'
          );
        }
      }
    }

    let refundedCredits = 0;
    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'processing') continue;
      const [canceled] = await tx
        .update(kdpJob)
        .set({
          status: 'canceled',
          error: 'Canceled when project was deleted',
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(kdpJob.id, job.id),
            inArray(kdpJob.status, ['queued', 'processing'])
          )
        )
        .returning();

      if (canceled && canceled.creditId) {
        const revoked = await revoke(canceled.creditId, tx);
        if (revoked) {
          refundedCredits += canceled.costCredits || 0;
        }
      }
    }

    await tx
      .delete(kdpProject)
      .where(and(eq(kdpProject.id, projectId), eq(kdpProject.userId, userId)));

    return { deleted: true, projectId, refundedCredits };
  });

  // 事务提交后再清理产物目录（避免回滚时误删已有文件）
  await rm(resolve(getArtifactsRoot(), projectId), {
    recursive: true,
    force: true,
  }).catch(() => {});

  return result;
}

export async function createProjectAndOutline(params: {
  userId: string;
  penProfileId?: string;
  title?: string;
  subtitle?: string;
  genre: string;
  topicPrompt: string;
  targetAudience?: string;
  companionProduct?: string;
  companionUrl?: string;
  trimSize?: string;
  targetPageCount?: number;
  paperType?: string;
  coverTheme?: string;
  language?: string;
}) {
  // 校验或自动选定默认作者笔名（显式传入非本人笔名时物理拒绝）
  let profile = null;
  if (params.penProfileId) {
    profile = await findOwnedPenProfile(params.userId, params.penProfileId);
    if (!profile) {
      throw new Error('Pen profile not found or access denied');
    }
  }
  const penName = profile?.fullName || 'Evelyn Vance';

  // 若用户在创建新项目时消耗大纲积分（支持用注册送的 30 试玩积分完成立项 + 洗稿）
  let creditId = '';
  const cost = KDP_CREDIT_COSTS.GENERATE_OUTLINE;
  if (cost > 0) {
    const res = await consume({
      userId: params.userId,
      credits: cost,
      scene: 'kdp_outline',
      description: `Generate KDP Outline (${params.topicPrompt.slice(0, 40)})`,
    });
    if (!res.success) {
      throw new Error(
        `Insufficient credits: generating a compliant blueprint requires ${cost} credits.`
      );
    }
    creditId = res.consumedCredit?.id || '';
  }

  try {
    const outline = await generateBookOutlineViaPython({
      topic: params.topicPrompt,
      audience: params.targetAudience || '',
      pen_name: penName,
      genre: params.genre || 'Self-Help',
      companion_product: params.companionProduct || '',
      language: params.language || 'en',
    });

    const chosenTitle =
      params.title?.trim() || outline.title_options[0] || 'Untitled Monograph';
    const chosenSub =
      params.subtitle?.trim() || outline.recommended_subtitle || '';

    // 先跑一次立项撞车审计
    const initialGuard = await executeKdpGuardAudit({
      title: chosenTitle,
      subtitle: chosenSub,
      description: outline.back_blurb,
      author_name: penName,
      primary_category: outline.primary_category,
      companion_domain: params.companionUrl || profile?.companionDomain || '',
      mode: 'dual',
      check_live_collisions: true,
      enforce_min_words: false,
    });

    const projectId = getUuid();
    const metadataJson = JSON.stringify({
      title_options: outline.title_options,
      subcategory_hint: outline.subcategory_hint,
      back_blurb: outline.back_blurb,
      keywords: outline.keywords,
      initial_collisions: initialGuard.collisions,
    });

    const [project] = await db()
      .insert(kdpProject)
      .values({
        id: projectId,
        userId: params.userId,
        penProfileId: profile?.id || null,
        title: chosenTitle,
        subtitle: chosenSub,
        genre: outline.primary_category,
        topicPrompt: params.topicPrompt,
        targetAudience: params.targetAudience || '',
        companionProduct: params.companionProduct || '',
        companionUrl: params.companionUrl || profile?.companionDomain || '',
        targetWordCount: 19000,
        trimSize: params.trimSize || '6x9',
        targetPageCount: params.targetPageCount || 100,
        paperType: params.paperType || 'cream',
        coverTheme: params.coverTheme || 'editorial_split',
        language: params.language || 'en',
        status: 'outline_ready',
        guardPassed: initialGuard.passed,
        guardScore: initialGuard.score,
        metadataJson,
      })
      .returning();

    const chapterValues = outline.chapters.map((ch, i) => ({
      id: getUuid(),
      projectId,
      userId: params.userId,
      chapterIndex: ch.chapter_index ?? i,
      sectionType: ch.section_type || 'chapter',
      title: ch.title,
      slug: ch.slug || `sec-${i}`,
      summary: ch.summary || '',
      contentHtml: '',
      wordCount: 0,
      status: 'outlined',
    }));

    if (chapterValues.length > 0) {
      await db().insert(kdpChapter).values(chapterValues);
    }

    return { project, chapters: chapterValues, initialGuard };
  } catch (err) {
    if (creditId) await revoke(creditId);
    throw err;
  }
}

export async function generateFirstChapterFreePreview(
  userId: string,
  projectId: string
) {
  const detail = await getProjectDetail(userId, projectId);
  if (!detail) throw new Error('Project not found');

  const { project, chapters } = detail;
  const targetChapter =
    chapters.find((c: any) => c.sectionType === 'chapter') || chapters[0];
  if (!targetChapter) throw new Error('No chapter available in outline');

  // 已试读或已生成的项目直接复用第 1 章正文，避免重复扣费或覆盖 ready 状态
  if (
    targetChapter.contentHtml &&
    targetChapter.contentHtml.trim().length > 0
  ) {
    return {
      chapterId: targetChapter.id,
      contentHtml: targetChapter.contentHtml,
      wordCount: targetChapter.wordCount || 0,
      reused: true,
    };
  }

  const out = await generateChapterPreviewViaPython({
    book_title: project.title,
    subtitle: project.subtitle,
    chapter_title: targetChapter.title,
    chapter_summary: targetChapter.summary,
    section_type: targetChapter.sectionType,
    prev_summaries: [],
    companion_product: project.companionProduct,
    target_words: 1550,
  });

  const safeHtml = sanitizeChapterHtml(out.content_html);
  const plain = safeHtml.replace(/<[^>]+>/g, ' ').trim();
  const wordCount = plain ? plain.split(/\s+/).length : 0;

  await db()
    .update(kdpChapter)
    .set({
      contentHtml: safeHtml,
      wordCount,
      status: 'previewed',
      updatedAt: new Date(),
    })
    .where(eq(kdpChapter.id, targetChapter.id));

  // 已完成出包的项目仅更新章节，绝不将 ready 状态降级为 preview_ready
  if (project.status !== 'ready') {
    await db()
      .update(kdpProject)
      .set({
        status: 'preview_ready',
        updatedAt: new Date(),
      })
      .where(eq(kdpProject.id, projectId));
  }

  return {
    chapterId: targetChapter.id,
    contentHtml: safeHtml,
    wordCount,
    reused: false,
  };
}

function isUniqueJobConstraintError(error: any): boolean {
  const code = error?.code || error?.cause?.code || '';
  if (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE'
  ) {
    return true;
  }
  const message = String(error?.message || error?.cause?.message || '');
  return (
    message.includes('uidx_kdp_job_active_project') ||
    message.includes('UNIQUE constraint failed') ||
    message.includes('duplicate key value obeys unique constraint')
  );
}

async function enqueueBookJob(
  userId: string,
  projectId: string,
  jobType: 'generate_book' | 'recompile_bundle'
) {
  const detail = await getProjectDetail(userId, projectId);
  if (!detail) throw new Error('Project not found');
  if (
    detail.project.status === 'generating' ||
    detail.project.status === 'queued'
  ) {
    throw new Error('A generation job is already in progress for this project');
  }

  // 快速重打包（10 积分）严禁在尚未产出全书正文时调用，防止绕过 100 积分全书生成费用
  if (jobType === 'recompile_bundle') {
    const hasFullManuscript =
      detail.chapters.length > 0 &&
      detail.chapters.every(
        (ch: any) => (ch.contentHtml || '').trim().length > 0
      );
    if (!hasFullManuscript) {
      throw new Error(
        'Cannot quick-recompile before the full manuscript has been generated. Run Full Book Generation first.'
      );
    }
  }

  const cost =
    jobType === 'recompile_bundle'
      ? KDP_CREDIT_COSTS.RECOMPILE_BUNDLE
      : KDP_CREDIT_COSTS.GENERATE_FULL_BOOK_BUNDLE;

  // Publishing Studio 订阅用户享有最高优先渲染权重
  const activeSub = await getCurrentSubscription(userId);
  const subTag =
    `${activeSub?.productId || ''} ${activeSub?.planName || ''}`.toLowerCase();
  const queuePriority = subTag.includes('studio') ? 100 : 0;

  try {
    return await db().transaction(async (tx: any) => {
      // 1. 先原子抢占项目队列锁，防止并发请求重复扣分入队
      const [claimedProject] = await tx
        .update(kdpProject)
        .set({
          status: 'queued',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kdpProject.id, projectId),
            eq(kdpProject.userId, userId),
            ne(kdpProject.status, 'queued'),
            ne(kdpProject.status, 'generating')
          )
        )
        .returning();

      if (!claimedProject) {
        throw new Error(
          'A generation job is already in progress for this project'
        );
      }

      // 2. 在同一事务内扣除积分（余额不足时事务自动回滚项目状态）
      const consumeRes = await consume({
        userId,
        credits: cost,
        scene:
          jobType === 'recompile_bundle' ? 'kdp_recompile' : 'kdp_full_book',
        description:
          jobType === 'recompile_bundle'
            ? `Recompile KDP Bundle: ${detail.project.title}`
            : `Compile Dual-Format KDP Bundle: ${detail.project.title}`,
        tx,
      });
      if (!consumeRes.success) {
        const currentBalance = consumeRes.balance ?? 0;
        throw new Error(
          `INSUFFICIENT_CREDITS: Generating full 18k+ word dual-format EPUB + Print PDF bundle requires ${cost} credits (your balance: ${currentBalance}).`
        );
      }

      // 3. 写入任务记录（受数据库 partial unique index uidx_kdp_job_active_project 兜底）
      const jobId = getUuid();
      const [job] = await tx
        .insert(kdpJob)
        .values({
          id: jobId,
          projectId,
          userId,
          jobType,
          status: 'queued',
          progressPct: 0,
          currentStep: 'queued_for_worker',
          costCredits: cost,
          creditId: consumeRes.consumedCredit?.id || '',
          payloadJson: JSON.stringify({
            priority: queuePriority,
            coverTheme: detail.project.coverTheme,
            trimSize: detail.project.trimSize,
            targetPageCount: detail.project.targetPageCount,
            paperType: detail.project.paperType,
          }),
        })
        .returning();

      return job;
    });
  } catch (err) {
    if (isUniqueJobConstraintError(err)) {
      throw new Error(
        'A generation job is already in progress for this project'
      );
    }
    throw err;
  }
}

export async function enqueueFullBookGeneration(
  userId: string,
  projectId: string
) {
  return enqueueBookJob(userId, projectId, 'generate_book');
}

export async function enqueueBundleRecompile(
  userId: string,
  projectId: string
) {
  return enqueueBookJob(userId, projectId, 'recompile_bundle');
}

const ALLOWED_TRIM_SIZES = new Set(['6x9', '5.5x8.5', '8.5x11']);
const ALLOWED_PAPER_TYPES = new Set(['cream', 'white']);
const ALLOWED_COVER_THEMES = new Set<string>(KDP_COVER_THEMES.map((t) => t.id));

export async function updateProjectSettings(
  userId: string,
  projectId: string,
  patch: Partial<{
    title: string;
    subtitle: string;
    genre: string;
    coverTheme: string;
    trimSize: string;
    targetPageCount: number;
    paperType: string;
    companionUrl: string;
    penProfileId: string | null;
  }>
) {
  const [existing] = await db()
    .select()
    .from(kdpProject)
    .where(and(eq(kdpProject.id, projectId), eq(kdpProject.userId, userId)))
    .limit(1);
  if (!existing) throw new Error('Project not found');

  if (existing.status === 'queued' || existing.status === 'generating') {
    throw new Error(
      'Cannot modify project settings while a build job is queued or running'
    );
  }

  const nextPatch = { ...patch };
  if (
    nextPatch.trimSize !== undefined &&
    !ALLOWED_TRIM_SIZES.has(nextPatch.trimSize)
  ) {
    throw new Error('Invalid trim size');
  }
  if (
    nextPatch.paperType !== undefined &&
    !ALLOWED_PAPER_TYPES.has(nextPatch.paperType)
  ) {
    throw new Error('Invalid paper type');
  }
  if (
    nextPatch.coverTheme !== undefined &&
    !ALLOWED_COVER_THEMES.has(nextPatch.coverTheme)
  ) {
    throw new Error('Invalid cover theme');
  }
  if (nextPatch.targetPageCount !== undefined) {
    const pages = Math.round(Number(nextPatch.targetPageCount));
    if (!Number.isFinite(pages) || pages < 40 || pages > 600) {
      throw new Error('Target page count must be between 40 and 600');
    }
    nextPatch.targetPageCount = pages;
  }

  // 严禁跨用户绑定或读取他人 penProfileId（IDOR 防护）
  if (nextPatch.penProfileId !== undefined) {
    const cleanProfileId =
      typeof nextPatch.penProfileId === 'string'
        ? nextPatch.penProfileId.trim()
        : '';
    if (!cleanProfileId) {
      nextPatch.penProfileId = null;
    } else {
      const ownedProfile = await findOwnedPenProfile(userId, cleanProfileId);
      if (!ownedProfile) {
        throw new Error('Pen profile not found or access denied');
      }
      nextPatch.penProfileId = ownedProfile.id;
    }
  }

  const [updated] = await db()
    .update(kdpProject)
    .set({
      ...nextPatch,
      updatedAt: new Date(),
    })
    .where(and(eq(kdpProject.id, projectId), eq(kdpProject.userId, userId)))
    .returning();

  return updated;
}

export function getArtifactsRoot(): string {
  return envConfigs.kdp_artifacts_dir || 'data/kdp-artifacts';
}
