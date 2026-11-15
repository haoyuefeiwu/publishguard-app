'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Lock,
  Rocket,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { KDP_COVER_THEMES } from '@/modules/kdp/constants';
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
    const res = await fetch(`/api/kdp/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_theme: themeId }),
    });
    const json = await res.json();
    if (json.code === 0) {
      toast.success('Cover architecture updated');
      await loadDetail();
    }
  }

  async function handleTitleSelect(newTitle: string) {
    const res = await fetch(`/api/kdp/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    const json = await res.json();
    if (json.code === 0) {
      toast.success('Main title updated');
      await loadDetail();
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

  const { project, chapters, latestJob, penProfile, credits } = detail;
  const meta = JSON.parse(project.metadataJson || '{}');
  let jobResult: Record<string, any> = {};
  try {
    jobResult = JSON.parse(latestJob?.resultJson || '{}');
  } catch {
    jobResult = {};
  }
  const titleOptions: string[] = meta.title_options || [project.title];
  const keywords: string[] = meta.keywords || [];
  const previewChapter = chapters.find((c: any) => Boolean(c.contentHtml));
  const isWorking =
    project.status === 'queued' ||
    project.status === 'generating' ||
    latestJob?.status === 'queued' ||
    latestJob?.status === 'processing';
  const isReady = project.status === 'ready' && Boolean(project.bundleZipKey);

  // 实时书脊物理尺寸计算：编译完成后优先使用真实统计页数与实际书脊厚度
  const pageThickness = project.paperType === 'white' ? 0.002252 : 0.0025;
  const compiledPages = Number(jobResult.actual_pages || 0);
  const displayPages =
    isReady && compiledPages > 0 ? compiledPages : project.targetPageCount;
  const spineIn =
    isReady && jobResult.spine_width_in
      ? Number(jobResult.spine_width_in).toFixed(4)
      : (displayPages * pageThickness).toFixed(4);
  const [trimW, trimH] =
    project.trimSize === '5.5x8.5' ? [5.5, 8.5] : [6.0, 9.0];
  const wrapW = (0.125 + trimW + Number(spineIn) + trimW + 0.125).toFixed(4);
  const wrapH = (0.125 + trimH + 0.125).toFixed(4);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* 顶部标题与积分条 */}
      <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="bg-muted rounded px-2 py-0.5 font-mono uppercase">
              {project.status}
            </span>
            <span className="text-muted-foreground">
              {project.trimSize}&quot; ·{' '}
              {isReady && compiledPages > 0
                ? `${displayPages} actual pp`
                : `${displayPages} target pp`}{' '}
              {project.paperType} · Spine {spineIn}&quot; (Wrap {wrapW}&quot; ×{' '}
              {wrapH}&quot;)
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
          {credits < 100 && !isReady && (
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Get Pass ($29)
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
                  onClick={() => handleTitleSelect(opt)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors',
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
                    onClick={() => handleThemeChange(th.id)}
                    className={cn(
                      'rounded-lg border p-2 text-left text-xs transition-colors',
                      project.coverTheme === th.id
                        ? 'border-primary ring-primary/20 ring-2'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <KdpCoverThumbnail
                      themeId={th.id}
                      title={project.title}
                      authorName={penProfile?.fullName || 'Evelyn Vance'}
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

        {/* Step 2 & 3 核心生成控制面板 */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base">
              Production Pipeline &amp; 26-Rule Audit
            </CardTitle>
            <CardDescription className="text-xs">
              Preview Chapter 1 free before committing 100 credits to compile
              your complete 18k+ word eBook + 6×9 Print PDF bundle.
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

            {isReady && (
              <div
                className={cn(
                  'space-y-3 rounded-xl border p-4 text-xs',
                  project.guardPassed
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-amber-500/50 bg-amber-500/10'
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-between font-semibold',
                    project.guardPassed
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-amber-800 dark:text-amber-300'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {project.guardPassed ? (
                      <ShieldCheck className="size-4" />
                    ) : (
                      <ShieldAlert className="size-4" />
                    )}
                    {project.guardPassed
                      ? `26-Rule Pre-Flight Guard Passed (${project.guardScore}/100)`
                      : `Compiled with Guard Alerts (${project.guardScore}/100) — Review Before Upload`}
                  </span>
                  <span>{project.actualWordCount.toLocaleString()} words</span>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Deliverables ready: EPUB 3 + {project.trimSize}&quot; Print
                  PDF (<strong>{displayPages} actual pages</strong>, Spine{' '}
                  <strong>{spineIn}&quot;</strong>, Full Wrap{' '}
                  <strong>
                    {wrapW}&quot;×{wrapH}&quot;
                  </strong>
                  ). Open EPUB in Amazon Kindle Previewer and inspect Print PDF
                  &amp; Cover Wrap in KDP Print Previewer before publishing.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=bundle`}
                    className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
                  >
                    <Download className="size-3.5" />
                    {t('btn_download_zip')}
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=epub`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' })
                    )}
                  >
                    EPUB 3
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=interior`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' })
                    )}
                  >
                    Interior PDF
                  </a>
                  <a
                    href={`/api/kdp/projects/${project.id}/download?type=cover_wrap`}
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

              {credits >= 100 || isReady ? (
                <Button
                  type="button"
                  onClick={handleCompileFullBook}
                  disabled={compiling || isWorking}
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

      {/* 12 节结构化大纲展示 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            12-Section Non-Fiction Architecture
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
              Free Preview: {previewChapter.title} ({previewChapter.wordCount}{' '}
              words)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="prose prose-sm dark:prose-invert max-w-none leading-relaxed"
              dangerouslySetInnerHTML={{ __html: previewChapter.contentHtml }}
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
            [
              'Author Name (Exact Match)',
              penProfile?.fullName || 'Evelyn Vance',
            ],
            [
              'Primary KDP Category',
              `${project.genre} > ${meta.subcategory_hint || 'Personal Transformation'}`,
            ],
            ['7 Backend Keywords', keywords.join(' | ')],
            ['Clean Book Description', meta.back_blurb || ''],
            [
              'KDP AI-Generated Content Disclosure (Required)',
              'Text: AI-generated (entire or edited) · Verify cover asset origin · Confirm in Kindle Previewer 3 & Print Previewer',
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
