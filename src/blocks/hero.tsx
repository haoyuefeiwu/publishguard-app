import { ArrowRight, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { KdpGuardWorkbench } from '@/components/kdp-guard-workbench';
import { buttonVariants } from '@/components/ui/button';
import { DotPattern } from '@/components/ui/dot-pattern';

export async function Hero() {
  const t = await getTranslations('landing');

  return (
    <section className="relative isolate flex flex-col items-center justify-center overflow-hidden px-4 pt-10 pb-16 sm:pt-14 sm:pb-20">
      <DotPattern
        className={cn(
          '[mask-image:radial-gradient(ellipse_at_center,white,transparent_75%)]',
          'text-foreground/15'
        )}
      />
      <div className="relative mx-auto w-full max-w-4xl space-y-5 text-center">
        <div className="border-border bg-card/80 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium backdrop-blur-xs">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          <span>{t('hero.badge')}</span>
        </div>

        <h1 className="text-foreground font-serif text-4xl leading-[1.08] font-normal tracking-tight sm:text-5xl lg:text-6xl">
          {t('hero.headline')}
        </h1>

        <p className="text-muted-foreground mx-auto max-w-2xl text-base leading-relaxed sm:text-lg">
          {t('hero.subheadline')}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <a
            href="#kdp-guard-workbench"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'h-11 gap-2 rounded-full px-7'
            )}
          >
            {t('hero.cta')}
            <ArrowRight className="size-4" />
          </a>
          <a
            href="#sample-book"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'h-11 gap-2 rounded-full px-7'
            )}
          >
            {t('hero.secondary')}
          </a>
        </div>

        {/* 首屏强交互钩子：免注册直接跑一次书名撞车 + 26 项风险快测 */}
        <div id="kdp-guard-workbench" className="scroll-mt-20 pt-4">
          <KdpGuardWorkbench compact />
        </div>
      </div>
    </section>
  );
}
