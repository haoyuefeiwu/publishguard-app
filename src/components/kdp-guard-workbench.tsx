'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Loader2,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { KDP_PRIMARY_CATEGORIES } from '@/modules/kdp/constants';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';

interface AuditFinding {
  code: string;
  severity: string;
  rule_ref: string;
  message: string;
  matched_text: string;
  suggestion: string;
}

interface AuditData {
  passed: boolean;
  score: number;
  mode: string;
  word_count: number;
  errors: AuditFinding[];
  warnings: AuditFinding[];
  collisions: {
    checked: boolean;
    sources: string[];
    exact_matches: Array<{ title: string; author: string; source: string }>;
    similar_titles: Array<{ title: string; author: string; source: string }>;
  };
  suggestions: Array<{ original: string; replacement: string }>;
}

const RISKY_SAMPLE = {
  title: 'The Crystal Code',
  subtitle:
    'A 7-Day Neuroscience Guide to Turning Off Anxiety and Panic Attacks Fast',
  author: 'Lumina Studio',
  category: 'Body, Mind & Spirit',
  domain: 'https://luminaquartz.com/audio',
  description:
    'Get instant relief from insomnia and depression! Visit https://luminaquartz.com and use coupon WELCOME15 for 15% OFF. Published by Lumina Sacred Press, New York · London.',
  text: `<style>.prompt-card { border: 1px solid #d1d5db; background-color: #f9fafb; }</style>
<h2>Day 1 Scorecard</h2>
<p>Deflect panic attacks and cure insomnia in 60-second miracle resets. Click <a href="https://luminaquartz.com/audio">here</a> for printable worksheets and abundance cheques.</p>`,
};

