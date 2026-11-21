'use client';

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileUp,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRouter } from '@/core/i18n/navigation';
import {
  KDP_COVER_THEMES,
  KDP_PRIMARY_CATEGORIES,
} from '@/modules/kdp/constants';
import { cn } from '@/lib/utils';
import { KdpCoverThumbnail } from '@/components/kdp-cover-thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type StudioCreationMode = 'import' | 'generate';

const GUARD_DRAFT_STORAGE_KEY = 'pg_guard_workbench_draft_v1';

export default function NewBookProjectPage() {
  const t = useTranslations('studio.studio');
  const router = useRouter();

  const [creationMode, setCreationMode] =
    useState<StudioCreationMode>('generate');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [penProfileId, setPenProfileId] = useState('');

  // AI 从零写书表单状态
  const [topicPrompt, setTopicPrompt] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [genre, setGenre] = useState('Self-Help');
  const [companionProduct, setCompanionProduct] = useState('');
  const [companionUrl, setCompanionUrl] = useState('');

  // 自带书稿导入表单状态
  const [importTitle, setImportTitle] = useState('');
  const [importSubtitle, setImportSubtitle] = useState('');
  const [importAuthorName, setImportAuthorName] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [manuscriptFile, setManuscriptFile] = useState<File | null>(null);
  const [rawManuscriptText, setRawManuscriptText] = useState('');

  // 共用印刷排版与封面规格
  const [trimSize, setTrimSize] = useState('6x9');
  const [targetPageCount, setTargetPageCount] = useState(100);
  const [paperType, setPaperType] = useState('cream');
  const [coverTheme, setCoverTheme] = useState('editorial_split');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const qMode = (searchParams.get('mode') || '').trim().toLowerCase();
    const qTopic = (searchParams.get('topic') || '').trim();
    const qCategory = (searchParams.get('category') || '').trim();
    const qDomain = (searchParams.get('domain') || '').trim();
    const qAudience = (searchParams.get('audience') || '').trim();
    const qTrim = (searchParams.get('trim') || '').trim();
    const qPaper = (searchParams.get('paper') || '').trim().toLowerCase();

    if (qMode === 'import') {
      setCreationMode('import');
      setTargetPageCount(0);
    } else if (qMode === 'generate') {
      setCreationMode('generate');
      setTargetPageCount(100);
    }

    if (qTrim === '5.5x8.5' || qTrim === '6x9' || qTrim === '8.5x11') {
      setTrimSize(qTrim);
    }
    if (qPaper === 'white' || qPaper === 'cream') {
      setPaperType(qPaper);
    }

    if (qTopic) setTopicPrompt(qTopic);
    if (qDomain) setCompanionUrl(qDomain);
    if (qAudience) setTargetAudience(qAudience);
    if (qCategory) {
      const normalizedCat =
        qCategory === 'Body, Mind & Spirit' ? 'Self-Help' : qCategory;
      if (
        (KDP_PRIMARY_CATEGORIES as readonly string[]).includes(normalizedCat)
      ) {
        setGenre(normalizedCat);
      }
    }

    // 读取从 KDP Guard 扫描工作台带过来的书稿快照以便无缝预填导入
    try {
      const rawDraft = sessionStorage.getItem(GUARD_DRAFT_STORAGE_KEY);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft);
        if (typeof draft.title === 'string' && draft.title.trim()) {
          setImportTitle((prev) => prev || draft.title.trim());
        }
        if (typeof draft.subtitle === 'string' && draft.subtitle.trim()) {
          setImportSubtitle((prev) => prev || draft.subtitle.trim());
        }
        if (typeof draft.authorName === 'string' && draft.authorName.trim()) {
          setImportAuthorName((prev) => prev || draft.authorName.trim());
        }
        if (typeof draft.description === 'string' && draft.description.trim()) {
          setImportDescription((prev) => prev || draft.description.trim());
        }
        if (
          typeof draft.companionDomain === 'string' &&
          draft.companionDomain.trim() &&
          !qDomain
        ) {
          setCompanionUrl(draft.companionDomain.trim());
        }
        if (
          typeof draft.manuscriptText === 'string' &&
          draft.manuscriptText.trim()
        ) {
          setRawManuscriptText((prev) => prev || draft.manuscriptText);
        }
        if (typeof draft.category === 'string' && draft.category.trim()) {
          const cat =
            draft.category === 'Body, Mind & Spirit'
              ? 'Self-Help'
              : draft.category;
          if ((KDP_PRIMARY_CATEGORIES as readonly string[]).includes(cat)) {
            setGenre(cat);
          }
        }
      }
    } catch {
      // 忽略损坏草稿
    }

    fetch('/api/kdp/profiles')
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0 && res.data.profiles?.length) {
          setProfiles(res.data.profiles);
          setPenProfileId(res.data.profiles[0].id);
        }
      })
      .catch(() => {});
  }, []);

  function switchMode(nextMode: StudioCreationMode) {
    setCreationMode(nextMode);
    if (nextMode === 'import' && targetPageCount === 100) {
      setTargetPageCount(0);
    } else if (nextMode === 'generate' && targetPageCount === 0) {
      setTargetPageCount(100);
    }
  }

  async function handleGenerateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/kdp/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pen_profile_id: penProfileId || undefined,
          topic_prompt: topicPrompt,
          target_audience: targetAudience,
          genre,
          companion_product: companionProduct,
          companion_url: companionUrl,
          trim_size: trimSize,
          target_page_count: targetPageCount || 100,
          paper_type: paperType,
          cover_theme: coverTheme,
          language: 'en',
        }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Failed to create blueprint');
      }
      toast.success('Collision-proof outline ready! Redirecting...');
      router.push(`/studio/${json.data.project.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate outline');
    } finally {
      setCreating(false);
    }
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manuscriptFile && !rawManuscriptText.trim()) {
      toast.error(
        'Please upload a .docx/.epub/.md/.txt file or paste your manuscript text.'
      );
      return;
    }

    setCreating(true);
    try {
      let res: Response;
      if (manuscriptFile) {
        const fd = new FormData();
        fd.append('file', manuscriptFile);
        if (penProfileId) fd.append('pen_profile_id', penProfileId);
        fd.append('title', importTitle.trim());
        fd.append('subtitle', importSubtitle.trim());
        fd.append('author_name', importAuthorName.trim());
        fd.append('genre', genre);
        fd.append('description', importDescription.trim());
        fd.append('companion_url', companionUrl.trim());
        fd.append('trim_size', trimSize);
        fd.append('target_page_count', String(targetPageCount));
        fd.append('paper_type', paperType);
        fd.append('cover_theme', coverTheme);
        fd.append('language', 'en');
        if (rawManuscriptText.trim()) {
          fd.append('raw_text', rawManuscriptText);
        }
        res = await fetch('/api/kdp/projects/import', {
          method: 'POST',
          body: fd,
        });
      } else {
        res = await fetch('/api/kdp/projects/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pen_profile_id: penProfileId || undefined,
            title: importTitle.trim(),
            subtitle: importSubtitle.trim(),
            author_name: importAuthorName.trim(),
            genre,
            description: importDescription.trim(),
            companion_url: companionUrl.trim(),
            trim_size: trimSize,
            target_page_count: targetPageCount,
            paper_type: paperType,
            cover_theme: coverTheme,
            language: 'en',
            raw_text: rawManuscriptText,
          }),
        });
      }

      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Failed to import manuscript');
      }
      toast.success('Manuscript parsed & audited! Opening project...');
      router.push(`/studio/${json.data.project.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not import manuscript');
    } finally {
      setCreating(false);
    }
  }

  const previewCoverTitle =
    creationMode === 'import'
      ? importTitle.trim().slice(0, 42) || 'Your Imported Manuscript'
      : topicPrompt.trim().slice(0, 42) || 'Quiet Cadence of Modern Focus';

  const previewAuthorName =
    profiles.find((p) => p.id === penProfileId)?.fullName ||
    (creationMode === 'import' ? importAuthorName.trim() : '') ||
    'Evelyn Vance';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      {/* 双模式切换选项卡：支持自带书稿 0 元导入 ($19 出包) 与 AI 从零造书 ($29 出包) */}
      <div className="bg-muted/50 grid gap-2 rounded-2xl border p-1.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => switchMode('import')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-left text-xs font-medium transition-all sm:text-sm',
            creationMode === 'import'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <FileUp className="size-4 shrink-0" />
          <span>{t('mode_import_tab')}</span>
        </button>
        <button
          type="button"
          onClick={() => switchMode('generate')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-left text-xs font-medium transition-all sm:text-sm',
            creationMode === 'generate'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Sparkles className="size-4 shrink-0" />
          <span>{t('mode_generate_tab')}</span>
        </button>
      </div>

      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {creationMode === 'import' ? t('import_heading') : t('step1_title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {creationMode === 'import'
            ? t('import_desc')
            : 'We check Apple Books & OpenLibrary live before locking your 12-section non-fiction blueprint.'}
        </p>
      </div>

      <form
        onSubmit={
          creationMode === 'import' ? handleImportSubmit : handleGenerateSubmit
        }
        className="space-y-6"
      >
        {creationMode === 'import' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Manuscript File, Metadata &amp; Author Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-border bg-muted/30 flex flex-col justify-between gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center">
                <div className="space-y-0.5 text-xs">
                  <div className="font-medium">
                    Upload .docx, .epub, .md, or .txt (Max 15MB)
                  </div>
                  <div className="text-muted-foreground">
                    We preserve your manuscript text verbatim and only strip
                    unsafe HTML/external links.
                  </div>
                  {manuscriptFile && (
                    <div className="text-primary pt-1 font-mono font-medium">
                      Selected: {manuscriptFile.name}
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept=".docx,.epub,.md,.markdown,.txt"
                  onChange={(e) =>
                    setManuscriptFile(e.target.files?.[0] || null)
                  }
                  className="text-muted-foreground text-xs file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-xs"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Book Title (auto-detected if blank)
                  </label>
                  <input
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    placeholder="e.g. The Warm Boundary Paradox"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Subtitle (optional, recommended &le; 110 chars)
                  </label>
                  <input
                    value={importSubtitle}
                    onChange={(e) => setImportSubtitle(e.target.value)}
                    placeholder="Practical Frameworks for Everyday Presence"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Author / Pen Name
                  </label>
                  <input
                    value={importAuthorName}
                    onChange={(e) => setImportAuthorName(e.target.value)}
                    placeholder="Your Name or Pen Name"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Primary KDP Category
                  </label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {KDP_PRIMARY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Pen Profile (optional)
                  </label>
                  <select
                    value={penProfileId}
                    onChange={(e) => setPenProfileId(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Use Author Name Above</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Back Cover Blurb / Description (optional, printed on paperback
                  back cover)
                </label>
                <textarea
                  rows={2}
                  value={importDescription}
                  onChange={(e) => setImportDescription(e.target.value)}
                  placeholder="Short back-cover summary for your paperback wrap PDF & KDP checklist..."
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Or Paste Full Manuscript / Markdown Text (minimum 100 words if
                  no file uploaded)
                </label>
                <textarea
                  rows={7}
                  value={rawManuscriptText}
                  onChange={(e) => setRawManuscriptText(e.target.value)}
                  placeholder="# Chapter 1: Getting Started&#10;&#10;Paste your complete manuscript or chapters here..."
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Book Premise &amp; Author Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Book Core Topic / Reader Problem *
                </label>
                <textarea
                  required
                  rows={3}
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  placeholder="e.g. How thoughtful leaders hold firm interpersonal boundaries with genuine warmth in high-stakes workplace relationships"
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Target Audience</label>
                  <input
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="e.g. Burned-out managers & empathic creators"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Primary KDP Category (31 Official White-Listed)
                  </label>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {KDP_PRIMARY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Author Pen Profile (matches copyright &amp; cover)
                </label>
                <select
                  value={penProfileId}
                  onChange={(e) => setPenProfileId(e.target.value)}
                  className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">Default (Evelyn Vance)</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 高级选项：纸型、目标页数/自然排页、伴读域名与 4 套封面样板 */}
        <Card>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <div>
              <div className="text-sm font-medium">
                Print Spec, Cover Architecture &amp; Companion Options
              </div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                {trimSize === '5.5x8.5'
                  ? '5.5"×8.5"'
                  : trimSize === '8.5x11'
                    ? '8.5"×11"'
                    : '6"×9"'}{' '}
                ·{' '}
                {targetPageCount === 0
                  ? 'Auto Natural Flow'
                  : `${targetPageCount}pp locked`}{' '}
                · {paperType} ·{' '}
                {KDP_COVER_THEMES.find((x) => x.id === coverTheme)?.name}
              </div>
            </div>
            {showAdvanced ? (
              <ChevronUp className="text-muted-foreground size-4 shrink-0" />
            ) : (
              <ChevronDown className="text-muted-foreground size-4 shrink-0" />
            )}
          </button>

          {showAdvanced && (
            <CardContent className="space-y-5 border-t pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {creationMode === 'generate' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      Optional Companion Anchor
                    </label>
                    <input
                      value={companionProduct}
                      onChange={(e) => setCompanionProduct(e.target.value)}
                      placeholder="e.g. Desk tactile stone / audio guide"
                      className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                )}
                <div
                  className={cn(
                    'space-y-1.5',
                    creationMode === 'import' && 'sm:col-span-2'
                  )}
                >
                  <label className="text-xs font-medium">
                    Reader Companion Portal (QR Text Only — Zero External Links
                    in eBook)
                  </label>
                  <input
                    value={companionUrl}
                    onChange={(e) => setCompanionUrl(e.target.value)}
                    placeholder="https://authorportal.com/audio"
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Trim Size</label>
                  <select
                    value={trimSize}
                    onChange={(e) => setTrimSize(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="6x9">
                      6&quot; × 9&quot; (Standard Trade)
                    </option>
                    <option value="5.5x8.5">
                      5.5&quot; × 8.5&quot; (Digest)
                    </option>
                    <option value="8.5x11">
                      8.5&quot; × 11&quot; (Workbook / Reference)
                    </option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Paperback Pagination
                  </label>
                  <select
                    value={targetPageCount}
                    onChange={(e) => setTargetPageCount(Number(e.target.value))}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {creationMode === 'import' && (
                      <option value={0}>
                        Auto Natural Flow (10.5pt Standard Print)
                      </option>
                    )}
                    <option value={100}>
                      100 Pages Locked (0.25&quot; Cream Spine)
                    </option>
                    <option value={120}>
                      120 Pages Locked (0.30&quot; Cream Spine)
                    </option>
                    <option value={150}>
                      150 Pages Locked (0.375&quot; Cream Spine)
                    </option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Interior Paper</label>
                  <select
                    value={paperType}
                    onChange={(e) => setPaperType(e.target.value)}
                    className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="cream">Cream (0.0025&quot; / page)</option>
                    <option value="white">White (0.002252&quot; / page)</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {KDP_COVER_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setCoverTheme(theme.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      coverTheme === theme.id
                        ? 'border-primary ring-primary/30 ring-2'
                        : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <KdpCoverThumbnail
                      themeId={theme.id}
                      title={previewCoverTitle}
                      authorName={previewAuthorName}
                      className="mb-2.5"
                    />
                    <div className="text-xs font-semibold">{theme.name}</div>
                    <div className="text-muted-foreground mt-0.5 text-[11px]">
                      {theme.description}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="lg"
            disabled={creating}
            className="gap-2 rounded-full px-8"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : creationMode === 'import' ? (
              <ShieldCheck className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {creationMode === 'import'
              ? t('btn_import_submit')
              : t('btn_create_outline')}
          </Button>
        </div>
      </form>
    </div>
  );
}
