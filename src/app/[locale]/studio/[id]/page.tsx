'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { KDP_COVER_THEMES } from '@/modules/kdp/constants';
import { sanitizeChapterHtml } from '@/lib/html-sanitizer';
import { cn } from '@/lib/utils';
import { KdpCoverThumbnail } from '@/components/kdp-cover-thumbnail';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function StudioProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const t = useTranslations('studio.studio');

  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [recompiling, setRecompiling] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/kdp/projects/${projectId}`, {
      cache: 'no-store',
    });
    const json = await res.json();
    if (json.code === 0) {
      setDetail(json.data);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // 任务处于排队或处理中时每 3 秒自动轮询实时进度
  useEffect(() => {
    const status = detail?.project?.status;
    const jobStatus = detail?.latestJob?.status;
    if (
      status === 'queued' ||
      status === 'generating' ||
      jobStatus === 'queued' ||
      jobStatus === 'processing'
    ) {
      const timer = setInterval(loadDetail, 3000);
      return () => clearInterval(timer);
    }
  }, [detail?.project?.status, detail?.latestJob?.status, loadDetail]);

  async function handlePreviewChapter1() {
    setPreviewing(true);
    try {
      const res = await fetch(
        `/api/kdp/projects/${projectId}/preview-chapter`,
        {
          method: 'POST',
        }
      );
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message);
      toast.success('Chapter 1 free preview generated!');
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Preview generation failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleThemeChange(themeId: string) {
    try {
      const res = await fetch(`/api/kdp/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_theme: themeId }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Failed to update cover theme');
      }
      toast.success(t('toast_theme_updated'));
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update cover theme');
    }
  }

  async function handleTitleSelect(newTitle: string) {
    try {
      const res = await fetch(`/api/kdp/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Failed to update book title');
      }
      toast.success(t('toast_title_updated'));
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update book title');
    }
  }

  async function handleCompileManuscript() {
    setCompiling(true);
    try {
      const res = await fetch(
        `/api/kdp/projects/${projectId}/compile-manuscript`,
        {
          method: 'POST',
        }
      );
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message);
      toast.success(
        'Manuscript compilation enqueued! Building EPUB 3 & Print PDFs...'
      );
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Insufficient credits or enqueue error');
    } finally {
      setCompiling(false);
    }
  }

  async function handleCompileFullBook() {
    setCompiling(true);
    try {
      const res = await fetch(`/api/kdp/projects/${projectId}/generate`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message);
      toast.success('Book compilation job enqueued! Tracking live progress...');
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Insufficient credits or enqueue error');
    } finally {
      setCompiling(false);
    }
  }

  async function handleQuickRecompile() {
    setRecompiling(true);
    try {
      const res = await fetch(`/api/kdp/projects/${projectId}/recompile`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.code !== 0) throw new Error(json.message);
      toast.success(t('toast_recompile_enqueued'));
      await loadDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Quick recompile failed');
    } finally {
      setRecompiling(false);
    }
  }

  function copyValue(key: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    toast.success(t('copied'));
    setTimeout(() => setCopiedKey(''), 1500);
  }

  if (loading || !detail) {
    return (
      <div className="text-muted-foreground p-8 text-center text-sm">
        Loading Book Studio workspace...
      </div>
    );
  }

  const {
    project,
    chapters,
    latestJob,
    latestSucceededJob,
    compiledSnapshot,
    penProfile,
    credits,
  } = detail;
  const meta = JSON.parse(project.metadataJson || '{}');
  let succeededResult: Record<string, any> = {};
  try {
    succeededResult = JSON.parse(latestSucceededJob?.resultJson || '{}');
  } catch {
    succeededResult = {};
  }
  const activeSnapshot: Record<string, any> | null =
    compiledSnapshot || succeededResult?.compiled_snapshot || null;

  const isImportedManuscript = meta.source_mode === 'imported_manuscript';
  const requiredCompileCredits = isImportedManuscript ? 60 : 100;
  const resolvedDisplayAuthor =
    penProfile?.fullName || meta.author_name_override || 'Evelyn Vance';
  const initialGuardErrors: any[] = Array.isArray(meta.initial_guard_errors)
    ? meta.initial_guard_errors
    : [];

  const titleOptions: string[] = meta.title_options || [project.title];
  const keywords: string[] = meta.keywords || [];
  const previewChapter = chapters.find((c: any) => Boolean(c.contentHtml));
  const hasFullManuscript =
    chapters.length > 0 &&
    chapters.every((c: any) => Boolean((c.contentHtml || '').trim()));

  const isWorking =
    project.status === 'queued' ||
    project.status === 'generating' ||
    latestJob?.status === 'queued' ||
    latestJob?.status === 'processing';
  const hasDeliverables = Boolean(project.bundleZipKey);
  const isReady = hasDeliverables && project.status === 'ready';

  // 若已导出交付包后又修改了书名、副标题、封面或规格，显式提示需要 10 积分快速重打包同步新资产
  const isSnapshotStale =
    Boolean(hasDeliverables && activeSnapshot) &&
    (activeSnapshot?.title !== project.title ||
      (activeSnapshot?.subtitle || '') !== (project.subtitle || '') ||
      activeSnapshot?.cover_theme !== project.coverTheme ||
      activeSnapshot?.trim_size !== project.trimSize ||
      activeSnapshot?.paper_type !== project.paperType ||
      Number(activeSnapshot?.target_page_count || project.targetPageCount) !==
        Number(project.targetPageCount));

  // 严格区分“当前草稿预估规格”与“已导出成品绑定快照规格”，避免误导作者上传 KDP 封面错位
  const draftPageThickness = project.paperType === 'white' ? 0.002252 : 0.0025;
  const draftSpineIn = (project.targetPageCount * draftPageThickness).toFixed(
    4
  );
  const [draftTrimW, draftTrimH] =
    project.trimSize === '5.5x8.5'
      ? [5.5, 8.5]
      : project.trimSize === '8.5x11'
        ? [8.5, 11.0]
        : [6.0, 9.0];
  const draftWrapW = (
    0.125 +
    draftTrimW +
    Number(draftSpineIn) +
    draftTrimW +
    0.125
  ).toFixed(4);
  const draftWrapH = (0.125 + draftTrimH + 0.125).toFixed(4);

  const exportedTitle = activeSnapshot?.title || project.title;
  const exportedCoverTheme = activeSnapshot?.cover_theme || project.coverTheme;
  const exportedTrimSize = activeSnapshot?.trim_size || project.trimSize;
  const exportedPaperType = activeSnapshot?.paper_type || project.paperType;
  const exportedPages = Number(
    activeSnapshot?.actual_pages ||
      succeededResult?.actual_pages ||
      project.targetPageCount
  );
  const exportedThickness = exportedPaperType === 'white' ? 0.002252 : 0.0025;
  const exportedSpineIn = activeSnapshot?.spine_width_in
    ? Number(activeSnapshot.spine_width_in).toFixed(4)
    : succeededResult?.spine_width_in
      ? Number(succeededResult.spine_width_in).toFixed(4)
      : (exportedPages * exportedThickness).toFixed(4);
  const [expTrimW, expTrimH] =
    exportedTrimSize === '5.5x8.5'
      ? [5.5, 8.5]
      : exportedTrimSize === '8.5x11'
        ? [8.5, 11.0]
        : [6.0, 9.0];
  const exportedWrapW = (
    0.125 +
    expTrimW +
    Number(exportedSpineIn) +
    expTrimW +
    0.125
  ).toFixed(4);
  const exportedWrapH = (0.125 + expTrimH + 0.125).toFixed(4);
  const exportedGuardPassed = Boolean(
    activeSnapshot?.guard_passed ?? project.guardPassed
  );
  const exportedGuardScore = Number(
    activeSnapshot?.guard_score ?? project.guardScore ?? 0
  );
  const exportedWordCount = Number(
    activeSnapshot?.actual_word_count ?? project.actualWordCount ?? 0
  );
  const bundleCacheTag = encodeURIComponent(
    String(activeSnapshot?.compiled_at || project.updatedAt || '1')
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* 顶部标题与积分条 */}
      <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="bg-muted rounded px-2 py-0.5 font-mono uppercase">
              {project.status}
            </span>
            {isImportedManuscript && (
              <span className="rounded bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                {t('badge_imported')}
              </span>
            )}
            <span className="text-muted-foreground">
              {isReady && !isSnapshotStale
                ? `${exportedTrimSize}" · ${exportedPages} actual pp ${exportedPaperType} · Spine ${exportedSpineIn}" (Wrap ${exportedWrapW}" × ${exportedWrapH}")`
                : project.targetPageCount === 0
                  ? `Draft ${project.trimSize}" · Auto Natural Flow (${meta.estimated_pages ? `Est. ~${meta.estimated_pages} pp` : 'Standard 10.5pt Print'}) · ${project.paperType}`
                  : `Draft ${project.trimSize}" · ${project.targetPageCount} target pp ${project.paperType} · Est. Spine ${draftSpineIn}" (Wrap ${draftWrapW}" × ${draftWrapH}")`}
            </span>
          </div>
          <h1 className="mt-2 font-serif text-2xl font-medium tracking-tight sm:text-3xl">
            {project.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {project.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="bg-muted/60 rounded-lg px-3 py-1.5 text-xs">
            Credits: <strong>{credits}</strong>
          </div>
          {credits < requiredCompileCredits && !isReady && (
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              {isImportedManuscript
                ? 'Get Format Pass ($19)'
                : 'Get Pass ($29)'}
            </Link>
          )}
        </div>
      </div>

      {/* 备选防撞车标题与封面切换区 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Anti-Collision Title Selection &amp; Cover Style
            </CardTitle>
            <CardDescription className="text-xs">
              Pick your preferred title option and non-homogenized cover
              skeleton.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium">Title Candidates</div>
              {titleOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={isWorking || compiling || recompiling}
                  onClick={() => handleTitleSelect(opt)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    project.title === opt
                      ? 'border-primary bg-primary/5 font-semibold'
                      : 'border-border hover:bg-muted/40'
                  )}
                >
                  <span>{opt}</span>
                  {project.title === opt && <Check className="size-3.5" />}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium">Cover Architecture</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {KDP_COVER_THEMES.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    disabled={isWorking || compiling || recompiling}
                    onClick={() => handleThemeChange(th.id)}
                    className={cn(
                      'rounded-lg border p-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      project.coverTheme === th.id
                        ? 'border-primary ring-primary/20 ring-2'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <KdpCoverThumbnail
                      themeId={th.id}
                      title={project.title}
                      authorName={resolvedDisplayAuthor}
                      editionLabel={
                        penProfile?.editionLabel || 'INDEPENDENT EDITION'
                      }
                      className="mb-2"
                    />
                    <div className="leading-tight font-medium">{th.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 2 & 3 核心生成与排版控制面板 */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base">
              Production Pipeline &amp; 26-Rule Audit
            </CardTitle>
            <CardDescription className="text-xs">
              {isImportedManuscript
                ? 'Compile your imported manuscript verbatim into Kindle EPUB 3, even-page Print PDF, Cover Wrap, and KDP checklist (60 credits / $19 Format Pass).'
                : 'Preview Chapter 1 free before committing 100 credits to compile your complete 18k+ word eBook + 6×9 Print PDF bundle.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isWorking && (
              <div className="bg-muted/50 space-y-2 rounded-xl border p-4 text-xs">
                <div className="flex items-center justify-between font-medium">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Step: {latestJob?.currentStep || 'processing'}
                  </span>
                  <span>{latestJob?.progressPct ?? 5}%</span>
                </div>
                <div className="bg-background h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all duration-500"
                    style={{ width: `${latestJob?.progressPct ?? 5}%` }}
                  />
                </div>
              </div>
            )}

            {!isWorking &&
              isImportedManuscript &&
              !project.guardPassed &&
              initialGuardErrors.length > 0 && (
                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <ShieldAlert className="size-4 shrink-0" />
                      Initial Guard Alert ({project.guardScore}/100 ·{' '}
                      {initialGuardErrors.length} blocking findings)
                    </span>
                    <Link
                      href="/tools/kdp-guard"
                      className="underline underline-offset-4"
                    >
                      Clean in KDP Guard →
                    </Link>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-[11px] opacity-90">
                    {initialGuardErrors.slice(0, 3).map((ge, idx) => (
                      <li key={idx}>
                        <span className="font-mono font-semibold">
                          {ge.code}
                        </span>
                        {ge.matched_text ? ` (${ge.matched_text})` : ''}:{' '}
                        {ge.suggestion || ge.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {!isWorking && latestJob?.status === 'failed' && (
              <div className="space-y-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-900 dark:text-rose-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="size-4 shrink-0" />
                  {t('failed_refund_title')}
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  {latestJob.error || t('failed_refund_desc')}
                </p>
              </div>
            )}

            {hasDeliverables && isSnapshotStale && !isWorking && (
              <div className="space-y-2.5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-4 shrink-0" />
                  {t('snapshot_stale_title')}
                </div>
                <p className="text-[11px] leading-relaxed">
                  {t('snapshot_stale_desc')}
                </p>
                {hasFullManuscript && credits >= 10 && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleQuickRecompile}
                    disabled={recompiling || compiling}
                    className="gap-1.5"
                  >
                    {recompiling ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {t('btn_quick_recompile')}
                  </Button>
                )}
              </div>
            )}

            {hasDeliverables && (
              <div
                className={cn(
                  'space-y-3 rounded-xl border p-4 text-xs',
                  exportedGuardPassed
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-amber-500/50 bg-amber-500/10'
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-between font-semibold',
                    exportedGuardPassed
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-amber-800 dark:text-amber-300'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {exportedGuardPassed ? (
                      <ShieldCheck className="size-4" />
                    ) : (
                      <ShieldAlert className="size-4" />
                    )}
                    {exportedGuardPassed
                      ? `26-Rule Pre-Flight Guard Passed (${exportedGuardScore}/100)`
                      : `Compiled with Guard Alerts (${exportedGuardScore}/100) — Review Before Upload`}
                  </span>
                  <span>{exportedWordCount.toLocaleString()} words</span>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Exported snapshot: <strong>{exportedTitle}</strong> (
                  {exportedCoverTheme}) · EPUB 3 + {exportedTrimSize}&quot;
                  Print PDF (<strong>{exportedPages} actual pages</strong>,
                  Spine <strong>{exportedSpineIn}&quot;</strong>, Full Wrap{' '}
                  <strong>
                    {exportedWrapW}&quot;×{exportedWrapH}&quot;
                  </strong>
                  ). Open EPUB in Amazon Kindle Previewer and inspect Print PDF
                  &amp; Cover Wrap in KDP Print Previewer before publishing.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=bundle&v=${bundleCacheTag}`}
                    className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
                  >
                    <Download className="size-3.5" />
                    {t('btn_download_zip')}
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=epub&v=${bundleCacheTag}`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' })
                    )}
                  >
                    EPUB 3
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=interior&v=${bundleCacheTag}`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' })
                    )}
                  >
                    Interior PDF
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=cover_wrap&v=${bundleCacheTag}`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' })
                    )}
                  >
                    Wrap Cover PDF
                  </a>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              {!isImportedManuscript && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePreviewChapter1}
                  disabled={previewing || isWorking}
                  className="gap-1.5"
                >
                  {previewing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  {t('btn_preview_ch1')}
                </Button>
              )}

              {hasDeliverables && hasFullManuscript && credits >= 10 && (
                <Button
                  type="button"
                  variant={isSnapshotStale ? 'default' : 'outline'}
                  onClick={handleQuickRecompile}
                  disabled={recompiling || compiling || isWorking}
                  className="gap-1.5"
                >
                  {recompiling ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {t('btn_quick_recompile')}
                </Button>
              )}

              {isImportedManuscript ? (
                credits >= 60 || isReady ? (
                  <Button
                    type="button"
                    variant={hasDeliverables ? 'outline' : 'default'}
                    onClick={handleCompileManuscript}
                    disabled={compiling || recompiling || isWorking}
                    className="gap-1.5"
                  >
                    {compiling ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Rocket className="size-4" />
                    )}
                    {t('btn_compile_imported')}
                  </Button>
                ) : (
                  <Link
                    href="/pricing"
                    className={cn(buttonVariants(), 'gap-1.5')}
                  >
                    <Lock className="size-4" />
                    {t('btn_unlock_format')}
                  </Link>
                )
              ) : credits >= 100 || isReady ? (
                <Button
                  type="button"
                  variant={hasFullManuscript ? 'outline' : 'default'}
                  onClick={handleCompileFullBook}
                  disabled={compiling || recompiling || isWorking}
                  className="gap-1.5"
                >
                  {compiling ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Rocket className="size-4" />
                  )}
                  {t('btn_generate_all')}
                </Button>
              ) : (
                <Link
                  href="/pricing"
                  className={cn(buttonVariants(), 'gap-1.5')}
                >
                  <Lock className="size-4" />
                  Unlock Export ($29 Single Pass)
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 结构化章节展示 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            {isImportedManuscript
              ? `Imported Manuscript Chapters (${chapters.length} sections · ${project.actualWordCount.toLocaleString()} words)`
              : '12-Section Non-Fiction Architecture'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {chapters.map((ch: any) => (
            <div
              key={ch.id}
              className="border-border bg-muted/20 rounded-xl border p-3.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{ch.title}</span>
                <span className="text-muted-foreground font-mono">
                  {ch.wordCount > 0 ? `${ch.wordCount}w` : ch.sectionType}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 leading-relaxed">
                {ch.summary}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 免费第一章试读预览区 */}
      {previewChapter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isImportedManuscript ? 'Chapter Preview: ' : 'Free Preview: '}
              {previewChapter.title} ({previewChapter.wordCount} words)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: sanitizeChapterHtml(previewChapter.contentHtml),
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* 一键复制 KDP 后台填表助手清单 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Amazon KDP One-Click Metadata Checklist
          </CardTitle>
          <CardDescription className="text-xs">
            Copy these pre-validated fields directly into KDP Bookshelf (100%
            author name parity &amp; character-safe limits).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {[
            ['Book Title', project.title],
            [
              `Subtitle (${project.subtitle.length} chars · Combined ${project.title.length + project.subtitle.length}/200)`,
              project.subtitle,
            ],
            ['Author Name (Exact Match)', resolvedDisplayAuthor],
            [
              'Primary KDP Category',
              `${project.genre} > ${meta.subcategory_hint || 'Personal Transformation'}`,
            ],
            ['7 Backend Keywords', keywords.join(' | ')],
            ['Clean Book Description', meta.back_blurb || ''],
            [
              'KDP AI-Generated Content Disclosure (Required)',
              isImportedManuscript
                ? 'Review required — confirm how the imported manuscript was created. Disclose any AI-generated text, images, or translations, including content you later edited. AI assistance alone does not require disclosure.'
                : 'Text: AI-generated (entire or edited) · Verify cover asset origin · Confirm in Kindle Previewer 3 & Print Previewer',
            ],
          ].map(([label, val]) => (
            <div
              key={label}
              className="border-border bg-muted/20 flex items-start justify-between gap-4 rounded-lg border p-3"
            >
              <div className="space-y-1">
                <div className="text-muted-foreground font-medium">{label}</div>
                <div className="font-mono break-words">{val}</div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyValue(label, val)}
                className="shrink-0 gap-1 text-xs"
              >
                <Copy className="size-3" />
                {copiedKey === label ? 'OK' : t('btn_copy')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
