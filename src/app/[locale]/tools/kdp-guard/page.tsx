import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Footer } from '@/blocks/footer';
import { Header } from '@/blocks/header';
import { KdpGuardWorkbench } from '@/components/kdp-guard-workbench';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'studio.guard' });
  return {
    title: t('title'),
    description: t('subtitle'),
  };
}

export default async function KdpGuardToolPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'studio.guard' });

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16">
        <div className="mb-10 space-y-4 text-center">
          <div className="border-border bg-muted/60 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-medium">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            <span>{t('badge')}</span>
          </div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>

        <KdpGuardWorkbench />
      </main>
      <Footer />
    </div>
  );
}
