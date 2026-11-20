import type { Metadata } from 'next';
import {
  ArrowRight,
  FileUp,
  Ruler,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { cn } from '@/lib/utils';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { buttonVariants } from '@/components/ui/button';

function buildToolAlternates(
  path: string,
  locale: string
): Metadata['alternates'] {
  const canonical =
    locale === defaultLocale
      ? `${envConfigs.app_url}${path}`
      : `${envConfigs.app_url}/${locale}${path}`;
  return {
    canonical,
    languages: Object.fromEntries(
      locales.map((loc) => [
        loc,
        loc === defaultLocale
          ? `${envConfigs.app_url}${path}`
          : `${envConfigs.app_url}/${loc}${path}`,
      ])
    ),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tools.hub' });
  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: buildToolAlternates('/tools', locale),
  };
}

export default async function KdpToolsHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tools.hub' });

  const pageUrl =
    locale === defaultLocale
      ? `${envConfigs.app_url}/tools`
      : `${envConfigs.app_url}/${locale}/tools`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('title'),
    description: t('meta_description'),
    url: pageUrl,
    publisher: {
      '@type': 'Organization',
      name: envConfigs.app_name,
      url: envConfigs.app_url,
    },
  };

  const tools = [
    {
      href: '/tools/kdp-spine-calculator',
      icon: Ruler,
      tag: t('cards.spine.tag'),
      title: t('cards.spine.title'),
      description: t('cards.spine.description'),
    },
    {
      href: '/tools/kdp-title-checker',
      icon: SearchCheck,
      tag: t('cards.title.tag'),
      title: t('cards.title.title'),
      description: t('cards.title.description'),
    },
    {
      href: '/tools/kdp-guard',
      icon: ShieldCheck,
      tag: t('cards.guard.tag'),
      title: t('cards.guard.title'),
      description: t('cards.guard.description'),
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:py-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
          }}
        />

        <div className="mb-12 space-y-4 text-center">
          <div className="border-border bg-muted/60 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-medium">
            <Sparkles className="size-3.5 text-emerald-600" />
            <span>{t('badge')}</span>
          </div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="border-border bg-card hover:border-primary/40 group flex flex-col justify-between rounded-2xl border p-6 shadow-xs transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="bg-primary/10 text-primary inline-flex rounded-lg p-2">
                      <Icon className="size-5" />
                    </span>
                    <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium">
                      {tool.tag}
                    </span>
                  </div>
                  <h2 className="font-serif text-xl font-semibold tracking-tight">
                    {tool.title}
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {tool.description}
                  </p>
                </div>
                <div className="text-primary mt-6 inline-flex items-center gap-1.5 text-sm font-medium transition-transform group-hover:translate-x-0.5">
                  <span>{t('card_open')}</span>
                  <ArrowRight className="size-4" />
                </div>
              </Link>
            );
          })}
        </div>

        <section className="border-primary/30 bg-primary/5 mt-12 rounded-2xl border p-6 sm:p-8">
          <div className="space-y-2">
            <span className="text-primary text-xs font-semibold tracking-wide uppercase">
              {t('bottom_cta.badge')}
            </span>
            <h2 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('bottom_cta.title')}
            </h2>
            <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
              {t('bottom_cta.description')}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/studio/new?mode=import"
              className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}
            >
              <FileUp className="size-4" />
              {t('bottom_cta.primary')}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/pricing"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              {t('bottom_cta.secondary')}
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
