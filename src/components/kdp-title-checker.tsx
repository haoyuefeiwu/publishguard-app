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
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
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

interface TitleAuditResult {
  passed: boolean;
  score: number;
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

const GUARD_DRAFT_STORAGE_KEY = 'pg_guard_workbench_draft_v1';

const RISKY_TITLE_SAMPLE = {
  title: 'Atomic Habits Blueprint',
  subtitle:
    'The #1 Bestseller 7-Day Anxiety & Depression Miracle Cure Guide | Free Bonus PDF + Coupon Inside',
  authorName: 'Lumina Sacred Press',
  category: 'Self-Help',
};

export function KdpTitleChecker() {
  const t = useTranslations('tools.titleChecker');
  const locale = useLocale();
  const auditLang = locale.startsWith('zh') ? 'zh' : 'en';

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [category, setCategory] = useState<string>('Self-Help');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<TitleAuditResult | null>(null);

  const combinedLength =
    `${title.trim()}${subtitle.trim() ? `: ${subtitle.trim()}` : ''}`.length;
  const subtitleLength = subtitle.trim().length;
  const isOver200 = combinedLength > 200;
  const isSubOver100 = subtitleLength > 100;

  function loadRiskyExample() {
    setTitle(RISKY_TITLE_SAMPLE.title);
    setSubtitle(RISKY_TITLE_SAMPLE.subtitle);
    setAuthorName(RISKY_TITLE_SAMPLE.authorName);
    setCategory(RISKY_TITLE_SAMPLE.category);
    setResult(null);
  }

  function syncDraftToStorage(nextAudit: TitleAuditResult | null) {
    try {
      const existingRaw = sessionStorage.getItem(GUARD_DRAFT_STORAGE_KEY);
      const prev = existingRaw ? JSON.parse(existingRaw) : {};
      sessionStorage.setItem(
        GUARD_DRAFT_STORAGE_KEY,
        JSON.stringify({
          ...prev,
          mode: prev.mode || 'dual',
          title: title.trim(),
          subtitle: subtitle.trim(),
          authorName: authorName.trim(),
          category,
          audit: nextAudit || prev.audit || null,
        })
      );
    } catch {
      // 忽略浏览器隐私模式配额异常
    }
  }

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !subtitle.trim()) {
      toast.error('Please enter a book title or subtitle.');
      return;
    }

