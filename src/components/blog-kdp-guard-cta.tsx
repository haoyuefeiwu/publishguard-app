import { ArrowRight, ShieldCheck } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export type BlogKdpGuardCtaProps = {
  variant?: 'mid' | 'bottom';
  badge: string;
  title: string;
  description: string;
  primaryLabel: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  className?: string;
};

/**
 * 博客文中与文末 KDP Pre-Flight 预审工具转化引导卡片（纯 Props 驱动，无内置 i18n 读取）。
 */
export function BlogKdpGuardCta({
  variant = 'mid',
  badge,
  title,
  description,
  primaryLabel,
  primaryHref = '/tools/kdp-guard',
  secondaryLabel,
  secondaryHref = '/pricing',
  className,
}: BlogKdpGuardCtaProps) {
  const isMid = variant === 'mid';

  return (
    <aside
      data-slot={`blog-kdp-cta-${variant}`}
      className={cn(
        'not-prose my-8 rounded-2xl border p-5 sm:p-6',
        isMid
          ? 'border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-400/25 dark:bg-emerald-950/20'
          : 'border-border bg-muted/40',
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl space-y-2">
          <div className="bg-background/80 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span>{badge}</span>
          </div>
          <h3 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            {title}
          </h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5 sm:flex-col sm:items-stretch">
          <Link
            href={primaryHref}
            className={cn(
              buttonVariants({ variant: 'default', size: 'lg' }),
              'h-10 px-4 font-medium'
            )}
          >
            <span>{primaryLabel}</span>
            <ArrowRight className="size-4" />
          </Link>
          {secondaryLabel && (
            <Link
              href={secondaryHref}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-8 px-3 text-xs'
              )}
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
