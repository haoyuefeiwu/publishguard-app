import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';
import { Blog } from '@/blocks/blog';
import { CTA } from '@/blocks/cta';
import { FAQ } from '@/blocks/faq';
import { Features } from '@/blocks/features';
import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { Hero } from '@/blocks/hero';
import { Pricing } from '@/blocks/pricing';
import { SupportWidget } from '@/blocks/support-widget';
import { SampleDeliverables } from '@/components/sample-deliverables';

// Statically generated, refreshed hourly (picks up new blog posts)
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });

  const urlFor = (loc: string) =>
    loc === defaultLocale ? envConfigs.app_url : `${envConfigs.app_url}/${loc}`;

  return {
    description: t('hero.subheadline'),
    alternates: {
      canonical: urlFor(locale),
      languages: {
        ...Object.fromEntries(locales.map((loc) => [loc, urlFor(loc)])),
        'x-default': urlFor(defaultLocale),
      },
    },
  };
}

/**
 * Default landing page — demo content. Rewrite this file (and the blocks in
 * src/blocks/) for your project. The primitives in src/components/ stay.
 * See /quick-start or /clone-website to automate the rewrite.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main>
        <Hero />
        <SampleDeliverables />
        <Features />
        <Pricing />
        <FAQ />
        <Blog />
        <CTA />
      </main>
      <Footer />
      <SupportWidget />
    </div>
  );
}
