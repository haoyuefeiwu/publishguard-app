import type { Metadata } from 'next';
import { Ruler } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { KDP_PAPER_TYPES } from '@/lib/kdp-spine';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { ToolsCrossLinksBlock } from '@/blocks/kdp-tools-cross-links';
import { KdpSpineCalculator } from '@/components/kdp-spine-calculator';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tools.spine' });
  const path = '/tools/kdp-spine-calculator';
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

export default async function KdpSpineCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tools.spine' });
  const isZh = locale.startsWith('zh');

  const faqs = t.raw('faqs') as Array<{ q: string; a: string }>;
  const pageUrl =
    locale === defaultLocale
      ? `${envConfigs.app_url}/tools/kdp-spine-calculator`
      : `${envConfigs.app_url}/${locale}/tools/kdp-spine-calculator`;

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

  const paperRows = Object.values(KDP_PAPER_TYPES);
  const gutterRows = [
    {
      pages: '24 – 150',
      gutter: '0.375" (9.53 mm)',
      outside: '0.25" / 0.375"',
    },
    {
      pages: '151 – 300',
      gutter: '0.500" (12.70 mm)',
      outside: '0.25" / 0.375"',
    },
    {
      pages: '301 – 500',
      gutter: '0.625" (15.88 mm)',
      outside: '0.25" / 0.375"',
    },
    {
      pages: '501 – 700',
      gutter: '0.750" (19.05 mm)',
      outside: '0.25" / 0.375"',
    },
    {
      pages: '701 – 828',
      gutter: '0.875" (22.23 mm)',
      outside: '0.25" / 0.375"',
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:py-16">
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
            <Ruler className="size-3.5 text-emerald-600" />
            <span>{t('badge')}</span>
          </div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <KdpSpineCalculator />

        {/* 静态 SSR 官方速查表（服务 SEO 长尾搜索词） */}
        <section className="mt-14 space-y-6">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">
              {t('reference_title')}
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm">
              {t('reference_desc')}
            </p>
          </div>

          <div className="border-border bg-card overflow-x-auto rounded-2xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-border bg-muted/40 border-b text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">
                    {t('ref_col_paper')}
                  </th>
                  <th className="px-4 py-3 font-semibold">
                    {t('ref_col_thickness')}
                  </th>
                  <th className="px-4 py-3 font-semibold">
                    {t('ref_col_range')}
                  </th>
                  <th className="px-4 py-3 font-semibold">
                    {t('ref_col_formula')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y text-xs sm:text-sm">
                {paperRows.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">
                      {isZh ? p.labelZh : p.labelEn}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {p.thicknessIn}&quot; ({(p.thicknessIn * 25.4).toFixed(4)}{' '}
                      mm)
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {p.minPages}–{p.maxPages} pp
                    </td>
                    <td className="text-muted-foreground px-4 py-3 font-mono">
                      Pages × {p.thicknessIn}&quot;
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="font-serif text-xl font-semibold tracking-tight">
              {t('gutter_table_title')}
            </h3>
            <div className="border-border bg-card overflow-x-auto rounded-2xl border">
              <table className="w-full text-left text-sm">
                <thead className="border-border bg-muted/40 border-b text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">
                      {t('gutter_col_pages')}
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      {t('gutter_col_gutter')}
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      {t('gutter_col_outside')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y text-xs sm:text-sm">
                  {gutterRows.map((row) => (
                    <tr key={row.pages}>
                      <td className="px-4 py-3 font-mono font-medium">
                        {row.pages} pp
                      </td>
                      <td className="px-4 py-3 font-mono">{row.gutter}</td>
                      <td className="text-muted-foreground px-4 py-3 font-mono">
                        {row.outside}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ 区块 */}
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

        <ToolsCrossLinksBlock current="spine" />
      </main>
      <Footer />
    </div>
  );
}
