'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Layers,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import {
  buildKdpCoverTemplateSvg,
  calculateKdpPaperbackSpecs,
  KDP_PAPER_TYPES,
  KDP_TRIM_SIZES,
  type KdpPaperTypeId,
} from '@/lib/kdp-spine';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';

export function KdpSpineCalculator() {
  const t = useTranslations('tools.spine');
  const locale = useLocale();
  const isZh = locale.startsWith('zh');

  const [trimSizeId, setTrimSizeId] = useState<string>('6x9');
  const [paperType, setPaperType] = useState<KdpPaperTypeId>('cream');
  const [rawPageCount, setRawPageCount] = useState<number>(150);
  const [hasBleed, setHasBleed] = useState<boolean>(false);

  const specs = useMemo(
    () =>
      calculateKdpPaperbackSpecs({
        trimSizeId,
        paperType,
        pageCount: rawPageCount,
        hasBleed,
      }),
    [trimSizeId, paperType, rawPageCount, hasBleed]
  );

  // 带信息头部的 SVG 用于界面可视化预览
  const previewSvgUrl = useMemo(() => {
    const svgMarkup = buildKdpCoverTemplateSvg(specs, { includeHeader: true });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  }, [specs]);

  function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleCopyAllSpecs() {
    const summary = [
      `Amazon KDP Paperback Print Specs (${specs.trimSize.widthIn}" x ${specs.trimSize.heightIn}", ${specs.pageCount} pages, ${specs.paperSpec.labelEn})`,
      `Full Wrap Cover (with 0.125" bleed): ${specs.fullCoverWidthIn.toFixed(4)}" x ${specs.fullCoverHeightIn.toFixed(4)}" (${specs.fullCoverWidthMm} mm x ${specs.fullCoverHeightMm} mm | ${specs.fullCoverWidthPx} x ${specs.fullCoverHeightPx} px @ 300 DPI)`,
      `Spine Width: ${specs.spineWidthIn.toFixed(4)}" (${specs.spineWidthMm} mm | ${specs.spineWidthPx} px)`,
      `Spine Text: ${specs.spineTextAllowed ? `Allowed (safe width ${specs.spineTextSafeWidthIn.toFixed(4)}")` : 'Not allowed (< 79 pages)'}`,
      `Interior PDF Size (${specs.hasBleed ? 'Bleed' : 'No Bleed'}): ${specs.interiorWidthIn.toFixed(4)}" x ${specs.interiorHeightIn.toFixed(4)}" (${specs.interiorWidthMm} mm x ${specs.interiorHeightMm} mm)`,
      `Minimum Margins: Inside/Gutter ${specs.gutterMarginIn}" (${specs.gutterMarginMm} mm) | Outside/Top/Bottom ${specs.outsideMarginIn}" (${specs.outsideMarginMm} mm)`,
      `ISBN Barcode Zone: ${specs.barcodeWidthIn.toFixed(2)}" x ${specs.barcodeHeightIn.toFixed(2)}" white box on lower-right back cover`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      toast.success(t('toast_copied'));
    } catch {
      toast.error('Clipboard permission unavailable');
    }
  }

  function handleDownloadSvg() {
    const svg = buildKdpCoverTemplateSvg(specs, { includeHeader: true });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(
      blob,
      `kdp-cover-template-${specs.trimSize.id}-${specs.pageCount}p-${specs.paperSpec.id}.svg`
    );
    toast.success(t('toast_svg_ready'));
  }

  async function handleDownloadPng() {
    // 导出不含顶部信息条的无头版 SVG，使 PNG 分辨率严格对齐全封面 300 DPI 像素，可直接导入 Canva/PS 当底层参考
    const rawSvg = buildKdpCoverTemplateSvg(specs, { includeHeader: false });
    const svgBlob = new Blob([rawSvg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const img = new Image();
      img.width = specs.fullCoverWidthPx;
      img.height = specs.fullCoverHeightPx;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to rasterize SVG guide'));
        img.src = svgUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = specs.fullCoverWidthPx;
      canvas.height = specs.fullCoverHeightPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!pngBlob) throw new Error('PNG export failed');

      triggerBlobDownload(
        pngBlob,
        `kdp-cover-300dpi-${specs.trimSize.id}-${specs.pageCount}p-${specs.paperSpec.id}.png`
      );
      toast.success(t('toast_png_ready'));
    } catch {
      // 若超大画布受浏览器限制则降级下载 SVG
      handleDownloadSvg();
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  const studioImportHref = `/studio/new?mode=import&trim=${encodeURIComponent(specs.studioImportParams.trim)}&paper=${encodeURIComponent(specs.studioImportParams.paper)}`;

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* 左侧参数输入面板 */}
        <div className="border-border bg-card space-y-6 rounded-2xl border p-5 shadow-xs sm:p-6 lg:col-span-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase">
              {t('form_trim')}
            </label>
            <select
              value={trimSizeId}
              onChange={(e) => setTrimSizeId(e.target.value)}
              className="border-input bg-background w-full rounded-lg border px-3 py-2.5 text-sm"
            >
              {KDP_TRIM_SIZES.map((item) => (
                <option key={item.id} value={item.id}>
                  {isZh ? item.labelZh : item.labelEn}
                  {item.studioSupported ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase">
              {t('form_paper')}
            </label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {(Object.keys(KDP_PAPER_TYPES) as KdpPaperTypeId[]).map(
                (paperId) => {
                  const p = KDP_PAPER_TYPES[paperId];
                  const active = paperType === paperId;
                  return (
                    <button
                      key={paperId}
                      type="button"
                      onClick={() => setPaperType(paperId)}
                      className={cn(
                        'rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                          : 'border-border hover:bg-muted/40'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span>{isZh ? p.labelZh : p.labelEn}</span>
                        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          {p.thicknessIn}&quot;
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {isZh ? p.descZh : p.descEn}
                      </p>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold tracking-wide uppercase">
                {t('form_pages')}
              </label>
              <span className="font-mono text-sm font-semibold">
                {specs.pageCount} pp
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={24}
                max={828}
                value={rawPageCount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRawPageCount(Number.isFinite(v) ? v : 24);
                }}
                className="border-input bg-background w-24 rounded-lg border px-3 py-2 font-mono text-sm"
              />
              <input
                type="range"
                min={specs.paperSpec.minPages}
                max={specs.paperSpec.maxPages}
                step={2}
                value={specs.pageCount}
                onChange={(e) => setRawPageCount(Number(e.target.value))}
                className="accent-primary flex-1 cursor-pointer"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {t('form_pages_hint', {
                min: specs.paperSpec.minPages,
                max: specs.paperSpec.maxPages,
              })}
            </p>
            {specs.pageCountClamped && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t('form_pages_clamped', {
                    min: specs.paperSpec.minPages,
                    max: specs.paperSpec.maxPages,
                    value: specs.pageCount,
                  })}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase">
              {t('form_bleed')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setHasBleed(false)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                  !hasBleed
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/40'
                )}
              >
                {t('bleed_none')}
              </button>
              <button
                type="button"
                onClick={() => setHasBleed(true)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                  hasBleed
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/40'
                )}
              >
                {t('bleed_full')}
              </button>
            </div>
          </div>
        </div>

        {/* 右侧核心计算结果面板 */}
        <div className="space-y-4 lg:col-span-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border-border bg-card rounded-2xl border p-5 shadow-xs sm:col-span-2">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <Layers className="text-primary size-4" />
                <span>{t('card_cover_title')}</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-bold tracking-tight sm:text-3xl">
                {specs.fullCoverWidthIn.toFixed(4)}&quot; ×{' '}
                {specs.fullCoverHeightIn.toFixed(4)}&quot;
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                <span>
                  {specs.fullCoverWidthMm} mm × {specs.fullCoverHeightMm} mm
                </span>
                <span>
                  {specs.fullCoverWidthPx} × {specs.fullCoverHeightPx} px @ 300
                  DPI
                </span>
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {t('card_cover_note')}
              </p>
            </div>

            <div className="border-border bg-card rounded-2xl border p-5 shadow-xs">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <Ruler className="text-primary size-4" />
                <span>{t('card_spine_title')}</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-bold tracking-tight">
                {specs.spineWidthIn.toFixed(4)}&quot;
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs">
                {specs.spineWidthMm} mm · {specs.spineWidthPx} px @ 300 DPI
              </div>
              <div
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs',
                  specs.spineTextAllowed
                    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                )}
              >
                {specs.spineTextAllowed ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                )}
                <span>
                  {specs.spineTextAllowed
                    ? t('card_spine_allowed', {
                        safeIn: specs.spineTextSafeWidthIn.toFixed(4),
                        safeMm: specs.spineTextSafeWidthMm,
                      })
                    : t('card_spine_forbidden')}
                </span>
              </div>
            </div>

            <div className="border-border bg-card rounded-2xl border p-5 shadow-xs">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <BookOpen className="text-primary size-4" />
                <span>{t('card_interior_title')}</span>
              </div>
              <div className="mt-2 font-mono text-2xl font-bold tracking-tight">
                {specs.interiorWidthIn.toFixed(3)}&quot; ×{' '}
                {specs.interiorHeightIn.toFixed(3)}&quot;
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs">
                {specs.interiorWidthMm} mm × {specs.interiorHeightMm} mm ·{' '}
                {specs.interiorWidthPx} × {specs.interiorHeightPx} px
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                {specs.hasBleed
                  ? t('card_interior_note_bleed')
                  : t('card_interior_note_nobleed')}
              </p>
            </div>

            <div className="border-border bg-card rounded-2xl border p-5 shadow-xs sm:col-span-2">
              <div className="text-muted-foreground text-xs font-medium">
                {t('card_margins_title')}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="bg-muted/40 rounded-xl p-3">
                  <div className="text-muted-foreground text-[11px]">
                    {t('card_margins_gutter')}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {specs.gutterMarginIn}&quot;{' '}
                    <span className="text-muted-foreground text-xs font-normal">
                      ({specs.gutterMarginMm} mm)
                    </span>
                  </div>
                </div>
                <div className="bg-muted/40 rounded-xl p-3">
                  <div className="text-muted-foreground text-[11px]">
                    {t('card_margins_outside')}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {specs.outsideMarginIn}&quot;{' '}
                    <span className="text-muted-foreground text-xs font-normal">
                      ({specs.outsideMarginMm} mm)
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                <strong className="text-foreground">
                  {t('card_barcode_title')}:
                </strong>{' '}
                {t('card_barcode_desc')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyAllSpecs}
            >
              <Copy className="mr-1.5 size-3.5" />
              {t('btn_copy_specs')}
            </Button>
            <Button type="button" size="sm" onClick={handleDownloadPng}>
              <Download className="mr-1.5 size-3.5" />
              {t('btn_download_png')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadSvg}
            >
              <Download className="mr-1.5 size-3.5" />
              {t('btn_download_svg')}
            </Button>
          </div>
        </div>
      </div>

      {/* 实时环绕封面比例蓝图预览 */}
      <div className="border-border bg-card rounded-2xl border p-5 shadow-xs sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('preview_title')}</h2>
          <span className="text-muted-foreground font-mono text-xs">
            {specs.fullCoverWidthPx} × {specs.fullCoverHeightPx} px @ 300 DPI
          </span>
        </div>
        <div className="border-border overflow-hidden rounded-xl border bg-slate-50 p-3 dark:bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSvgUrl}
            alt={`${specs.trimSize.id} ${specs.pageCount} page KDP wraparound cover diagram`}
            className="mx-auto h-auto max-h-[420px] w-full object-contain"
          />
        </div>
        <p className="text-muted-foreground mt-2.5 text-xs">
          {t('preview_legend')}
        </p>
      </div>

      {/* 转化 CTA：带参数进入 $19 Format & Guard Pass 导入页面 */}
      <div className="border-primary/30 bg-primary/5 rounded-2xl border p-6 sm:p-7">
        <h2 className="font-serif text-xl font-semibold tracking-tight sm:text-2xl">
          {t('cta_title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {t('cta_desc', {
            trim: `${specs.trimSize.widthIn}"×${specs.trimSize.heightIn}"`,
            paper: isZh ? specs.paperSpec.labelZh : specs.paperSpec.labelEn,
            coverW: specs.fullCoverWidthIn.toFixed(4),
            coverH: specs.fullCoverHeightIn.toFixed(4),
          })}
        </p>
        {!specs.trimSize.studioSupported && (
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
            {t('cta_nonstandard_note', {
              studioTrim: specs.studioImportParams.trim,
              studioPaper: specs.studioImportParams.paper,
            })}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={studioImportHref}
            className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}
          >
            <FileUp className="size-4" />
            {t('cta_primary')}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/tools/kdp-guard"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'gap-2'
            )}
          >
            <ShieldCheck className="size-4" />
            {t('cta_secondary')}
          </Link>
        </div>
      </div>
    </div>
  );
}