    setChecking(true);
    try {
      const res = await fetch('/api/kdp/guard/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          subtitle: subtitle.trim(),
          author_name: authorName.trim(),
          primary_category: category,
          mode: 'dual',
          lang: auditLang,
        }),
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.message || 'Title scan failed');
      }
      const nextAudit: TitleAuditResult = json.data.audit;
      setResult(nextAudit);
      syncDraftToStorage(nextAudit);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to scan title');
    } finally {
      setChecking(false);
    }
  }

  const allFindings = result ? [...result.errors, ...result.warnings] : [];
  const hasCollisions = Boolean(
    result &&
    (result.collisions.exact_matches.length > 0 ||
      result.collisions.similar_titles.length > 0)
  );

  return (
    <div className="border-border bg-card w-full rounded-2xl border p-5 shadow-xs sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 font-mono',
              isOver200
                ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {t('meter_total', { count: combinedLength })}
          </span>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 font-mono',
              isSubOver100
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {t('meter_sub', { count: subtitleLength })}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadRiskyExample}
          className="text-xs"
        >
          <Sparkles className="mr-1.5 size-3.5" />
          {t('btn_load_risky')}
        </Button>
      </div>

      <form onSubmit={handleCheck} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_title')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('placeholder_title')}
              className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_subtitle')}</label>
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={t('placeholder_subtitle')}
              className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_author')}</label>
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder={t('placeholder_author')}
              className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('label_category')}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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

        <Button
          type="submit"
          size="lg"
          disabled={checking}
          className="w-full sm:w-auto"
        >
          {checking ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('btn_checking')}
            </>
          ) : (
            <>
              <SearchCheck className="mr-2 size-4" />
              {t('btn_check')}
            </>
          )}
        </Button>
      </form>

      {result && (
        <div className="border-border mt-7 space-y-5 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {result.passed && !hasCollisions && !isOver200 ? (
                <CheckCircle2 className="size-8 text-emerald-600" />
              ) : (
                <ShieldAlert className="size-8 text-amber-600" />
              )}
              <div>
                <div className="text-muted-foreground text-xs font-medium uppercase">
                  {t('score_label')}
                </div>
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-2xl font-bold">
                    {result.score}/100
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      result.passed && !hasCollisions && !isOver200
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-red-500/10 text-red-700 dark:text-red-400'
                    )}
                  >
                    {result.passed && !hasCollisions && !isOver200
                      ? t('status_safe')
                      : t('status_warn')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 实时目录撞车结果 */}
          <div className="border-border bg-muted/20 space-y-2.5 rounded-xl border p-4">
            <div className="text-xs font-semibold">{t('collisions_title')}</div>
            {result.collisions.exact_matches.length === 0 &&
            result.collisions.similar_titles.length === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t('no_collisions')}
              </p>
            ) : (
              <div className="space-y-3 text-xs">
                {result.collisions.exact_matches.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-semibold text-red-700 dark:text-red-400">
                      {t('exact_matches_label')} (
                      {result.collisions.exact_matches.length})
                    </div>
                    <ul className="space-y-1">
                      {result.collisions.exact_matches.map((m, idx) => (
                        <li
                          key={`${m.source}-${idx}`}
                          className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5"
                        >
                          <span className="font-medium">{m.title}</span> —{' '}
                          {m.author} ({m.source})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.collisions.similar_titles.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-semibold text-amber-700 dark:text-amber-300">
                      {t('similar_matches_label')} (
                      {result.collisions.similar_titles.length})
                    </div>
                    <ul className="space-y-1">
                      {result.collisions.similar_titles
                        .slice(0, 5)
                        .map((m, idx) => (
                          <li
                            key={`${m.source}-sim-${idx}`}
                            className="border-border bg-background rounded-lg border px-3 py-1.5"
                          >
                            <span className="font-medium">{m.title}</span> —{' '}
                            {m.author} ({m.source})
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 规则触发详情 */}
          <div className="space-y-2.5">
            <div className="text-xs font-semibold">{t('findings_title')}</div>
            {allFindings.length === 0 ? (
              <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                {t('no_findings')}
              </p>
            ) : (
              <div className="space-y-2">
                {allFindings.map((f, idx) => (
                  <div
                    key={`${f.code}-${idx}`}
                    className={cn(
                      'rounded-xl border p-3.5 text-xs',
                      f.severity === 'error'
                        ? 'border-red-500/30 bg-red-500/5'
                        : 'border-amber-500/30 bg-amber-500/5'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="size-3.5 shrink-0" />[
                        {f.rule_ref}] {f.message}
                      </span>
                    </div>
                    {f.matched_text && (
                      <div className="bg-background/80 mt-2 rounded border px-2.5 py-1 font-mono text-[11px]">
                        {f.matched_text}
                      </div>
                    )}
                    {f.suggestion && (
                      <div className="text-muted-foreground mt-1.5">
                        {f.suggestion}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 带着已验证书名转入 $19 导入打包或完整 26 项体检 */}
          <div className="border-primary/30 bg-primary/5 rounded-2xl border p-5">
            <h3 className="text-sm font-semibold">{t('cta_title')}</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {t('cta_desc')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Link
                href="/studio/new?mode=import"
                onClick={() => syncDraftToStorage(result)}
                className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
              >
                <FileUp className="size-3.5" />
                {t('cta_import')}
                <ArrowRight className="size-3.5" />
              </Link>
              <Link
                href="/tools/kdp-guard"
                onClick={() => syncDraftToStorage(result)}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'gap-1.5'
                )}
              >
                <ShieldCheck className="size-3.5" />
                {t('cta_full_guard')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
