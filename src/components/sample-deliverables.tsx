'use client';

import { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Layers,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

type SampleTab = 'interior' | 'wrap' | 'front' | 'epub' | 'checklist';

const INTERIOR_PAGES = [
  {
    id: 'title',
    labelKey: 'sample.page_title',
    src: '/samples/interior-title.png',
    captionKey: 'sample.caption_title',
  },
  {
    id: 'toc',
    labelKey: 'sample.page_toc',
    src: '/samples/interior-toc.png',
    captionKey: 'sample.caption_toc',
  },
  {
    id: 'chapter',
    labelKey: 'sample.page_chapter',
    src: '/samples/interior-chapter.png',
    captionKey: 'sample.caption_chapter',
  },
  {
    id: 'companion',
    labelKey: 'sample.page_companion',
    src: '/samples/interior-companion.png',
    captionKey: 'sample.caption_companion',
  },
] as const;

const SAMPLE_CHECKLIST_PREVIEW = {
  title: 'The Quiet Cadence of High-Growth Leadership',
  subtitle:
    'Cultivating Deliberate Pacing and Unshakable Judgment in Rapidly Expanding Teams',
  author: 'Claire Bennett',
  primary_category: 'Business & Money',
  subcategory_hint: 'Business & Money > Management & Leadership > Strategy',
  trim_size: '6x9',
  paper_type: 'cream',
  actual_pages: 100,
  spine_width_in: 0.25,
  wrap_dimensions_in: '12.5 x 9.25',
  ai_generated_disclosure: {
    required_by_kdp: true,
    text_content: 'AI-generated (entire or edited)',
    guidance:
      'Amazon KDP requires declaring AI-generated text, images, or translations during book setup.',
  },
  official_previewer_checks: [
    'Open 01_Kindle_eBook_Upload.epub in Amazon Kindle Previewer before publishing.',
    'Inspect 01_Interior_Manuscript_Print.pdf and 03_Paperback_Cover_Wrap.pdf in Amazon KDP Print Previewer.',
  ],
};

/**
 * 首页真实成书交付展示区块：以真实导出的 19,113 词样本全书展示 5 大上传就绪产物与官方预览器核验指标。
 */
export function SampleDeliverables() {
  const t = useTranslations('landing');
  const [activeTab, setActiveTab] = useState<SampleTab>('interior');
  const [pageIdx, setPageIdx] = useState(2);

  const tabs: Array<{ id: SampleTab; label: string; icon: typeof BookOpen }> = [
    { id: 'interior', label: t('sample.tab_interior'), icon: BookOpen },
    { id: 'wrap', label: t('sample.tab_wrap'), icon: Layers },
    { id: 'front', label: t('sample.tab_front'), icon: ImageIcon },
    { id: 'epub', label: t('sample.tab_epub'), icon: FileCode2 },
    { id: 'checklist', label: t('sample.tab_checklist'), icon: FileText },
  ];

  const currentPage = INTERIOR_PAGES[pageIdx] ?? INTERIOR_PAGES[0];

  return (
    <section
      id="sample-book"
      className="border-border bg-muted/20 border-t px-4 py-20 sm:py-24"
    >
      {/* 兼容早期外联邮件中的 #sample 旧锚点跳转 */}
      <span id="sample" className="sr-only" aria-hidden="true" />
      <div className="mx-auto max-w-6xl space-y-10">
        {/* 头部说明与实测指标徽章 */}
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl space-y-3">
            <div className="text-muted-foreground inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="size-3.5" />
              <span>{t('sample.badge')}</span>
            </div>
            <h2 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">
              {t('sample.headline')}
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
              {t('sample.subheadline')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
            <div className="border-border bg-card rounded-xl border px-3.5 py-2.5 text-xs">
              <div className="text-muted-foreground">
                {t('sample.stat_words_label')}
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold">
                19,113 words
              </div>
            </div>
            <div className="border-border bg-card rounded-xl border px-3.5 py-2.5 text-xs">
              <div className="text-muted-foreground">
                {t('sample.stat_pages_label')}
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold">
                100 pp · 6×9"
              </div>
            </div>
            <div className="border-border bg-card rounded-xl border px-3.5 py-2.5 text-xs">
              <div className="text-muted-foreground">
                {t('sample.stat_spine_label')}
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold">
                0.2500" Cream
              </div>
            </div>
            <div className="border-border bg-card rounded-xl border px-3.5 py-2.5 text-xs">
              <div className="text-muted-foreground">
                {t('sample.stat_kp_label')}
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                0 Errors · Supported
              </div>
            </div>
          </div>
        </div>

        {/* 五大产物切换面板 */}
        <div className="border-border bg-card overflow-hidden rounded-3xl border shadow-sm">
          <div className="border-border bg-muted/40 flex flex-wrap gap-1.5 border-b p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors sm:text-sm',
                    active
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="grid gap-8 p-6 lg:grid-cols-[1.25fr_0.9fr] lg:p-8">
            {/* 左侧真实产物预览视图 */}
            <div className="border-border bg-muted/25 flex min-h-[420px] flex-col items-center justify-center rounded-2xl border p-4 sm:p-6">
              {activeTab === 'interior' && (
                <div className="w-full space-y-4">
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {INTERIOR_PAGES.map((pg, idx) => (
                      <button
                        key={pg.id}
                        type="button"
                        onClick={() => setPageIdx(idx)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          pageIdx === idx
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {t(pg.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div className="mx-auto max-w-[340px] overflow-hidden rounded-lg border border-stone-300 bg-white shadow-md">
                    <img
                      src={currentPage.src}
                      alt={t(currentPage.captionKey)}
                      className="h-auto w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-muted-foreground text-center text-xs">
                    {t(currentPage.captionKey)}
                  </p>
                </div>
              )}

              {activeTab === 'wrap' && (
                <div className="w-full space-y-4 text-center">
                  <div className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-md">
                    <img
                      src="/samples/cover-wrap.jpg"
                      alt="Full bleed paperback wrap PDF"
                      className="h-auto w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('sample.caption_wrap')}
                  </p>
                </div>
              )}

              {activeTab === 'front' && (
                <div className="w-full space-y-4 text-center">
                  <div className="mx-auto max-w-[290px] overflow-hidden rounded-xl border border-stone-300 bg-white shadow-md">
                    <img
                      src="/samples/cover-front.jpg"
                      alt="1600x2560 Kindle front cover JPG"
                      className="h-auto w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('sample.caption_front')}
                  </p>
                </div>
              )}

              {activeTab === 'epub' && (
                <div className="w-full max-w-md space-y-4">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" />
                      <span>Amazon Kindle Previewer 4.0.3 CLI</span>
                    </div>
                    <dl className="mt-4 space-y-2.5 text-xs">
                      <div className="flex justify-between gap-4 border-b border-emerald-500/15 pb-2">
                        <dt className="text-muted-foreground">
                          Conversion Status
                        </dt>
                        <dd className="font-mono font-semibold">Success</dd>
                      </div>
                      <div className="flex justify-between gap-4 border-b border-emerald-500/15 pb-2">
                        <dt className="text-muted-foreground">
                          Enhanced Typesetting
                        </dt>
                        <dd className="font-mono font-semibold">Supported</dd>
                      </div>
                      <div className="flex justify-between gap-4 border-b border-emerald-500/15 pb-2">
                        <dt className="text-muted-foreground">
                          Blocking Errors / Quality Issues
                        </dt>
                        <dd className="font-mono font-semibold">
                          0 Errors · 0 Issues
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4 border-b border-emerald-500/15 pb-2">
                        <dt className="text-muted-foreground">
                          Package Standard
                        </dt>
                        <dd className="font-mono">
                          EPUB 3 + NCX + 8-bit RGB QR
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">
                          Outbound HTTP Links in XHTML
                        </dt>
                        <dd className="font-mono">0 Clickable Links</dd>
                      </div>
                    </dl>
                  </div>
                  <p className="text-muted-foreground text-center text-xs">
                    {t('sample.caption_epub')}
                  </p>
                </div>
              )}

              {activeTab === 'checklist' && (
                <div className="w-full space-y-3">
                  <div className="border-border bg-background max-h-[360px] overflow-auto rounded-xl border p-4">
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap">
                      {JSON.stringify(SAMPLE_CHECKLIST_PREVIEW, null, 2)}
                    </pre>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      04_KDP_Metadata_Checklist.json
                    </span>
                    <a
                      href="/samples/kdp-metadata-checklist.json"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground font-medium underline underline-offset-4"
                    >
                      {t('sample.view_raw_json')}
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* 右侧样书元数据与下一步行动 */}
            <div className="flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div>
                  <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    {t('sample.bundle_title')}
                  </div>
                  <h3 className="mt-1 font-serif text-2xl leading-snug font-normal">
                    The Quiet Cadence of High-Growth Leadership
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Claire Bennett · Business &amp; Money
                  </p>
                </div>

                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{t('sample.deliverable_1')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{t('sample.deliverable_2')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{t('sample.deliverable_3')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{t('sample.deliverable_4')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{t('sample.deliverable_5')}</span>
                  </li>
                </ul>
              </div>

              <div className="border-border bg-muted/40 space-y-3 rounded-2xl border p-4">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t('sample.previewer_note')}
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href="/studio/new"
                    className={cn(
                      buttonVariants({ size: 'sm' }),
                      'rounded-full px-5'
                    )}
                  >
                    <Sparkles className="mr-1.5 size-3.5" />
                    {t('sample.cta_studio')}
                  </Link>
                  <Link
                    href="/tools/kdp-guard"
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'rounded-full px-5'
                    )}
                  >
                    {t('sample.cta_guard')}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
