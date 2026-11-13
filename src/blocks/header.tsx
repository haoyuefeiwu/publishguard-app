import { getTranslations } from 'next-intl/server';

import { SiteHeader } from '@/components/site-header';

export async function Header() {
  const t = await getTranslations('landing');

  const navLinks = [
    { href: '/#features', label: t('nav.features') },
    { href: '/pricing', label: t('nav.pricing') },
    { href: '/blog', label: t('nav.blog') },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
