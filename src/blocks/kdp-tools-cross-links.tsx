import { getTranslations } from 'next-intl/server';

import { KdpToolsCrossLinks } from '@/components/kdp-tools-cross-links';

/**
 * 免费 KDP 工具页底部的互链 Block，负责读取多语言文案并传给展示组件。
 */
export async function ToolsCrossLinksBlock({
  current,
}: {
  current: 'guard' | 'spine' | 'title';
}) {
  const t = await getTranslations('tools');

  return (
    <KdpToolsCrossLinks
      current={current}
      labels={{
        heading: t('crossLinks.heading'),
        viewAll: t('crossLinks.view_all'),
        openTool: t('hub.card_open'),
        spineTitle: t('crossLinks.spine_title'),
        spineDesc: t('crossLinks.spine_desc'),
        titleTitle: t('crossLinks.title_title'),
        titleDesc: t('crossLinks.title_desc'),
        guardTitle: t('crossLinks.guard_title'),
        guardDesc: t('crossLinks.guard_desc'),
      }}
    />
  );
}
