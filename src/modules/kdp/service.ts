/**
 * PublishGuard KDP 核心业务服务层。
 * 遵循 ShipAny 模块规范：不直接处理 HTTP 请求，仅封装数据库事务、积分扣除与 Python 出版引擎编排。
 */

import { and, desc, eq, gte, ne } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import {
  kdpChapter,
  kdpGuardReport,
  kdpJob,
  kdpPenProfile,
  kdpProject,
} from '@/config/db/schema';
import { consume, getBalance, revoke } from '@/modules/credits/service';
import { getUuid, md5 } from '@/lib/hash';

import { KDP_CREDIT_COSTS, KDP_SAFE_CADENCE_DAYS } from './constants';
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

  const audit: GuardAuditResponse = await executeKdpGuardAudit({
    title: params.title,
    subtitle: params.subtitle,
    description: params.description,
    author_name: params.authorName,
    primary_category: params.primaryCategory,
    manuscript_text: params.manuscriptText,
    epub_base64: params.epubBase64,
    companion_domain: params.companionDomain,
    other_pen_domains: otherDomains,
    existing_pen_titles: existingTitles,
    mode: params.mode || 'dual',
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
  const preAudit = await executeKdpGuardAudit({
    manuscript_text: params.rawText,
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
      raw_text: params.rawText,
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
    .limit(5);

  let penProfile = null;
  if (project.penProfileId) {
    const [p] = await db()
      .select()
      .from(kdpPenProfile)
      .where(eq(kdpPenProfile.id, project.penProfileId))
      .limit(1);
    penProfile = p || null;
  }

  return {
    project,
    chapters,
    latestJob: jobs[0] || null,
    penProfile,
  };
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
  // 校验或自动选定默认作者笔名
  let profile = null;
  if (params.penProfileId) {
    const [p] = await db()
      .select()
      .from(kdpPenProfile)
      .where(
        and(
          eq(kdpPenProfile.id, params.penProfileId),
          eq(kdpPenProfile.userId, params.userId)
        )
      )
      .limit(1);
    profile = p || null;
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

  const plain = out.content_html.replace(/<[^>]+>/g, ' ').trim();
  const wordCount = plain ? plain.split(/\s+/).length : 0;

  await db()
    .update(kdpChapter)
    .set({
      contentHtml: out.content_html,
      wordCount,
      status: 'previewed',
      updatedAt: new Date(),
    })
    .where(eq(kdpChapter.id, targetChapter.id));

  await db()
    .update(kdpProject)
    .set({
      status: 'preview_ready',
      updatedAt: new Date(),
    })
    .where(eq(kdpProject.id, projectId));

  return {
    chapterId: targetChapter.id,
    contentHtml: out.content_html,
    wordCount,
  };
}

export async function enqueueFullBookGeneration(
  userId: string,
  projectId: string
) {
  const detail = await getProjectDetail(userId, projectId);
  if (!detail) throw new Error('Project not found');
  if (
    detail.project.status === 'generating' ||
    detail.project.status === 'queued'
  ) {
    throw new Error('A generation job is already in progress for this project');
  }

  const cost = KDP_CREDIT_COSTS.GENERATE_FULL_BOOK_BUNDLE;
  const balance = await getBalance(userId);
  if (balance < cost) {
    throw new Error(
      `INSUFFICIENT_CREDITS: Generating full 18k+ word dual-format EPUB + Print PDF bundle requires ${cost} credits (your balance: ${balance}).`
    );
  }

  return db().transaction(async (tx: any) => {
    const consumeRes = await consume({
      userId,
      credits: cost,
      scene: 'kdp_full_book',
      description: `Compile Dual-Format KDP Bundle: ${detail.project.title}`,
      tx,
    });
    if (!consumeRes.success) {
      throw new Error('INSUFFICIENT_CREDITS');
    }

    const jobId = getUuid();
    const [job] = await tx
      .insert(kdpJob)
      .values({
        id: jobId,
        projectId,
        userId,
        jobType: 'generate_book',
        status: 'queued',
        progressPct: 0,
        currentStep: 'queued_for_worker',
        costCredits: cost,
        creditId: consumeRes.consumedCredit?.id || '',
        payloadJson: JSON.stringify({
          coverTheme: detail.project.coverTheme,
          trimSize: detail.project.trimSize,
          targetPageCount: detail.project.targetPageCount,
          paperType: detail.project.paperType,
        }),
      })
      .returning();

    await tx
      .update(kdpProject)
      .set({
        status: 'queued',
        updatedAt: new Date(),
      })
      .where(eq(kdpProject.id, projectId));

    return job;
  });
}

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

  const [updated] = await db()
    .update(kdpProject)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(kdpProject.id, projectId))
    .returning();

  return updated;
}

export function getArtifactsRoot(): string {
  return envConfigs.kdp_artifacts_dir || 'data/kdp-artifacts';
}
