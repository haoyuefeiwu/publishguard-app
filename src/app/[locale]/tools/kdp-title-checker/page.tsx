import type { Metadata } from 'next';
import { SearchCheck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { ToolsCrossLinksBlock } from '@/blocks/kdp-tools-cross-links';
import { KdpTitleChecker } from '@/components/kdp-title-checker';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: 'tools.titleChecker',
  });
  const path = '/tools/kdp-title-checker';
  const canonical =
    locale === defaultLocale
      ? `${envConfigs.app_url}${path}`
      : `${envConfigs.app_url}/${locale}${path}`;

  return {
    title: t('meta_title'),
    description: t('meta_description'),
    alternates: {
      canonical,
      languages: Object.fromEntries(
        locales.map((loc) => [
          loc,
          loc === defaultLocale
            ? `${envConfigs.app_url}${path}`
            : `${envConfigs.app_url}/${loc}${path}`,
        ])
      ),
    },
  };
}

export default async function KdpTitleCheckerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'tools.titleChecker',
  });

  const rules = t.raw('rules') as Array<{ title: string; detail: string }>;
  const faqs = t.raw('faqs') as Array<{ q: string; a: string }>;
  const pageUrl =
    locale === defaultLocale
      ? `${envConfigs.app_url}/tools/kdp-title-checker`
      : `${envConfigs.app_url}/${locale}/tools/kdp-title-checker`;

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: t('title'),
    description: t('meta_description'),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web',
    url: pageUrl,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: envConfigs.app_name,
      url: envConfigs.app_url,
    },
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareJsonLd).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c'),
          }}
        />

        <div className="mb-10 space-y-4 text-center">
          <div className="border-border bg-muted/60 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-medium">
            <SearchCheck className="size-3.5 text-emerald-600" />
            <span>{t('badge')}</span>
          </div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <KdpTitleChecker />

        <section className="mt-14 space-y-4">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            {t('guide_title')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {rules.map((rule) => (
              <div
                key={rule.title}
                className="border-border bg-card rounded-2xl border p-5"
              >
                <h3 className="text-sm font-semibold">{rule.title}</h3>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed sm:text-sm">
                  {rule.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 space-y-4">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            {t('faq_title')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((faq) => (
              <div
                key={faq.q}
                className="border-border bg-card rounded-2xl border p-5"
              >
                <h3 className="text-sm font-semibold">{faq.q}</h3>
                <p className="text-muted-foreground mt-2 text-xs leading-relaxed sm:text-sm">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        <ToolsCrossLinksBlock current="title" />
      </main>
      <Footer />
    </div>
  );
}
