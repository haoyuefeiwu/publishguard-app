'use client';

import {
  BookOpen,
  Coins,
  CreditCard,
  Home,
  Key,
  LayoutDashboard,
  LifeBuoy,
  Receipt,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { envConfigs } from '@/config';
import { SupportWidget } from '@/blocks/support-widget';
import { AppLayout } from '@/components/app-layout';

/**
 * 统一工作区壳子，供 /studio/* 与 /settings/* 共用侧边栏导航。
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();

  const studioGroup = t('landing.nav.studio');
  const settingsGroup = t('common.systems.settings');

  const navItems = [
    {
      href: '/studio',
      label: t('settings.nav.studio'),
      icon: BookOpen,
      group: studioGroup,
    },
    {
      href: '/studio/profiles',
      label: t('settings.nav.profiles'),
      icon: Users,
      group: studioGroup,
    },
    {
      href: '/tools/kdp-guard',
      label: t('settings.nav.guard'),
      icon: ShieldCheck,
      group: studioGroup,
    },
    {
      href: '/settings',
      label: t('settings.nav.overview'),
      icon: LayoutDashboard,
      group: settingsGroup,
    },
    {
      href: '/settings/billing',
      label: t('settings.nav.billing'),
      icon: CreditCard,
      group: settingsGroup,
    },
    {
      href: '/settings/payments',
      label: t('settings.nav.payments'),
      icon: Receipt,
      group: settingsGroup,
    },
    {
      href: '/settings/credits',
      label: t('settings.nav.credits'),
      icon: Coins,
      group: settingsGroup,
    },
    {
      href: '/settings/apikeys',
      label: t('settings.nav.apikeys'),
      icon: Key,
      group: settingsGroup,
    },
    {
      href: '/settings/tickets',
      label: t('settings.nav.tickets'),
      icon: LifeBuoy,
      group: settingsGroup,
    },
  ];

  const footerNavItems = [
    { href: '/settings/profile', label: t('settings.nav.profile'), icon: User },
    { href: '/', label: t('common.systems.home'), icon: Home, newTab: true },
  ];

  return (
    <AppLayout
      navItems={navItems}
      footerNavItems={footerNavItems}
      brand={envConfigs.app_name}
      brandHref="/studio"
    >
      {children}
      <SupportWidget />
    </AppLayout>
  );
}