export function KdpGuardWorkbench({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('studio.guard');

  const [mode, setMode] = useState<'dual' | 'ebook' | 'paperback'>('dual');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [category, setCategory] = useState('Self-Help');
  const [companionDomain, setCompanionDomain] = useState('');
  const [description, setDescription] = useState('');
  const [manuscriptText, setManuscriptText] = useState('');
  const [epubFile, setEpubFile] = useState<File | null>(null);

  const [scanning, setScanning] = useState(false);
  const [sanitizing, setSanitizing] = useState(false);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [sanitizedOutput, setSanitizedOutput] = useState('');

  function fillRiskyExample() {
    setTitle(RISKY_SAMPLE.title);
    setSubtitle(RISKY_SAMPLE.subtitle);
    setAuthorName(RISKY_SAMPLE.author);
    setCategory(RISKY_SAMPLE.category);
    setCompanionDomain(RISKY_SAMPLE.domain);
    setDescription(RISKY_SAMPLE.description);
    setManuscriptText(RISKY_SAMPLE.text);
    setEpubFile(null);
    setAudit(null);
    setSanitizedOutput('');
  }

  async function handleScan(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setScanning(true);
    setSanitizedOutput('');
    try {
      let res: Response;
      if (epubFile) {
        const fd = new FormData();
        fd.append('file', epubFile);
        fd.append('title', title);
        fd.append('subtitle', subtitle);
        fd.append('description', description);
        fd.append('author_name', authorName);
        fd.append('primary_category', category);
        fd.append('companion_domain', companionDomain);
        fd.append('mode', mode);
        res = await fetch('/api/kdp/guard/scan', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/kdp/guard/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            subtitle,
            description,
            author_name: authorName,
            primary_category: category,
            manuscript_text: manuscriptText,
            companion_domain: companionDomain,
            mode,
          }),
        });
      }
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Scan failed');
      }
      setAudit(json.data.audit);
    } catch (err: any) {
      toast.error(err?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function handleSanitize() {
    const source = manuscriptText.trim() || description.trim();
    if (!source) {
      toast.error('Please enter manuscript text or description first');
      return;
    }
    setSanitizing(true);
    try {
      const res = await fetch('/api/kdp/guard/sanitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: source, mode }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Sanitize failed');
      }
      setSanitizedOutput(json.data.sanitizedText);
      toast.success(
        `Sanitized! Score improved from ${json.data.beforeScore} -> ${json.data.afterScore}`
      );
    } catch (err: any) {
      toast.error(err?.message || 'Sign in required for AI Sanitizer');
    } finally {
      setSanitizing(false);
    }
  }

  return (
    <div className="border-border bg-card w-full rounded-2xl border p-5 text-left shadow-sm sm:p-7">
      {/* 顶部模式切换与高危演示填充按钮 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted/60 inline-flex rounded-lg p-1 text-xs font-medium">
          {(
            [
              ['dual', t('mode_dual')],
              ['ebook', t('mode_ebook')],
              ['paperback', t('mode_paperback')],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setMode(val)}
              className={cn(
                'rounded-md px-3 py-1.5 transition-colors',
                mode === val
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fillRiskyExample}
          className="text-xs"
        >
          <Sparkles className="mr-1.5 size-3.5" />
          {t('btn_load_risky')}
        </Button>
      </div>

      {/* 表单输入区 */}
      <form onSubmit={handleScan} className="space-y-4">
        <div
          className={cn(
            'grid gap-4',
            compact ? 'sm:grid-cols-2' : 'md:grid-cols-2'
          )}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Warm Boundary Paradox"
              className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_subtitle')}</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Structured Frameworks for Composed Focus (<=110 chars)"
              className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>

        {!compact && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {t('label_author')}
                </label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Evelyn Vance"
                  className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {t('label_category')}
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                >
                  {KDP_PRIMARY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="Body, Mind & Spirit">
                    Body, Mind &amp; Spirit (Legacy Deprecated)
                  </option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  {t('label_domain')}
                </label>
                <input
                  type="text"
                  value={companionDomain}
                  onChange={(e) => setCompanionDomain(e.target.value)}
                  placeholder="https://yourdomain.com/audio"
                  className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {t('label_description')}
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Paste your Amazon KDP book description..."
                className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium">{t('label_text')}</label>
          <textarea
            rows={compact ? 3 : 5}
            value={manuscriptText}
            onChange={(e) => setManuscriptText(e.target.value)}
            placeholder="Paste sample chapter text, CSS/HTML interior code, or leave blank to audit title/metadata..."
            className="border-input bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none focus:ring-2"
          />
        </div>

        {!compact && (
          <div className="border-border bg-muted/30 flex flex-col justify-between gap-3 rounded-xl border border-dashed p-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-xs">
              <FileUp className="text-muted-foreground size-4 shrink-0" />
              <span className="font-medium">{t('label_epub')}</span>
              {epubFile && (
                <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-mono">
                  {epubFile.name}
                </span>
              )}
            </div>
            <input
              type="file"
              accept=".epub"
              onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
              className="text-muted-foreground text-xs file:mr-3 file:rounded-md file:border file:px-2.5 file:py-1 file:text-xs"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="submit"
            disabled={scanning}
            className="gap-2 rounded-full px-6"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SearchCheck className="size-4" />
            )}
            {scanning ? t('btn_scanning') : t('btn_scan')}
          </Button>
          {compact && (
            <Link
              href="/tools/kdp-guard"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'text-muted-foreground gap-1.5'
              )}
            >
              EPUB Upload &amp; Full Scanner
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </form>

      {/* 诊断结果区 */}
      {audit && (
        <div className="border-border mt-6 space-y-5 border-t pt-6">
          <div
            className={cn(
              'flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center',
              audit.passed
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            )}
          >
            <div className="flex items-center gap-3">
              {audit.passed ? (
                <ShieldCheck className="size-7 shrink-0 text-emerald-600" />
              ) : (
                <ShieldAlert className="size-7 shrink-0" />
              )}
              <div>
                <div className="text-sm font-bold tracking-wide">
                  {audit.passed ? t('status_pass') : t('status_block')}
                </div>
                <div className="mt-0.5 text-xs opacity-85">
                  {t('words_label')}: {audit.word_count.toLocaleString()} ·{' '}
                  {audit.errors.length} errors · {audit.warnings.length}{' '}
                  warnings
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs opacity-75">{t('score_label')}</div>
                <div className="text-2xl font-bold">{audit.score}/100</div>
              </div>
              {!audit.passed && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSanitize}
                  disabled={sanitizing}
                  className="gap-1.5 rounded-full"
                >
                  {sanitizing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="size-3.5" />
                  )}
                  {sanitizing ? t('btn_sanitizing') : t('btn_sanitize')}
                </Button>
              )}
            </div>
          </div>

          {/* 撞车实时结果 */}
          {audit.collisions?.checked && (
            <div className="border-border bg-muted/30 rounded-xl border p-4 text-xs">
              <div className="mb-2 font-semibold">{t('collisions_title')}</div>
              {audit.collisions.exact_matches.length > 0 ? (
                <div className="text-destructive space-y-1">
                  {audit.collisions.exact_matches.map((m, i) => (
                    <div key={i}>
                      Exact match: <strong>{m.title}</strong> by {m.author} (
                      {m.source})
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2 className="size-4" />
                  {t('no_collisions')}
                </div>
              )}
              {audit.collisions.similar_titles.length > 0 && (
                <div className="text-muted-foreground mt-2 flex flex-wrap gap-1.5">
                  {audit.collisions.similar_titles.slice(0, 4).map((s, idx) => (
                    <span
                      key={idx}
                      className="bg-background rounded border px-2 py-0.5"
                    >
                      {s.title} ({s.source})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 错误清单 */}
          {audit.errors.length > 0 && (
            <div className="space-y-2.5">
              <div className="text-destructive text-xs font-semibold uppercase">
                {t('errors_title')}
              </div>
              {audit.errors.map((err, i) => (
                <div
                  key={i}
                  className="border-destructive/30 bg-destructive/5 rounded-xl border p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-red-700 dark:text-red-300">
                      [{err.rule_ref}] {err.code}
                    </span>
                    {err.matched_text && (
                      <code className="bg-background rounded px-1.5 py-0.5 text-[11px]">
                        {err.matched_text}
                      </code>
                    )}
                  </div>
                  <p className="mt-1.5 leading-relaxed">{err.message}</p>
                  {err.suggestion && (
                    <p className="text-muted-foreground mt-1">
                      Fix: {err.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 警告清单 */}
          {audit.warnings.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-amber-600 uppercase">
                {t('warnings_title')}
              </div>
              {audit.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <div>
                    <div className="font-medium">{w.message}</div>
                    {w.suggestion && (
                      <div className="text-muted-foreground mt-0.5">
                        {w.suggestion}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 洗稿结果 */}
          {sanitizedOutput && (
            <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {t('clean_text_title')}
              </div>
              <pre className="bg-background max-h-60 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">
                {sanitizedOutput}
              </pre>
            </div>
          )}

          {/* 漏斗转化引导 CTA */}
          <div className="border-border bg-muted/40 flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
            <div className="text-xs">
              <div className="font-semibold">
                Ready to build a 18,000+ word book that passes every KDP audit?
              </div>
              <div className="text-muted-foreground mt-0.5">
                Start free in Book Studio (30 welcome credits included — preview
                Chapter 1 free).
              </div>
            </div>
            <Link
              href="/studio/new"
              className={cn(
                buttonVariants({ size: 'sm' }),
                'shrink-0 gap-1.5 rounded-full'
              )}
            >
              Open Book Studio
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
