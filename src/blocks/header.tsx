import { getTranslations } from 'next-intl/server';

import { SiteHeader } from '@/components/site-header';

export async function Header() {
  const t = await getTranslations('landing');

  const navLinks = [
    { href: '/studio', label: t('nav.studio') },
    { href: '/tools', label: t('nav.tools') },
    { href: '/tools/kdp-guard', label: t('nav.guard') },
    { href: '/pricing', label: t('nav.pricing') },
    { href: '/blog', label: t('nav.blog') },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
